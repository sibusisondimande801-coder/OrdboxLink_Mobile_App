import React, { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSQLiteContext } from 'expo-sqlite';
import { Ionicons } from '@expo/vector-icons';
import { useAppStore } from '../store/appStore';
import { AppColors, useAppColors } from '../theme/colors';
import { RootStackParamList } from '../navigation/RootNavigator';
import { getLocalConversations, LocalConversation } from '../data/chatDatabase';
import { getMessagePreview } from '../services/attachmentService';

export function HomeScreen() {
  const profile = useAppStore((state) => state.profile);
  const syncError = useAppStore((state) => state.syncError);
  const colors = useAppColors();
  const styles = createStyles(colors);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const db = useSQLiteContext();
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getLocalConversations(db).then(
        (items) => {
          if (active) {
            setConversations(items.slice(0, 3));
            setLoadError(null);
          }
        },
        (error: unknown) => {
          if (active) {
            setLoadError(error instanceof Error ? error.message : 'Local conversations could not be loaded.');
          }
        },
      );
      return () => {
        active = false;
      };
    }, [db]),
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <View style={styles.greetingRow}>
              <Ionicons name="sunny-outline" size={15} color={colors.red} />
              <Text style={styles.greeting}>Sawubona</Text>
            </View>
            <Text style={styles.username}>{profile?.username}</Text>
          </View>
          <View style={styles.avatar}>
            {profile?.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{profile?.username?.slice(1, 3).toUpperCase()}</Text>
            )}
          </View>
        </View>
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>YOUR CIRCLE</Text>
            <Text style={styles.heroTitle}>Stay close to your people</Text>
            <Text style={styles.heroBody}>A little closer, wherever you are.</Text>
          </View>
          <View style={styles.heroIcon}>
            <Ionicons name="leaf-outline" size={30} color={colors.onPrimary} />
          </View>
        </View>
        <View style={styles.statusCard}>
          <View style={styles.statusIcon}>
            <Ionicons
              name={syncError ? 'alert-circle-outline' : 'shield-checkmark-outline'}
              size={22}
              color={colors.red}
            />
          </View>
          <View style={styles.statusContent}>
            <Text style={styles.statusTitle}>{syncError ? 'Sync needs attention' : 'Private and in sync'}</Text>
            <Text style={styles.statusBody}>
              {syncError ?? 'Your chats are ready when you are.'}
            </Text>
          </View>
        </View>
        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>Recent conversations</Text>
          <Ionicons name="chatbubbles-outline" size={20} color={colors.red} />
        </View>
        {loadError ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="cloud-offline-outline" size={26} color={colors.red} /></View>
            <Text style={styles.emptyBody}>{loadError}</Text>
          </View>
        ) : conversations.length > 0 ? (
          <View style={styles.conversations}>
            {conversations.map((conversation) => (
              <Pressable
                key={conversation.id}
                style={styles.conversation}
                onPress={() =>
                  navigation.navigate('Chat', {
                    conversationId: String(conversation.id),
                    title: conversation.participantUsername,
                    participantId: conversation.participantId ?? undefined,
                    participantPublicKey: conversation.participantPublicKey ?? undefined,
                    disappearingAfterSeconds: conversation.disappearingAfterSeconds,
                    nickname: conversation.nickname,
                    participantBiography: conversation.participantBiography,
                    participantAvatarUrl: conversation.participantAvatarUrl,
                  })
                }>
                <View style={styles.conversationContent}>
                  <Text style={styles.conversationTitle}>{conversation.nickname || conversation.participantUsername}</Text>
                  {conversation.nickname ? (
                    <Text style={styles.conversationUsername}>{conversation.participantUsername}</Text>
                  ) : null}
                  <Text style={styles.conversationPreview} numberOfLines={1}>{conversation.lastMessage ? getMessagePreview(conversation.lastMessage) : 'No messages yet'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={26} color={colors.red} /></View>
            <Text style={styles.emptyTitle}>Your conversations start here</Text>
            <Text style={styles.emptyBody}>Find someone to start a conversation.</Text>
          </View>
        )}
        <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Chat', { conversationId: 'new', title: 'New conversation' })}>
          <Ionicons name="person-add-outline" size={19} color={colors.onPrimary} />
          <Text style={styles.primaryText}>Find someone to message</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  greeting: { color: colors.muted, fontSize: 13 },
  username: { color: colors.text, fontSize: 24, fontWeight: '900', marginTop: 3 },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 25 },
  avatarText: { color: colors.onPrimary, fontWeight: '900' },
  hero: { minHeight: 150, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.navy, borderRadius: 24, padding: 20, marginTop: 22, overflow: 'hidden' },
  heroCopy: { flex: 1, paddingRight: 10 },
  heroEyebrow: { color: '#E8C77A', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  heroTitle: { color: colors.onPrimary, fontSize: 22, fontWeight: '900', marginTop: 10, maxWidth: 250 },
  heroBody: { color: '#E3E7DF', fontSize: 13, marginTop: 8 },
  heroIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  statusCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 18, padding: 16, marginTop: 14, borderWidth: 1, borderColor: colors.border },
  statusContent: { flex: 1 },
  statusIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  statusTitle: { color: colors.text, fontWeight: '800' },
  statusBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  empty: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center', padding: 28 },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  conversations: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  conversation: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border },
  conversationContent: { flex: 1 },
  conversationTitle: { color: colors.text, fontWeight: '800' },
  conversationUsername: { color: colors.muted, fontSize: 11, marginTop: 1 },
  conversationPreview: { color: colors.muted, fontSize: 12, marginTop: 3 },
  primaryButton: { height: 54, flexDirection: 'row', gap: 9, borderRadius: 16, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
});
