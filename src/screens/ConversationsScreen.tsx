import React, { useCallback, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { AppColors, useAppColors } from '../theme/colors';
import { RootStackParamList } from '../navigation/RootNavigator';
import { getLocalConversations, LocalConversation, updateLocalConversationContact } from '../data/chatDatabase';
import { SafariBanner } from '../components/SafariBanner';
import { useAppStore } from '../store/appStore';
import { getMessagePreview } from '../services/attachmentService';
import { listSavedContacts } from '../services/accountService';

export function ConversationsScreen() {
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contactSyncError, setContactSyncError] = useState<string | null>(null);
  const syncError = useAppStore((state) => state.syncError);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const db = useSQLiteContext();
  const colors = useAppColors();
  const styles = createStyles(colors);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const load = async () => {
        try {
          const localItems = await getLocalConversations(db);
          if (active) {
            setConversations(localItems);
            setLoadError(null);
          }
          try {
            const contacts = await listSavedContacts();
            for (const conversation of localItems) {
              const contact = contacts.find((item) => item.id === conversation.participantId);
              if (!contact) continue;
              await updateLocalConversationContact(db, conversation.id, {
                ...(conversation.nicknameSyncPending ? {} : { nickname: contact.nickname }),
                displayName: contact.displayName,
                biography: contact.biography,
                avatarUrl: contact.avatarUrl,
              });
            }
            if (active) {
              setConversations(await getLocalConversations(db));
              setContactSyncError(null);
            }
          } catch (error: unknown) {
            if (active) {
              setContactSyncError(
                error instanceof Error ? error.message : 'Contact details could not be synchronized.',
              );
            }
          }
        } catch (error: unknown) {
          if (active) {
            setLoadError(error instanceof Error ? error.message : 'Local conversations could not be loaded.');
          }
        }
      };
      load().catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'Conversations could not be loaded.');
        }
      });
      return () => {
        active = false;
      };
    }, [db]),
  );

  const filteredConversations = conversations.filter((conversation) =>
    `${conversation.nickname ?? ''} ${conversation.participantDisplayName} ${conversation.participantUsername} ${conversation.lastMessage ?? ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.screen}>
      <SafariBanner
        colors={colors}
        eyebrow="YOUR CIRCLE"
        title="Chats"
        subtitle={syncError ?? 'Your people are just a message away.'}
        compact
      />
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={19} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search conversations" style={styles.search} />
      </View>
      {loadError ? (
        <View style={styles.empty}><Text style={styles.emptyBody}>{loadError}</Text></View>
      ) : (
        <>
          {contactSyncError ? (
            <Text style={styles.syncHint}>Contact details may be outdated offline: {contactSyncError}</Text>
          ) : null}
          <FlatList
            data={filteredConversations}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={filteredConversations.length === 0 && styles.emptyList}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.icon}><Ionicons name="chatbubbles-outline" size={30} color={colors.red} /></View>
                <Text style={styles.emptyTitle}>No conversations yet</Text>
                <Text style={styles.emptyBody}>Search by username to start a private conversation.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.conversation}
                onPress={() =>
                  navigation.navigate('Chat', {
                    conversationId: String(item.id),
                    title: item.participantUsername,
                    participantId: item.participantId ?? undefined,
                    participantPublicKey: item.participantPublicKey ?? undefined,
                    disappearingAfterSeconds: item.disappearingAfterSeconds,
                    nickname: item.nickname,
                    participantDisplayName: item.participantDisplayName,
                    participantBiography: item.participantBiography,
                    participantAvatarUrl: item.participantAvatarUrl,
                  })
                }>
                <View style={styles.avatar}>
                  {item.participantAvatarUrl ? (
                    <Image source={{ uri: item.participantAvatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{item.participantUsername.slice(1, 3).toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.conversationText}>
                  <Text style={styles.conversationTitle}>{item.nickname || item.participantDisplayName || item.participantUsername}</Text>
                  {item.nickname || (item.participantDisplayName && item.participantDisplayName !== item.participantUsername) ? (
                    <Text style={styles.username}>{item.participantUsername}</Text>
                  ) : null}
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMessage ? getMessagePreview(item.lastMessage) : 'No messages yet'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            )}
          />
        </>
      )}
      <Pressable style={styles.button} onPress={() => navigation.navigate('Chat', { conversationId: 'new', title: 'New conversation' })}>
        <Ionicons name="create-outline" size={19} color={colors.onPrimary} />
        <Text style={styles.buttonText}>Message by username</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 20 },
  searchRow: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 13, marginTop: 14 },
  search: { flex: 1, height: '100%', color: colors.text },
  emptyList: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  icon: { width: 68, height: 68, borderRadius: 23, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 14 },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  syncHint: { color: colors.muted, fontSize: 11, marginTop: 8 },
  conversation: { flexDirection: 'row', alignItems: 'center', minHeight: 76, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 24 },
  avatarText: { color: colors.onPrimary, fontWeight: '900' },
  conversationText: { flex: 1 },
  conversationTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  username: { color: colors.muted, fontSize: 11, marginTop: 1 },
  preview: { color: colors.muted, fontSize: 12, marginTop: 3 },
  button: { height: 54, flexDirection: 'row', gap: 8, backgroundColor: colors.red, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
});
