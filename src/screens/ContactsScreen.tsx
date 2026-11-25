import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { AppColors, useAppColors } from '../theme/colors';
import { SafariBanner } from '../components/SafariBanner';
import { RootStackParamList } from '../navigation/RootNavigator';
import {
  AccountProfile,
  listSavedContacts,
  saveContact,
  SavedContact,
  searchAccountByUsername,
} from '../services/accountService';
import { listActiveStoryOwnerIds } from '../services/storyService';

export function ContactsScreen() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AccountProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [storyUserIds, setStoryUserIds] = useState<Set<string>>(() => new Set());
  const [storyLoadError, setStoryLoadError] = useState<string | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colors = useAppColors();
  const styles = createStyles(colors);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listSavedContacts().then(
        (saved) => {
          if (active) setContacts(saved);
        },
        (loadError: unknown) => {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Saved contacts could not be loaded.');
        },
      );
      listActiveStoryOwnerIds().then(
        (userIds) => {
          if (active) {
            setStoryUserIds(new Set(userIds));
            setStoryLoadError(null);
          }
        },
        (loadError: unknown) => {
          if (active) {
            setStoryLoadError(loadError instanceof Error ? loadError.message : 'Story indicators could not be loaded.');
          }
        },
      );
      return () => {
        active = false;
      };
    }, []),
  );

  const search = async () => {
    const username = query.trim();
    if (!username) return;
    setIsSearching(true);
    setError(null);
    setResult(null);
    try {
      const user = await searchAccountByUsername(username);
      setResult(user);
      if (!user) setError('No user found with that username.');
      else {
        await saveContact(user);
        setContacts(await listSavedContacts());
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'User search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SafariBanner
        colors={colors}
        eyebrow="FIND YOUR PEOPLE"
        title="Contacts"
        subtitle="Your circle, wherever life takes you."
        compact
      />
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <Ionicons name="search-outline" size={19} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search exact @username"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={search}
            style={styles.search}
          />
        </View>
        <Pressable style={styles.searchButton} onPress={search} disabled={isSearching} accessibilityRole="button" accessibilityLabel="Search users">
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>
      {storyLoadError ? <Text style={styles.error}>{storyLoadError}</Text> : null}
      <View style={styles.searchResult}>
        {isSearching ? (
          <ActivityIndicator color={colors.red} />
        ) : result ? (
          <Pressable
            style={styles.result}
            onPress={() =>
              navigation.navigate('Chat', {
                conversationId: 'new',
                title: result.username,
                participantId: result.id,
                participantPublicKey: result.publicKey,
                disappearingAfterSeconds: result.disappearingAfterSeconds,
                nickname: contacts.find((contact) => contact.id === result.id)?.nickname ?? undefined,
                participantDisplayName: result.displayName,
                participantBiography: result.biography,
                participantAvatarUrl: result.avatarUrl,
              })
            }>
            <View style={[styles.resultAvatarFrame, storyUserIds.has(result.id) && styles.storyRing]}>
              <View style={styles.resultAvatar}>
                {result.avatarUrl ? (
                  <Image source={{ uri: result.avatarUrl }} style={styles.resultAvatarImage} />
                ) : (
                  <Ionicons name="person-outline" size={24} color={colors.red} />
                )}
              </View>
            </View>
            <Text style={styles.emptyTitle}>{result.displayName || result.username}</Text>
            {result.displayName && result.displayName !== result.username ? (
              <Text style={styles.savedUsername}>{result.username}</Text>
            ) : null}
            <Text style={styles.emptyBody}>{result.biography || 'Tap to start a conversation.'}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.actionTitle}>Message</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.discoverIcon}><Ionicons name="people-outline" size={28} color={colors.red} /></View>
            <Text style={styles.emptyTitle}>{error ?? 'Find someone by username'}</Text>
            <Text style={styles.emptyBody}>Search by username to find people.</Text>
          </>
        )}
      </View>
      {contacts.length > 0 ? (
        <View style={styles.savedSection}>
          <Text style={styles.savedTitle}>Saved contacts</Text>
          <View style={styles.savedContacts}>
            {contacts.map((contact) => (
              <Pressable
                key={contact.id}
                style={styles.savedContactRow}
                onPress={() => {
                  if (!contact.publicKey) {
                    setError('This contact is not available for messaging.');
                    return;
                  }
                  navigation.navigate('Chat', {
                    conversationId: 'new',
                    title: contact.username,
                    participantId: contact.id,
                    participantPublicKey: contact.publicKey,
                    disappearingAfterSeconds: contact.disappearingAfterSeconds,
                    nickname: contact.nickname,
                    participantDisplayName: contact.displayName,
                    participantBiography: contact.biography,
                    participantAvatarUrl: contact.avatarUrl,
                  });
                }}>
                <View style={[styles.savedAvatarFrame, storyUserIds.has(contact.id) && styles.storyRing]}>
                  <View style={styles.savedAvatar}>
                    {contact.avatarUrl ? (
                      <Image source={{ uri: contact.avatarUrl }} style={styles.savedAvatarImage} />
                    ) : (
                      <Text style={styles.savedAvatarText}>{contact.username.slice(1, 3).toUpperCase()}</Text>
                    )}
                  </View>
                </View>
                <View style={styles.contactCopy}>
                  <Text style={styles.savedName} numberOfLines={1}>{contact.nickname || contact.displayName || contact.username}</Text>
                  {contact.nickname || (contact.displayName && contact.displayName !== contact.username) ? (
                    <Text style={styles.savedUsername} numberOfLines={1}>{contact.username}</Text>
                  ) : null}
                  {contact.biography ? <Text style={styles.contactBio} numberOfLines={1}>{contact.biography}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: 20, paddingBottom: 32 },
  savedSection: { marginTop: 16 },
  savedTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  savedContacts: { gap: 8 },
  savedContactRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
  savedAvatarFrame: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  storyRing: { borderColor: colors.red },
  savedAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  savedAvatarImage: { width: '100%', height: '100%' },
  savedAvatarText: { color: colors.onPrimary, fontWeight: '800' },
  contactCopy: { flex: 1, minWidth: 0 },
  savedName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  savedUsername: { color: colors.muted, fontSize: 11, marginTop: 1 },
  contactBio: { color: colors.muted, fontSize: 11, marginTop: 2 },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  searchField: { flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 12 },
  search: { flex: 1, height: '100%', color: colors.text },
  searchButton: { flexDirection: 'row', gap: 6, backgroundColor: colors.red, borderRadius: 14, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  searchButtonText: { color: colors.onPrimary, fontWeight: '800' },
  searchResult: { minHeight: 140, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  result: { width: '100%', backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20, alignItems: 'center' },
  resultAvatarFrame: { width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  resultAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  resultAvatarImage: { width: '100%', height: '100%' },
  discoverIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8 },
  error: { color: colors.red, fontSize: 12, marginTop: 8 },
  actionTitle: { color: colors.red, fontWeight: '800', marginTop: 14, textAlign: 'right' },
});
