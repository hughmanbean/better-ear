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
        <TouchableOpacity style={s.exitPill} activeOpacity={0.6} onPress={handleExit}>
          <Text style={s.exitText}>EXIT</Text>
        </TouchableOpacity>
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
});
