import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppColors } from '../theme/colors';

export function PoweredByTag({ dark = false }: { dark?: boolean }) {
  const colors = useAppColors();
  const styles = createStyles(colors.softSurface, colors.border, colors.muted, dark);
  return (
    <View
      style={styles.tag}
      accessibilityLabel="Powered by Ordbox Tech">
      <Text style={styles.text}>
        POWERED BY <Text style={styles.brand}>ORDBOX TECH</Text>
      </Text>
    </View>
  );
}

const createStyles = (surface: string, border: string, muted: string, dark: boolean) => StyleSheet.create({
  tag: {
    alignSelf: 'center',
    backgroundColor: dark ? 'rgba(255,255,255,0.1)' : surface,
    borderColor: dark ? 'rgba(255,255,255,0.16)' : border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 8,
  },
  text: { color: dark ? '#CDD5DE' : muted, fontSize: 8, fontWeight: '700', letterSpacing: 0.8 },
  brand: { fontWeight: '900' },
});
