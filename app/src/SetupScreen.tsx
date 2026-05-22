import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ScrollView,
} from 'react-native';
import { type SessionConfig } from './AudioEngine';
import { loadAdvancedSettings, saveAdvancedSettings } from './settings';
import { playTick } from './uiTick';
import {
  type Direction,
  type MysteryMode,
  type Mode,
  type ParentScale,
  PARENT_SCALES,
  PARENT_SCALE_LABEL,
  PARENT_SCALE_MODES,
  MODE_LABEL,
} from './musicTheory';

interface Props {
  onStart:  (config: SessionConfig) => void;
  onBack?:  () => void;
}

const DIRECTIONS: Direction[] = ['ascending', 'descending'];
const DIR_LABEL: Record<Direction, string> = { ascending: 'ascending', descending: 'descending' };

const MYSTERY_MODES: MysteryMode[] = ['chordal', 'diatonic', 'chromatic'];
const MYSTERY_LABEL: Record<MysteryMode, string> = {
  chordal:   'chordal',
  diatonic:  'diatonic',
  chromatic: 'chromatic',
};

const MYSTERY_COUNTS       = Array.from({ length: 11 }, (_, i) => i + 1);
const MYSTERY_COUNT_LABELS = Object.fromEntries(
  MYSTERY_COUNTS.map(n => [n, String(n)]),
) as Record<number, string>;

export default function SetupScreen({ onStart, onBack }: Props) {
  const [direction,    setDirection]    = useState<Direction>('ascending');
  const [mysteryMode,  setMysteryMode]  = useState<MysteryMode>('diatonic');
  const [parentScale,  setParentScale]  = useState<ParentScale>('major');
  const [mode,         setMode]         = useState<Mode>('ionian');
  const [mysteryCount, setMysteryCount] = useState<number>(1);
  const [volume,       setVolume]       = useState<0 | 1 | 2>(2);

  useEffect(() => {
    loadAdvancedSettings().then(s => {
      if (!s) return;
      if (s.direction)                 setDirection(s.direction);
      if (s.parentScale)               setParentScale(s.parentScale);
      if (s.mode)                      setMode(s.mode);
      if (s.mysteryMode)               setMysteryMode(s.mysteryMode);
      if (s.mysteryCount)              setMysteryCount(s.mysteryCount);
      if (s.volume != null)            setVolume(s.volume);
    });
  }, []);

  useEffect(() => {
    saveAdvancedSettings({ direction, parentScale, mode, mysteryMode, mysteryCount, volume });
  }, [direction, parentScale, mode, mysteryMode, mysteryCount, volume]);

  useEffect(() => {
    setMode(PARENT_SCALE_MODES[parentScale][0]);
  }, [parentScale]);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* Controls — scrollable */}
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.controls}>
          <StepperRow
            label="D I R E C T I O N"
            items={DIRECTIONS}
            labels={DIR_LABEL}
            selected={direction}
            onSelect={setDirection}
          />
          <StepperRow
            label="S C A L E"
            items={PARENT_SCALES}
            labels={PARENT_SCALE_LABEL}
            selected={parentScale}
            onSelect={setParentScale}
          />
          <StepperRow
            label="M O D E"
            items={PARENT_SCALE_MODES[parentScale]}
            labels={MODE_LABEL}
            selected={mode}
            onSelect={setMode}
          />
          <StepperRow
            label="M Y S T E R Y"
            items={MYSTERY_MODES}
            labels={MYSTERY_LABEL}
            selected={mysteryMode}
            onSelect={setMysteryMode}
          />
          <StepperRow
            label="N O T E S"
            items={MYSTERY_COUNTS}
            labels={MYSTERY_COUNT_LABELS}
            selected={mysteryCount}
            onSelect={setMysteryCount}
          />
          <VolumePicker volume={volume} onPress={() => {
            playTick();
            setVolume(v => (((v + 1) % 3) as 0 | 1 | 2));
          }} />
        </View>
      </ScrollView>

      {/* Footer — basic pill + begin, mirrors quick screen footer */}
      <View style={s.footer}>
        {onBack && (
          <TouchableOpacity style={s.navPill} onPress={() => { playTick(); onBack(); }} hitSlop={12}>
            <Text style={s.navPillText}>‹  basic</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={s.beginPill}
          activeOpacity={0.6}
          onPress={() => {
            playTick();
            onStart({ direction, mysteryMode, mode, mysteryCount, volume });
          }}
        >
          <Text style={s.beginText}>BEGIN</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Stepper row
// ---------------------------------------------------------------------------

function StepperRow<T extends string | number>({
  label, items, labels, selected, onSelect,
}: {
  label: string;
  items: T[];
  labels: Record<T & (string | number), string>;
  selected: T;
  onSelect: (v: T) => void;
}) {
  const idx  = items.indexOf(selected);
  const prev = items[(idx - 1 + items.length) % items.length];
  const next = items[(idx + 1) % items.length];

  return (
    <View style={s.selectorBlock}>
      <Text style={s.label}>{label}</Text>
      <View style={s.stepperRow}>
        <TouchableOpacity onPress={() => { playTick(); onSelect(prev); }} hitSlop={16}>
          <Text style={s.arrow}>‹</Text>
        </TouchableOpacity>
        <Text style={s.stepperValue}>
          {labels[selected as T & (string | number)]}
        </Text>
        <TouchableOpacity onPress={() => { playTick(); onSelect(next); }} hitSlop={16}>
          <Text style={s.arrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Volume picker
// ---------------------------------------------------------------------------

// ◁ = speaker cone, ) = sound wave — plain text so color:'#fff' applies.
const VOLUME_ICONS = ['◁)', '◁))', '◁)))'] as const;

function VolumePicker({ volume, onPress }: { volume: 0 | 1 | 2; onPress: () => void }) {
  return (
    <View style={vs.block}>
      <Text style={vs.label}>V O L U M E</Text>
      <TouchableOpacity onPress={onPress} hitSlop={16} activeOpacity={0.6}>
        <View style={vs.iconWrap}>
          <Text style={vs.icon}>{VOLUME_ICONS[volume]}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const vs = StyleSheet.create({
  block:    { alignItems: 'center', gap: 10, marginTop: 28 },
  label:    { color: 'rgba(255,255,255,0.18)', fontSize: 10, letterSpacing: 5, paddingLeft: 5 },
  iconWrap: { width: 60, alignItems: 'center' },
  icon:     { fontSize: 22, color: '#ffffff', letterSpacing: 2 },
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const OFF   = 'rgba(255,255,255,0.18)';
const WHITE = '#ffffff';

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },

  controls: {
    alignItems: 'center',
    gap: 28,
  },
  selectorBlock: {
    alignItems: 'center',
    gap: 10,
  },
  label: {
    color: OFF,
    fontSize: 10,
    letterSpacing: 5,
    paddingLeft: 5,
  },

  stepperRow: {
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
