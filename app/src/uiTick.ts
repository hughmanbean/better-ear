import { Platform, Vibration } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const TICK_ASSET = require('../assets/audio/ui_tick.wav');

export function playTick(): void {
  if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } else {
    Vibration.vibrate(80);
  }
  Audio.Sound.createAsync(TICK_ASSET, { volume: 0.06, shouldPlay: true })
    .then(({ sound }) => {
      setTimeout(() => sound.unloadAsync().catch(() => {}), 2000);
    })
    .catch(() => {});
}
