import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import QuickSetupScreen from './src/QuickSetupScreen';
import SetupScreen from './src/SetupScreen';
import SessionScreen from './src/SessionScreen';
import AboutScreen from './src/AboutScreen';
import ErrorBoundary from './src/ErrorBoundary';
import { type SessionConfig } from './src/AudioEngine';
type Screen = 'quick' | 'custom' | 'session' | 'about';

export default function App() {
  const [screen, setScreen] = useState<Screen>('quick');

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS:       true,
      staysActiveInBackground:    true,
      shouldDuckAndroid:          false,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, []);
  const [config, setConfig]       = useState<SessionConfig | null>(null);
  const [origin, setOrigin]       = useState<'quick' | 'custom'>('quick');

  const handleStart = (cfg: SessionConfig, from: 'quick' | 'custom') => {
    setOrigin(from);
    setConfig(cfg);
    setScreen('session');
  };

  return (
    <ErrorBoundary>
    <View style={s.root}>
      {/* Setup screens remain mounted so the session overlay slides over solid dark content */}
      {screen === 'custom' ? (
        <SetupScreen
          onStart={cfg => handleStart(cfg, 'custom')}
          onBack={() => setScreen('quick')}
        />
      ) : (
        <QuickSetupScreen
          onStart={cfg => handleStart(cfg, 'quick')}
          onAdvanced={() => setScreen('custom')}
          onAbout={() => setScreen('about')}
        />
      )}

      {screen === 'session' && config && (
        <SessionScreen
          config={config}
          onExit={() => setScreen(origin)}
        />
      )}

      {screen === 'about' && (
        <AboutScreen onBack={() => setScreen('quick')} />
      )}
    </View>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
