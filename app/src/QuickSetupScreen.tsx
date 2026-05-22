import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { type SessionConfig } from './AudioEngine';
import { type Direction, type MysteryMode, type Mode } from './musicTheory';
import { playTick } from './uiTick';
import { loadQuickSettings, saveQuickSettings } from './settings';

interface Props {
  onStart:    (config: SessionConfig) => void;
  onAdvanced: () => void;
  onAbout:    () => void;
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

type LevelKey = 'chordal' | 'scalar' | 'chromatic';
type KeyKey   = 'major' | 'minor';

const LEVEL_MODE: Record<LevelKey, Record<KeyKey, Mode>> = {
  chordal:   { major: 'ionian',  minor: 'aeolian' },
  scalar:    { major: 'ionian',  minor: 'aeolian' },
  chromatic: { major: 'ionian',  minor: 'aeolian' },
};

const LEVEL_MYSTERY: Record<LevelKey, MysteryMode> = {
  chordal:   'chordal',
  scalar:    'diatonic',
  chromatic: 'chromatic',
};

const LEVEL_COUNT: Record<LevelKey, number> = {
  chordal:   1,
  scalar:    2,
  chromatic: 3,
};

const LEVEL_DETAIL: Record<LevelKey, Record<KeyKey, string[]>> = {
  chordal: {
    major: ['chord tones only', 'major · ionian', '1 note'],
    minor: ['chord tones only', 'minor · aeolian', '1 note'],
  },
  scalar: {
    major: ['all scale tones', 'major · ionian', '2 notes'],
    minor: ['all scale tones', 'minor · aeolian', '2 notes'],
  },
  chromatic: {
    major: ['all 12 tones', 'major · ionian', '3 notes'],
    minor: ['all 12 tones', 'minor · aeolian', '3 notes'],
  },
};

const LEVELS:     LevelKey[]  = ['chordal', 'scalar', 'chromatic'];
const KEYS:       KeyKey[]    = ['major', 'minor'];
const DIRECTIONS: Direction[] = ['ascending', 'descending'];

// ---------------------------------------------------------------------------

export default function QuickSetupScreen({ onStart, onAdvanced, onAbout }: Props) {
  const [level,     setLevel]     = useState<LevelKey>('chordal');
  const [key,       setKey]       = useState<KeyKey>('major');
  const [direction, setDirection] = useState<Direction>('ascending');

  useEffect(() => {
    loadQuickSettings().then(s => {
      if (!s) return;
      if (s.level)     setLevel(s.level);
      if (s.key)       setKey(s.key);
      if (s.direction) setDirection(s.direction);
    });
  }, []);

  useEffect(() => {
    saveQuickSettings({ level, key, direction });
  }, [level, key, direction]);

  const handleStart = () => {
    onStart({
      direction,
      mysteryMode:  LEVEL_MYSTERY[level],
      mode:         LEVEL_MODE[level][key],
      mysteryCount: LEVEL_COUNT[level],
      volume:       2,
    });
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* Title + about — top, left-aligned */}
      <View style={s.header}>
        <Text style={s.title}>BETTER EAR</Text>
        <TouchableOpacity style={s.aboutPill} onPress={() => { playTick(); onAbout(); }} hitSlop={12}>
          <Text style={s.aboutPillText}>about  ›</Text>
        </TouchableOpacity>
      </View>

      {/* Controls — centered in available space */}
      <View style={s.main}>
        <View style={s.controls}>
          <Picker label="D I R E C T I O N" items={DIRECTIONS} selected={direction} onSelect={setDirection} />
          <Picker label="L E V E L"         items={LEVELS}     selected={level}     onSelect={setLevel} />
          <Picker label="K E Y"             items={KEYS}       selected={key}       onSelect={setKey} />
          <View style={s.detail}>
            {LEVEL_DETAIL[level][key].map(line => (
              <Text key={line} style={s.detailLine}>{line}</Text>
            ))}
          </View>
        </View>
      </View>

      {/* Footer — advanced + begin */}
      <View style={s.footer}>
        <TouchableOpacity style={s.navPill} onPress={() => { playTick(); onAdvanced(); }} hitSlop={12}>
          <Text style={s.navPillText}>advanced  ›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.beginPill} activeOpacity={0.6} onPress={() => { playTick(); handleStart(); }}>
          <Text style={s.beginText}>BEGIN</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Picker — looping stepper
// ---------------------------------------------------------------------------

function Picker<T extends string>({
  label, items, selected, onSelect,
}: {
  label:    string;
  items:    T[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  const idx  = items.indexOf(selected);
  const prev = items[(idx - 1 + items.length) % items.length];
  const next = items[(idx + 1) % items.length];

  return (
    <View style={s.block}>
      <Text style={s.label}>{label}</Text>
      <View style={s.stepper}>
        <TouchableOpacity onPress={() => { playTick(); onSelect(prev); }} hitSlop={16}>
          <Text style={s.arrow}>‹</Text>
        </TouchableOpacity>
        <Text style={s.stepperValue}>{selected}</Text>
        <TouchableOpacity onPress={() => { playTick(); onSelect(next); }} hitSlop={16}>
          <Text style={s.arrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const OFF   = 'rgba(255,255,255,0.18)';
const DIM   = 'rgba(255,255,255,0.30)';
const WHITE = '#ffffff';

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  header: {
    paddingHorizontal: 40,
    paddingTop: 52,
    paddingBottom: 8,
    alignSelf: 'stretch',
    gap: 28,
  },

  title: {
    color: WHITE,
    fontSize: 38,
    fontWeight: '200',
    letterSpacing: 14,
  },

  main: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  controls: {
    alignItems: 'center',
    gap: 28,
  },

  block: {
    alignItems: 'center',
    gap: 10,
  },
  label: {
    color: OFF,
    fontSize: 10,
    letterSpacing: 5,
    paddingLeft: 5,
  },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    minWidth: 220,
    justifyContent: 'center',
  },
  arrow: {
    color: WHITE,
    fontSize: 26,
    fontWeight: '200',
    lineHeight: 28,
  },
  stepperValue: {
    color: WHITE,
    fontSize: 18,
    fontWeight: '300',
    letterSpacing: 3,
    minWidth: 140,
    textAlign: 'center',
  },

  detail: {
    alignItems: 'center',
    gap: 6,
  },
  detailLine: {
    color: DIM,
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 3,
  },

  footer: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 64,
    gap: 28,
  },

  navPill: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    minWidth: 140,
    alignItems: 'center',
  },
  navPillText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '300',
    letterSpacing: 4,
  },
  aboutPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignSelf: 'center',
  },
  aboutPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '300',
    letterSpacing: 3,
  },

  beginPill: {
    width: 240,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beginText: {
    color: WHITE,
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 8,
    paddingLeft: 8,
  },
});
