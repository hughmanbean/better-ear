import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Direction, type MysteryMode, type Mode, type ParentScale } from './musicTheory';

const KEY_QUICK    = '@betterear/quick';
const KEY_ADVANCED = '@betterear/advanced';

export interface QuickSettings {
  level:     'chordal' | 'scalar' | 'chromatic';
  key:       'major' | 'minor';
  direction: Direction;
}

export interface AdvancedSettings {
  direction:    Direction;
  parentScale:  ParentScale;
  mode:         Mode;
  mysteryMode:  MysteryMode;
  mysteryCount: number;
  volume:       0 | 1 | 2;
}

export async function loadQuickSettings(): Promise<QuickSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_QUICK);
    return raw ? (JSON.parse(raw) as QuickSettings) : null;
  } catch {
    return null;
  }
}

export async function saveQuickSettings(s: QuickSettings): Promise<void> {
  try { await AsyncStorage.setItem(KEY_QUICK, JSON.stringify(s)); } catch {}
}

export async function loadAdvancedSettings(): Promise<AdvancedSettings | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_ADVANCED);
    return raw ? (JSON.parse(raw) as AdvancedSettings) : null;
  } catch {
    return null;
  }
}

export async function saveAdvancedSettings(s: AdvancedSettings): Promise<void> {
  try { await AsyncStorage.setItem(KEY_ADVANCED, JSON.stringify(s)); } catch {}
}
