import { Audio } from 'expo-av';
import { PLAY_TIMEOUT_MS } from './AudioEngine';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const CLICK_ASSET = require('../assets/audio/metro_click.wav');

// 80 BPM — must match BEAT_MS in AudioEngine.ts
const BEAT_MS = 750;

let rideT0:     number  = 0;
let rideN:      number  = 0;
let rideRunning = false;
let beatTimer:  ReturnType<typeof setTimeout> | null = null;
let prefetched: Audio.Sound | null = null;

// ---------------------------------------------------------------------------
// Pre-fetch: load next click ~750 ms before it's needed so playAsync is fast
// ---------------------------------------------------------------------------

function preFetch(): void {
  Audio.Sound.createAsync(CLICK_ASSET, { volume: 0.22 })
    .then(({ sound }) => {
      if (!rideRunning) { sound.unloadAsync().catch(() => {}); return; }
      if (prefetched) { prefetched.unloadAsync().catch(() => {}); }
      prefetched = sound;
    })
    .catch(() => {});
}

function fireClick(): void {
  const s = prefetched;
  prefetched = null;
  preFetch(); // queue the next one immediately

  if (s) {
    let settled = false;
    const clickFallback = () => {
      Audio.Sound.createAsync(CLICK_ASSET, { volume: 0.22 })
        .then(({ sound }) => {
          setTimeout(() => { sound.unloadAsync().catch(() => {}); }, 2000);
          sound.playAsync().catch(() => {});
        })
        .catch(() => {});
    };
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      s.unloadAsync().catch(() => {});
      clickFallback();
    }, PLAY_TIMEOUT_MS);
    s.playAsync()
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        setTimeout(() => { s.unloadAsync().catch(() => {}); }, 2000);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        s.unloadAsync().catch(() => {});
        clickFallback();
      });
  } else {
    Audio.Sound.createAsync(CLICK_ASSET, { volume: 0.22 })
      .then(({ sound }) => {
        setTimeout(() => { sound.unloadAsync().catch(() => {}); }, 2000);
        sound.playAsync().catch(() => {});
      })
      .catch(() => {});
  }
}

// Self-compensating scheduler — no drift accumulation
function scheduleNext(): void {
  if (!rideRunning) return;
  rideN++;
  const expected = rideT0 + rideN * BEAT_MS;
  const delay    = Math.max(0, expected - Date.now());
  beatTimer = setTimeout(() => {
    if (!rideRunning) return;
    fireClick();
    scheduleNext();
  }, delay);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Pre-load one click so beat 0 has a PREPARED sound ready. */
export async function ensureRide(): Promise<void> {
  if (prefetched) return;
  await Audio.Sound.createAsync(CLICK_ASSET, { volume: 0.22 })
    .then(({ sound }) => { prefetched = sound; })
    .catch(() => {});
}

/** Fire beat 0 and start the continuous scheduler. */
export function syncRide(): void {
  if (beatTimer) clearTimeout(beatTimer);
  rideT0      = Date.now();
  rideN       = 0;
  rideRunning = true;
  fireClick();
  scheduleNext();
}

export function stopRide(): void {
  rideRunning = false;
  if (beatTimer) { clearTimeout(beatTimer); beatTimer = null; }
  if (prefetched) { prefetched.unloadAsync().catch(() => {}); }
  prefetched = null;
}

export function isRideRunning(): boolean { return rideRunning; }

/** The absolute wall-clock origin of the current ride grid. */
export function getRideT0(): number { return rideT0; }
