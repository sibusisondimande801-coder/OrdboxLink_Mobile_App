import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { PoweredByTag } from './PoweredByTag';

export const LAUNCH_SPLASH_DURATION_MS = 4000;

export function LaunchSplash() {
  const pulse = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    const progressAnimation = Animated.timing(progress, {
      toValue: 1,
      duration: LAUNCH_SPLASH_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    pulseAnimation.start();
    progressAnimation.start();
    return () => {
      pulseAnimation.stop();
      progressAnimation.stop();
    };
  }, [progress, pulse]);

  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0] });
  const logoScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const logoOffset = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.screen} accessibilityLabel="Opening OrdboxLink">
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Animated.View style={[styles.halo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]} />
          <Animated.View style={{ transform: [{ scale: logoScale }, { translateY: logoOffset }] }}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} />
          </Animated.View>
        </View>
        <Text style={styles.name}>OrdboxLink</Text>
        <Text style={styles.tagline}>Your people. Your conversations.</Text>
        <PoweredByTag dark />
      </View>

      <View style={styles.loading}>
        <Text style={styles.loadingText}>Opening your private space</Text>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
        <Text style={styles.footer}>PRIVATE · CONNECTED · YOURS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  brand: { alignItems: 'center' },
  mark: { width: 156, height: 156, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 144,
    height: 144,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: colors.onPrimary,
  },
  logo: { width: 116, height: 116, borderRadius: 34 },
  name: { color: colors.onPrimary, fontSize: 30, fontWeight: '900', letterSpacing: 0.3, marginTop: 16 },
  tagline: { color: '#CFD8E5', fontSize: 13, marginTop: 7 },
  loading: { position: 'absolute', left: 36, right: 36, bottom: 56, alignItems: 'center' },
  loadingText: { color: '#CFD8E5', fontSize: 12, marginBottom: 13 },
  progressTrack: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#34445A' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.red },
  footer: { color: '#93A3B8', fontSize: 9, fontWeight: '700', letterSpacing: 2, marginTop: 18 },
});
