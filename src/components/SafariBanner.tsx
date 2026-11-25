import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppColors } from '../theme/colors';

export function SafariBanner({
  colors,
  eyebrow,
  title,
  subtitle,
  compact = false,
}: {
  colors: AppColors;
  eyebrow: string;
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  const styles = createStyles(colors);

  return (
    <View style={[styles.banner, compact && styles.compact]}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={[styles.title, compact && styles.compactTitle]} numberOfLines={2}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
      </View>
      <View style={styles.landscape} pointerEvents="none">
        <View style={styles.sun} />
        <View style={styles.farHill} />
        <View style={styles.nearHill} />
        <Text style={styles.elephant}>🐘</Text>
        <Text style={styles.giraffe}>🦒</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  banner: {
    minHeight: 140,
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: colors.navy,
    padding: 18,
  },
  compact: { minHeight: 112, borderRadius: 20, padding: 16 },
  copy: { zIndex: 1, width: '68%' },
  eyebrow: { color: '#F3CB78', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: colors.onPrimary, fontSize: 23, fontWeight: '900', marginTop: 7 },
  compactTitle: { fontSize: 20 },
  subtitle: { color: '#E8E9DF', fontSize: 12, lineHeight: 17, marginTop: 5 },
  landscape: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '48%' },
  sun: { position: 'absolute', top: 17, right: 30, width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3CB78' },
  farHill: { position: 'absolute', right: -24, bottom: -50, width: 190, height: 110, borderRadius: 100, backgroundColor: '#42634B' },
  nearHill: { position: 'absolute', right: 18, bottom: -72, width: 170, height: 110, borderRadius: 100, backgroundColor: '#728752' },
  elephant: { position: 'absolute', left: 10, bottom: 5, fontSize: 26 },
  giraffe: { position: 'absolute', right: 31, bottom: 0, fontSize: 37 },
});
