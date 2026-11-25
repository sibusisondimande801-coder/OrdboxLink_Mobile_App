import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../store/appStore';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { PoweredByTag } from '../components/PoweredByTag';

const pages = [
  {
    title: 'Find your people',
    body: 'Choose a username and decide who can find you.',
  },
  {
    title: 'Share moments anywhere',
    body: 'Send messages, photos, documents, and voice notes. Texts wait for a connection.',
  },
  {
    title: 'Make it yours',
    body: 'Choose your colours, share stories, and set your own privacy.',
  },
];

export function OnboardingScreen() {
  const [page, setPage] = useState(0);
  const setOnboarded = useAppStore((state) => state.setOnboarded);
  const current = pages[page];

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.pattern}>
        {Array.from({ length: 12 }).map((_, index) => (
          <View key={index} style={[styles.diamond, { transform: [{ rotate: `${index * 15}deg` }] }]} />
        ))}
      </View>
      <View style={styles.brand}>
        <View style={styles.logo}><Ionicons name="chatbubbles" size={34} color={colors.onPrimary} /></View>
        <Text style={styles.brandName}>OrdboxLink</Text>
        <PoweredByTag dark />
      </View>
      <View style={styles.content}>
        <View style={styles.eyebrow}>
          <Ionicons name="lock-closed" size={14} color={colors.red} />
          <Text style={styles.eyebrowText}>PRIVATE BY DESIGN</Text>
        </View>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.body}>{current.body}</Text>
        <View style={styles.pagination}>
          {pages.map((_, index) => (
            <View key={index} style={[styles.dot, page === index && styles.activeDot]} />
          ))}
        </View>
      </View>
      <Pressable
        style={styles.button}
        onPress={() => page < pages.length - 1 ? setPage(page + 1) : setOnboarded(true)}>
        <Text style={styles.buttonText}>{page < pages.length - 1 ? 'Continue' : 'Get started'}</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy, padding: 24 },
  pattern: { position: 'absolute', right: -80, top: -50, width: 220, height: 220, opacity: 0.08 },
  diamond: { position: 'absolute', width: 130, height: 130, borderWidth: 2, borderColor: colors.onPrimary, borderRadius: 12, left: 45, top: 45 },
  brand: { alignItems: 'center', marginTop: 20 },
  logo: { width: 72, height: 72, borderRadius: 20, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.onPrimary },
  brandName: { color: colors.onPrimary, fontSize: 22, fontWeight: '800', marginTop: 10 },
  content: { flex: 1, justifyContent: 'center' },
  eyebrow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface, marginBottom: 16 },
  eyebrowText: { color: colors.navy, fontSize: 10, letterSpacing: 1, fontWeight: '900' },
  title: { ...typography.title, color: colors.onPrimary, maxWidth: 420 },
  body: { ...typography.body, color: '#CDD5DE', marginTop: 16, maxWidth: 420 },
  pagination: { flexDirection: 'row', gap: 8, marginTop: 28 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#526170' },
  activeDot: { width: 24, backgroundColor: colors.red },
  button: { backgroundColor: colors.red, borderRadius: 16, height: 56, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.onPrimary, fontSize: 17, fontWeight: '800' },
});
