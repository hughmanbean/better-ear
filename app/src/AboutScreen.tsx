import React, { useRef, useEffect } from 'react';
import {
  Animated,
  Dimensions,
  Linking,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { playTick } from './uiTick';

interface Props {
  onBack: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DONATION_URL  = 'https://ko-fi.com/kmccarthy65312';
const UTAUFR_URL    = 'https://utaufrance.com/';

export default function AboutScreen({ onBack }: Props) {
  const slideAnim   = useRef(new Animated.Value(SCREEN_WIDTH)).current;
  const arrowOpacity = useRef(new Animated.Value(1)).current;
  const arrowBounce  = useRef(new Animated.Value(0)).current;
  const flashAnim    = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 12,
    }).start();
  }, [slideAnim]);

  // Bouncing scroll indicator
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowBounce, { toValue: 7, duration: 500, useNativeDriver: true }),
        Animated.timing(arrowBounce, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [arrowBounce]);

  // Double-flash loop — classic 2000s blink tag energy
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(flashAnim, { toValue: 0, duration: 80,  useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 1, duration: 80,  useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 0, duration: 80,  useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 1, duration: 80,  useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [flashAnim]);

  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    if (e.nativeEvent.contentOffset.y > 20) {
      Animated.timing(arrowOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    }
  };

  const handleBack = () => {
    playTick();
    onBack();
  };

  return (
    <Animated.View style={[s.slide, { transform: [{ translateX: slideAnim }] }]}>
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

        {/* Title — fixed at top, matching main screen position */}
        <View style={s.header}>
          <Text style={s.title}>BETTER EAR</Text>
          <Text style={s.subtitle}>solfège</Text>
        </View>

        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <View style={s.section}>
            <Text style={s.sectionLabel}>M O V E A B L E - D O</Text>
            <Text style={s.prose}>
              Moveable-do solfège assigns syllable names — do, re, mi, fa, sol,
              la, ti — to scale degrees rather than fixed pitches. Do always
              names the tonic of the current key or mode, making the system
              equally applicable across all twelve keys and any parent scale.
              The goal is to hear and name every pitch by its relationship to
              the tonic, until those relationships become instinctive.
            </Text>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>H O W  I T  W O R K S</Text>

            <View style={s.step}>
              <Text style={s.stepNumber}>1</Text>
              <Text style={s.stepText}>
                A I–IV–V cadence drawn from the parent scale establishes the
                key and mode. Listen carefully — this is your harmonic anchor
                for the exercise.
              </Text>
            </View>

            <View style={s.step}>
              <Text style={s.stepNumber}>2</Text>
              <Text style={s.stepText}>
                One or more mystery notes are played on piano. Try to identify
                each by its solfège name before the answer is given.
              </Text>
            </View>

            <View style={s.step}>
              <Text style={s.stepNumber}>3</Text>
              <Text style={s.stepText}>
                Each mystery note is sung back in solfège for verification,
                confirming what you heard.
              </Text>
            </View>

            <View style={s.step}>
              <Text style={s.stepNumber}>4</Text>
              <Text style={s.stepText}>
                A scalar run begins on the scale degree immediately following
                the final mystery note and moves in the session direction
                through every tone of the scale, resolving back to the tonic.
                This places the mystery note in its full scalar context.
              </Text>
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>A U T H O R</Text>
            <Text style={s.body}>Kelly McCarthy</Text>
            <View style={s.donateRow}>
              <Text style={s.donateLabel}>donate: </Text>
              <TouchableOpacity onPress={() => Linking.openURL(DONATION_URL)} hitSlop={8}>
                <Animated.Text style={[s.donateLink, { opacity: flashAnim }]}>
                  ko-fi.com/kmccarthy65312
                </Animated.Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>V O I C E</Text>
            <Text style={s.body}>ALYS for DiffSinger</Text>
            <TouchableOpacity onPress={() => Linking.openURL(UTAUFR_URL)} hitSlop={8}>
              <Text style={s.link}>utaufrance.com</Text>
            </TouchableOpacity>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>V O I C E  C R E D I T S</Text>
            <Text style={s.fine}>
              Voice: Poucet{'\n'}
              Training: S'pose (imsupposed2){'\n'}
              QA &amp; logistics: Gyromancy, Hibya, Mim, ALYS team{'\n'}
              ALYS is a registered trademark of Cyrielle Collignon
            </Text>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>B U I L T  W I T H</Text>
            <Text style={s.body}>Claude AI · Anthropic</Text>
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>L I C E N S E</Text>
            <Text style={s.fine}>
              Voice samples are rendered from ALYS for DiffSinger by Utau France,
              developed in collaboration with the ALYS copyright holders.
              Used for non-commercial educational purposes.
            </Text>
          </View>
        </ScrollView>

        {/* Scroll indicator */}
        <Animated.View style={[s.scrollArrow, { opacity: arrowOpacity, transform: [{ translateY: arrowBounce }] }]}>
          <Text style={s.scrollArrowText}>↓</Text>
        </Animated.View>

        <TouchableOpacity style={s.backPill} activeOpacity={0.6} onPress={handleBack}>
          <Text style={s.backText}>BACK</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Animated.View>
  );
}

const WHITE = '#ffffff';
const DIM   = 'rgba(255,255,255,0.30)';
const OFF   = 'rgba(255,255,255,0.18)';

const s = StyleSheet.create({
  slide: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0a0a0a',
  },
  root: {
    flex: 1,
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 40,
    paddingTop: 52,
    paddingBottom: 8,
    alignSelf: 'stretch',
    gap: 6,
  },
  title: {
    color: WHITE,
    fontSize: 38,
    fontWeight: '200',
    letterSpacing: 14,
  },
  subtitle: {
    color: DIM,
    fontSize: 11,
    letterSpacing: 5,
  },

  content: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 32,
    paddingHorizontal: 32,
    gap: 36,
  },

  section: {
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  sectionLabel: {
    color: OFF,
    fontSize: 10,
    letterSpacing: 5,
    paddingLeft: 5,
  },
  body: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '300',
    letterSpacing: 3,
  },
  prose: {
    color: DIM,
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 0.5,
    lineHeight: 22,
    textAlign: 'center',
  },
  link: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 2,
    textDecorationLine: 'underline',
  },
  fine: {
    color: DIM,
    fontSize: 12,
    fontWeight: '300',
    letterSpacing: 0.5,
    textAlign: 'center',
    lineHeight: 20,
  },

  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    width: '100%',
  },
  stepNumber: {
    color: OFF,
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 2,
    lineHeight: 22,
    width: 16,
    textAlign: 'right',
  },
  stepText: {
    flex: 1,
    color: DIM,
    fontSize: 13,
    fontWeight: '300',
    letterSpacing: 0.5,
    lineHeight: 22,
  },

  donateRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  donateLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    fontWeight: '300',
    letterSpacing: 1,
  },
  donateLink: {
    color: '#FF6EC7',
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 1,
    textDecorationLine: 'underline',
  },

  scrollArrow: {
    paddingVertical: 6,
    alignItems: 'center',
  },
  scrollArrowText: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 18,
  },

  backPill: {
    width: 240,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 64,
  },
  backText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '300',
    letterSpacing: 7,
    paddingLeft: 7,
  },
});
