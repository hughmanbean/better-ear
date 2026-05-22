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

// Note/cadence volumes at each level, relative to the fixed ride (0.22).
const NOTE_VOLUMES    = [0.25, 0.5,  0.8 ] as const;
const CADENCE_VOLUMES = [0.18, 0.35, 0.55] as const;

// Fixed at 80 BPM — must match BEAT_MS in ridePlayer.ts
const BEAT_MS = 750;
// Minimum beats between exercises — just enough for audio recovery.
const MIN_GAP_BEATS = 1;
// Start loading each note this many beats before it plays. 2 beats = 1.5 s
// on a freshly-started load, so the sound is always < 2 s old when played.
const PRELOAD_LEAD_BEATS = 2;
// Unload note sounds 2 s after playback starts (samples are ~1 s).
const NOTE_UNLOAD_MS = 2000;
// Cadence is 4 beats = 3000 ms; unload well after it finishes.
const CADENCE_UNLOAD_MS = 5000;

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
      this.cadenceSound = sound;
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
      for (const s of sounds) s.unloadAsync().catch(() => {});
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
  private _schedulePreload(key: string, source: number, playAtMs: number): void {
    const sid   = this.sessionId;
    const delay = Math.max(0, playAtMs - Date.now() - PRELOAD_LEAD_BEATS * BEAT_MS);
    const vol = NOTE_VOLUMES[this.volumeLevel];
    const id = setTimeout(() => {
      Audio.Sound.createAsync(source, { volume: vol })
        .then(({ sound }) => {
          if (this.sessionId !== sid) {
            sound.unloadAsync().catch(() => {}); // session ended — discard
            return;
          }
          if (!this.preloaded.has(key)) this.preloaded.set(key, []);
          this.preloaded.get(key)!.push(sound);
        })
        .catch(() => {});
    }, delay);
    this.preloadTimers.push(id);
  }

  private _playPreloaded(key: string, fallbackSrc: number): void {
    const vol = NOTE_VOLUMES[this.volumeLevel];
    const s = this.preloaded.get(key)?.shift();
    if (s) {
      s.playAsync()
        .then(() => setTimeout(() => s.unloadAsync().catch(() => {}), NOTE_UNLOAD_MS))
        .catch(() => {
          Audio.Sound.createAsync(fallbackSrc, { volume: vol, shouldPlay: true })
            .then(({ sound }) => setTimeout(() => sound.unloadAsync().catch(() => {}), NOTE_UNLOAD_MS))
            .catch(() => {});
        });
    } else {
      Audio.Sound.createAsync(fallbackSrc, { volume: vol, shouldPlay: true })
        .then(({ sound }) => setTimeout(() => sound.unloadAsync().catch(() => {}), NOTE_UNLOAD_MS))
        .catch(() => {});
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
    this._playPreloaded(key, source);
  }

  private playCadence(): void {
    const sound = this.cadenceSound;
    this.cadenceSound = null;
    if (!sound) return;
    sound.playAsync()
      .then(() => setTimeout(() => sound.unloadAsync().catch(() => {}), CADENCE_UNLOAD_MS))
      .catch(() => {});
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
      if (src) this._schedulePreload(key, src, t0 + (6 + i) * BEAT_MS);
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
    const onBeat = async (n: number) => {
      const ms = t0 + n * BEAT_MS - Date.now();
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
      await onBeat(b); if (halted()) return;
      const midi     = mysteryMidis[i];
      const syllable = getSyllable(midi, tonicMidi, direction, mode);
      onEvent?.({ type: 'syllable', syllable, midi, phase: 'verification' });
      this.playSolfegeNote(midi, syllable);
      b++;
    }

    // --- Verification: path to tonic ---
    for (let i = 0; i < path.length; i++) {
      const { midi, syllable } = path[i];
      await onBeat(b); if (halted()) return;
      onEvent?.({ type: 'syllable', syllable, midi, phase: i === 0 ? 'verification' : 'path' });
      this.playSolfegeNote(midi, syllable);
      b++;
    }

    // --- 1-beat linger ---
    await onBeat(b); if (halted()) return;
    b++;

    if (!halted()) onEvent?.({ type: 'done' });
  }
}
