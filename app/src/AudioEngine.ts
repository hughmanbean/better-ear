import { Audio } from 'expo-av';
import AUDIO_ASSETS from './audioAssets';
import {
  ensureRide,
  syncRide,
  stopRide,
  isRideRunning,
  getRideT0,
} from './ridePlayer';
import {
  type SolfegeSyllable,
  type Direction,
  type MysteryMode,
  type Mode,
  getSyllable,
  getVerificationPath,
} from './musicTheory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionConfig {
  direction:    Direction;
  mysteryMode:  MysteryMode;
  mode:         Mode;
  mysteryCount: number;
  volume:       0 | 1 | 2;
}

// Volumes at each user level, relative to the fixed ride (0.22).
// Solfege samples are normalized to 0.80 peak; piano files to 0.50 peak,
// so PIANO_VOLUMES is set ~25% higher to balance perceived loudness.
const NOTE_VOLUMES    = [0.096, 0.192, 0.32] as const;  // solfège
const PIANO_VOLUMES   = [0.32, 0.62, 1.00] as const;  // mystery piano notes
const CADENCE_VOLUMES = [0.22, 0.42, 0.66] as const;  // I–IV–V–I cadence

// Fixed at 80 BPM — must match BEAT_MS in ridePlayer.ts
const BEAT_MS = 750;
// Minimum beats between exercises — just enough for audio recovery.
const MIN_GAP_BEATS = 1;
// Start loading each note this many beats before it plays. 1 beat = 750 ms —
// keeps the ExoPlayer instance fresh enough that Oppo won't silently reclaim it.
const PRELOAD_LEAD_BEATS = 1;
// Unload note sounds after playback. Clips are 1750 ms; 1800 ms gives 50 ms margin.
// Keeping this tight reduces simultaneous ExoPlayer instances on Oppo.
const NOTE_UNLOAD_MS = 1800;
// Cadence is 4 beats = 3000 ms; 3500 ms gives 500 ms margin and frees the instance sooner.
const CADENCE_UNLOAD_MS = 3500;
// If playAsync() hasn't resolved or rejected within this window, treat it as
// hung (Oppo/ExoPlayer silent freeze) and immediately start a fallback sound.
// Must be well under one beat (750 ms) so the fallback lands in time.
export const PLAY_TIMEOUT_MS = 300;
// Solfège samples have a slow-attack DiffSinger envelope that causes the
// loudest part to land slightly after the onset. Fire them this many ms early
// so the perceived peak aligns with the click.
// chop_vocoder.py normalises onset position within each clip so all syllables
// have their energy landing at the same position relative to the clip start.
const SOLFEGE_LEAD_MS = 550;

