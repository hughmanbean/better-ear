import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

interface State { error: Error | null }

export default class ErrorBoundary extends React.Component<
  React.PropsWithChildren<object>,
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <SafeAreaView style={s.root}>
          <Text style={s.title}>Something went wrong</Text>
          <Text style={s.message}>{this.state.error.message}</Text>
          <TouchableOpacity
            style={s.pill}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={s.pillText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center', padding: 40 },
  title:    { color: '#ffffff', fontSize: 18, fontWeight: '300', letterSpacing: 4, marginBottom: 20 },
  message:  { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginBottom: 48, lineHeight: 20 },
  pill:     { width: 240, height: 52, borderRadius: 26, borderWidth: 1, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  pillText: { color: '#ffffff', fontSize: 13, fontWeight: '300', letterSpacing: 8, paddingLeft: 8 },
});
