import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TICK_ASSET = require('../assets/audio/ui_tick.wav');

// Pre-fetch pattern: keep one sound ready so playTick() fires instantly
// instead of paying the ExoPlayer initialisation cost on every button press.
let prefetched: Audio.Sound | null = null;

function preFetch(): void {
  Audio.Sound.createAsync(TICK_ASSET, { volume: 0.06 })
    .then(({ sound }) => { prefetched = sound; })
    .catch(() => {});
}

preFetch(); // ready before first press

export function playTick(): void {
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } else {
    Vibration.vibrate(80);
  }

  const s = prefetched;
  prefetched = null;
  preFetch(); // reload for next press immediately

  if (s) {
    s.playAsync()
      .then(() => { setTimeout(() => s.unloadAsync().catch(() => {}), 1000); })
      .catch(() => { s.unloadAsync().catch(() => {}); });
  } else {
    // fallback if prefetch hadn't resolved yet
    Audio.Sound.createAsync(TICK_ASSET, { volume: 0.06, shouldPlay: true })
      .then(({ sound }) => { setTimeout(() => sound.unloadAsync().catch(() => {}), 1000); })
      .catch(() => {});
  }
}