export type SessionEvent =
  | { type: 'cadence' }
  | { type: 'hide' }
  | { type: 'mystery' }
  | { type: 'syllable'; syllable: SolfegeSyllable; midi: number; phase: 'verification' | 'path' }
  | { type: 'done' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clampPianoMidi(midi: number): number {
  let m = midi;
  while (m > 72) m -= 12;
  while (m < 48) m += 12;
  return m;
}

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------

export class AudioEngine {
  private stopped       = false;
  private cadenceSound: Audio.Sound | null = null;
  private preloaded     = new Map<string, Audio.Sound[]>();
  private preloadTimers: ReturnType<typeof setTimeout>[] = [];
  // Incremented on every _clearPreloaded() so in-flight createAsync calls
  // that resolve after the session ends discard their sounds instead of
  // leaking them into the next session (or into no session at all).
  private sessionId     = 0;
  private volumeLevel:  0 | 1 | 2 = 2;

  // ---------------------------------------------------------------------------
  // Preload
  // ---------------------------------------------------------------------------

  async preloadForSession(tonicMidi: number, mode: Mode, volume: 0 | 1 | 2 = 2): Promise<void> {
    this.volumeLevel = volume;
    if (this.cadenceSound) {
      await this.cadenceSound.unloadAsync().catch(() => {});
      this.cadenceSound = null;
    }
    const key    = `cadence_${tonicMidi}_${mode}`;
    const source = (AUDIO_ASSETS as Record<string, number>)[key];
    if (!source) { console.warn(`[CADENCE] No asset for ${key}`); return; }
    try {
      const { sound } = await Audio.Sound.createAsync(source, { volume: CADENCE_VOLUMES[volume] });
      if (this.stopped) {
        sound.unloadAsync().catch(() => {});
      } else {
        this.cadenceSound = sound;
      }
    } catch (e) {
      console.warn(`[CADENCE] Preload failed ${key}: ${e}`);
    }
  }

  async dispose(): Promise<void> {
    this.stop();
    if (this.cadenceSound) {
      await this.cadenceSound.unloadAsync().catch(() => {});
      this.cadenceSound = null;
    }
  }

  stop(): void {
    this.stopped = true;
    stopRide();
    this._clearPreloaded();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _clearPreloaded(): void {
    this.sessionId++;
    for (const id of this.preloadTimers) clearTimeout(id);
    this.preloadTimers = [];
    for (const sounds of this.preloaded.values()) {
      for (const s of sounds) { s.unloadAsync().catch(() => {}); }
    }
    this.preloaded.clear();
  }

  /**
   * Schedule a single note to be loaded PRELOAD_LEAD_BEATS before playAtMs.
   * On Android (particularly Oppo), "prepared" ExoPlayer instances can be
   * released by the OS after a few seconds. Loading just-in-time keeps each
   * sound fresh regardless of how deep into the exercise it plays.
   *
   * The sessionId check ensures that if a createAsync is still in flight when
   * the session ends (_clearPreloaded is called), the resolved sound is
   * discarded immediately rather than leaking into the next session.
   */
  private _schedulePreload(key: string, source: number, playAtMs: number, volumes: readonly [number, number, number] = NOTE_VOLUMES): void {
    const sid   = this.sessionId;
    const delay = Math.max(0, playAtMs - Date.now() - PRELOAD_LEAD_BEATS * BEAT_MS);
    const vol = volumes[this.volumeLevel];
    const id = setTimeout(() => {
      Audio.Sound.createAsync(source, { volume: vol })
        .then(({ sound }) => {
          if (this.sessionId !== sid) {
            sound.unloadAsync().catch(() => {});
            return;
          }
          if (!this.preloaded.has(key)) this.preloaded.set(key, []);
          this.preloaded.get(key)!.push(sound);
        })
        .catch(() => {});
    }, delay);
    this.preloadTimers.push(id);
  }

  private _playFallback(src: number, vol: number): void {
    Audio.Sound.createAsync(src, { volume: vol })
      .then(({ sound }) => {
        setTimeout(() => { sound.unloadAsync().catch(() => {}); }, NOTE_UNLOAD_MS);
        sound.playAsync().catch(() => {});
      })
      .catch(() => {});
  }

  private _playPreloaded(key: string, fallbackSrc: number, volumes: readonly [number, number, number] = NOTE_VOLUMES): void {
    const vol = volumes[this.volumeLevel];
    const s = this.preloaded.get(key)?.shift();
    if (s) {
      let settled = false;

      // Fast timeout: if playAsync() hangs past PLAY_TIMEOUT_MS, start the
      // fallback immediately so it can still land within the beat window.
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        s.unloadAsync().catch(() => {});
        this._playFallback(fallbackSrc, vol);
      }, PLAY_TIMEOUT_MS);

      s.playAsync()
        .then(status => {
          if (settled) return;
          // Detect silent ExoPlayer release: playAsync resolved but isPlaying=false
          if (!status.isLoaded || !status.isPlaying) {
            settled = true;
            clearTimeout(timeoutId);
            s.unloadAsync().catch(() => {});
            this._playFallback(fallbackSrc, vol);
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          setTimeout(() => { s.unloadAsync().catch(() => {}); }, NOTE_UNLOAD_MS);
        })
        .catch(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          s.unloadAsync().catch(() => {});
          this._playFallback(fallbackSrc, vol);
        });
    } else {
      this._playFallback(fallbackSrc, vol);
    }
  }

  private playSolfegeNote(midi: number, syllable: SolfegeSyllable): void {
    const key    = `${midi}_${syllable}`;
    const source = (AUDIO_ASSETS as Record<string, number>)[key];
    if (!source) return;
    this._playPreloaded(key, source);
  }

  private playPianoNote(midi: number): void {
    const m      = clampPianoMidi(midi);
    const key    = `${m}_piano`;
    const source = (AUDIO_ASSETS as Record<string, number>)[key];
    if (!source) return;
    this._playPreloaded(key, source, PIANO_VOLUMES);
  }

  private playCadence(): void {
    const sound = this.cadenceSound;
    this.cadenceSound = null;
    if (!sound) return;
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      sound.unloadAsync().catch(() => {});
    }, CADENCE_UNLOAD_MS);
    sound.playAsync()
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        setTimeout(() => { sound.unloadAsync().catch(() => {}); }, CADENCE_UNLOAD_MS);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        sound.unloadAsync().catch(() => {});
      });
  }

  /**
   * Ensure the ride is running and return a session t0 on its beat grid.
   * When the ride is already running, waits for a beat at least MIN_GAP_BEATS
   * away — this gives the Android audio system breathing room between exercises.
   */
  private async startRide(): Promise<number> {
    await ensureRide();

    if (!isRideRunning()) {
      syncRide();
      return getRideT0();
    }

    const gridT0  = getRideT0();
    const earliest = Date.now() + MIN_GAP_BEATS * BEAT_MS;
    const nextN   = Math.ceil((earliest - gridT0) / BEAT_MS);
    const t0      = gridT0 + nextN * BEAT_MS;
    const wait    = t0 - Date.now();
    if (wait > 0) await sleep(wait);
    return t0;
  }

  // ---------------------------------------------------------------------------
  // Session playback
  // ---------------------------------------------------------------------------

  async playSession(
    tonicMidi: number,
    mysteryMidis: number[],
    direction: Direction,
    mode: Mode,
    onEvent?: (event: SessionEvent) => void,
  ): Promise<void> {
    this.stopped = false;

    const path = mysteryMidis.length > 0
      ? getVerificationPath(mysteryMidis[mysteryMidis.length - 1], tonicMidi, direction, mode)
      : [];

    // Cancel any leftover timers from the previous session.
    this._clearPreloaded();

    // Wait for a clean beat boundary (with minimum inter-round gap).
    const t0 = await this.startRide();
    if (this.stopped) return;

    // ---------------------------------------------------------------------------
    // Rolling preload — schedule each note to load PRELOAD_LEAD_BEATS before
    // it plays. Beat layout:
    //   0–3    cadence  (4 beats)
    //   4–5    gap      (2 beats)
    //   6+i    mystery notes: one beat each (k notes)
    //   6+k    rest     (2 beats)
    //   8+k    non-path solfège (k-1 notes, consecutive)
    //   7+2k   path solfège    (path.length notes, consecutive)
    //   done fires immediately after last path note; MIN_GAP_BEATS=1 gives ~2
    //   beats before the next cadence lands on the grid.
    //
    // where k = mysteryMidis.length
    // ---------------------------------------------------------------------------
    const k = mysteryMidis.length;

    for (let i = 0; i < k; i++) {
      const m   = clampPianoMidi(mysteryMidis[i]);
      const key = `${m}_piano`;
      const src = (AUDIO_ASSETS as Record<string, number>)[key];
      if (src) this._schedulePreload(key, src, t0 + (6 + i) * BEAT_MS, PIANO_VOLUMES);
    }
    for (let i = 0; i < k - 1; i++) {
      const syllable = getSyllable(mysteryMidis[i], tonicMidi, direction, mode);
      const key = `${mysteryMidis[i]}_${syllable}`;
      const src = (AUDIO_ASSETS as Record<string, number>)[key];
      if (src) this._schedulePreload(key, src, t0 + (8 + k + i) * BEAT_MS);
    }
    const pathStart = 7 + 2 * k;
    for (let i = 0; i < path.length; i++) {
      const { midi, syllable } = path[i];
      const key = `${midi}_${syllable}`;
      const src = (AUDIO_ASSETS as Record<string, number>)[key];
      if (src) this._schedulePreload(key, src, t0 + (pathStart + i) * BEAT_MS);
    }

    const halted = (): boolean => this.stopped;

    let b = 0;
    const onBeat = async (n: number, leadMs = 0) => {
      const ms = t0 + n * BEAT_MS - leadMs - Date.now();
      if (ms > 0) await sleep(ms);
    };

    // --- I–IV–V–I cadence (4 beats) ---
    for (let i = 0; i < 4; i++) {
      await onBeat(b); if (halted()) return;
      if (i === 0) {
        onEvent?.({ type: 'cadence' });
        this.playCadence();
      }
      b++;
    }

    if (mysteryMidis.length === 0) {
      if (!halted()) onEvent?.({ type: 'done' });
      return;
    }

    // --- 2-beat gap — hide "ready?" on the first beat ---
    for (let i = 0; i < 2; i++) {
      await onBeat(b); if (halted()) return;
      if (i === 0) onEvent?.({ type: 'hide' });
      b++;
    }

    // --- Mystery notes (1 beat each) ---
    for (let i = 0; i < mysteryMidis.length; i++) {
      await onBeat(b); if (halted()) return;
      onEvent?.({ type: 'mystery' });
      this.playPianoNote(mysteryMidis[i]);
      b++;
    }

    // --- 2-beat rest ---
    for (let i = 0; i < 2; i++) {
      await onBeat(b); if (halted()) return;
      b++;
    }

    // --- Verification: non-path mysteries ---
    for (let i = 0; i < mysteryMidis.length - 1; i++) {
      await onBeat(b, SOLFEGE_LEAD_MS); if (halted()) return;
      const midi     = mysteryMidis[i];
      const syllable = getSyllable(midi, tonicMidi, direction, mode);
      this.playSolfegeNote(midi, syllable);
      setTimeout(() => { if (!this.stopped) onEvent?.({ type: 'syllable', syllable, midi, phase: 'verification' }); }, SOLFEGE_LEAD_MS);
      b++;
    }

    // --- Verification: path to tonic ---
    for (let i = 0; i < path.length; i++) {
      const { midi, syllable } = path[i];
      await onBeat(b, SOLFEGE_LEAD_MS); if (halted()) return;
      this.playSolfegeNote(midi, syllable);
      setTimeout(() => { if (!this.stopped) onEvent?.({ type: 'syllable', syllable, midi, phase: i === 0 ? 'verification' : 'path' }); }, SOLFEGE_LEAD_MS);
      b++;
    }

    // --- 1-beat linger ---
    await onBeat(b); if (halted()) return;
    b++;

    if (!halted()) onEvent?.({ type: 'done' });
  }
}
