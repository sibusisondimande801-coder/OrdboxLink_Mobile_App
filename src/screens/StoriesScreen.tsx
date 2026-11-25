import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StoryFeed } from '../components/StoryFeed';
import { SafariBanner } from '../components/SafariBanner';
import { useAppStore } from '../store/appStore';
import { useAppColors } from '../theme/colors';

export function StoriesScreen() {
  const profile = useAppStore((state) => state.profile);
  const colors = useAppColors();
  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SafariBanner
          colors={colors}
          eyebrow="MOMENTS IN THE WILD"
          title="Stories"
          subtitle="Share a photo story with an optional caption and soundtrack."
        />
        {profile ? <StoryFeed profile={profile} colors={colors} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ReturnType<typeof useAppColors>) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 36 },
});
