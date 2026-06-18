import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { AudioEngine, type SessionConfig } from './AudioEngine';
import { randomMysteryNotes } from './musicTheory';
import { playTick } from './uiTick';

interface Props {
  config: SessionConfig;
  onExit: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = {
  mystery:      '#FFD700',
  verification: '#4ADE80',
  path:         '#60A0FF',
} as const;

// Primary colours for dim-mode EXIT — cycles R→G→B each appearance to spread OLED sub-pixel wear
const DIM_COLORS = ['#FF2244', '#22DD55', '#2255FF'] as const;

function shuffled12(): number[] {
  const keys = Array.from({ length: 12 }, (_, i) => 57 + i);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

export default function SessionScreen({ config, onExit }: Props) {
  const slideAnim   = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const opacity     = useRef(new Animated.Value(0)).current;
  const engineRef   = useRef<AudioEngine | null>(null);
  const tonicQueue  = useRef<number[]>([]);
  const [label, setLabel]       = useState('');
  const [color, setColor]       = useState<string>(COLORS.mystery);
  const [showCount, setShowCount] = useState(0);
  const [dimmed, setDimmed]       = useState(false);
  const [dimColorIdx, setDimColorIdx] = useState(0);
  const exitFlicker               = useRef(new Animated.Value(0)).current;

  // Keep the screen on for the entire session — prevents auto-lock during exercise.
  useKeepAwake();

  // Dim mode cycle: 1s fade in → 4s hold → 1s fade out → 6s black (12s total).
  // Cycles through R→G→B on each appearance to spread OLED sub-pixel wear.
  useEffect(() => {
    if (!dimmed) { exitFlicker.setValue(0); return; }
    let cancelled = false;
    let idx = 0;

    const runCycle = () => {
      if (cancelled) return;
      setDimColorIdx(idx);
      exitFlicker.setValue(0);
      Animated.sequence([
        Animated.timing(exitFlicker, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.delay(4000),
        Animated.timing(exitFlicker, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished || cancelled) return;
        setTimeout(() => {
          if (cancelled) return;
          idx = (idx + 1) % DIM_COLORS.length;
          runCycle();
        }, 6000);
      });
    };

    runCycle();
    return () => { cancelled = true; exitFlicker.stopAnimation(); };
  }, [dimmed]);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
  }, [slideAnim]);

  // Start the fade-in only after React has committed the new label/color to the
  // native view. Without this, the native animation thread can make the old text
  // briefly visible before the JS re-render replaces it.
  useEffect(() => {
    if (showCount === 0) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showCount]);

  const showLabel = (text: string, c: string) => {
    opacity.setValue(0);
    setLabel(text);
    setColor(c);
    setShowCount(n => n + 1);
  };

  const hideLabel = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    let mounted = true;
    const engine = new AudioEngine();
    engineRef.current = engine;

    const startRound = async () => {
      if (!mounted) return;
      if (tonicQueue.current.length === 0) tonicQueue.current = shuffled12();
      const tonicMidi = tonicQueue.current.shift()!;

      // Brief pause before loading the new cadence — gives Oppo's ExoPlayer time
      // to process unloadAsync() calls from the previous round before new instances
      // are created. Prevents gradual pool exhaustion during sustained runs.
      await new Promise(r => setTimeout(r, 250));
      if (!mounted) return;

      await engine.preloadForSession(tonicMidi, config.mode, config.volume).catch(() => {});
      if (!mounted) return;

      const mysteries = randomMysteryNotes(
        config.mysteryCount,
        tonicMidi,
        config.direction,
        config.mysteryMode,
        config.mode,
      );
      engine.playSession(
        tonicMidi,
        mysteries,
        config.direction,
        config.mode,
        event => {
          if (event.type === 'cadence') {
            showLabel('ready?', COLORS.mystery);
          } else if (event.type === 'hide') {
            hideLabel();
          } else if (event.type === 'mystery') {
            showLabel('?', COLORS.mystery);
          } else if (event.type === 'syllable') {
            const c = event.phase === 'path' ? COLORS.path : COLORS.verification;
            showLabel(event.syllable, c);
          } else if (event.type === 'done') {
            hideLabel();
            startRound();
          }
        },
      ).catch(() => {});
    };

    startRound();

    return () => {
      mounted = false;
      engine.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExit = () => {
    playTick();
    engineRef.current?.stop();
    onExit();
  };

  return (
    <Animated.View style={[s.slide, { transform: [{ translateX: slideAnim }] }]}>
      <Image
        source={require('../assets/focus.png')}
        style={s.image}
        resizeMode="contain"
      />
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

        <View style={s.stage}>
          <Animated.Text style={[s.label, { opacity, color }]}>
            {label}
          </Animated.Text>
        </View>
        <TouchableOpacity style={s.dimButton} activeOpacity={0.6} onPress={() => setDimmed(true)}>
          <Text style={s.dimText}>D I M</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.exitPill} activeOpacity={0.6} onPress={handleExit}>
          <Text style={s.exitText}>EXIT</Text>
        </TouchableOpacity>

        {/* Dim overlay — inside SafeAreaView so EXIT lands at the exact same
            position as in normal mode. Single TouchableOpacity is always tappable;
            visual children are pointerEvents=none so opacity doesn't block touches. */}
        {dimmed && (
          <View style={s.dimOverlay}>
            <TouchableOpacity style={s.dimmedExit} activeOpacity={0} onPress={handleExit}>
              <Animated.View pointerEvents="none" style={[s.exitPill, s.dimmedExitVisual, {
                opacity: exitFlicker,
                borderColor: DIM_COLORS[dimColorIdx],
              }]}>
                <Text style={[s.exitText, { color: DIM_COLORS[dimColorIdx] }]}>EXIT</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  slide: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0a0a0a',
  },
  root: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0.18,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 76,
    fontWeight: '200',
    letterSpacing: 8,
  },
  exitPill: {
    width: 240,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 64,
  },
  exitText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '300',
    letterSpacing: 7,
    paddingLeft: 7,
  },
  dimButton: {
    width: 240,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  dimText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '300',
    letterSpacing: 7,
    paddingLeft: 7,
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dimmedExit: {
    marginBottom: 64,
  },
  dimmedExitVisual: {
    marginBottom: 0,
  },
});
