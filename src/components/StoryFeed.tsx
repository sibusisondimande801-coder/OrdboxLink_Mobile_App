import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { AccountProfile } from '../services/accountService';
import {
  listActiveStories,
  countStoryReactions,
  deleteOwnStory,
  listStoryViewers,
  postStory,
  recordStoryView,
  setStoryReaction,
  StoryItem,
  StoryReaction,
  StoryViewer as StoryViewerItem,
} from '../services/storyService';
import { AppColors } from '../theme/colors';
import { StoryViewer } from './StoryViewer';

export function StoryFeed({ profile, colors }: { profile: AccountProfile; colors: AppColors }) {
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [loadingStories, setLoadingStories] = useState(true);
  const [posting, setPosting] = useState(false);
  const [storyDraft, setStoryDraft] = useState<ImagePickerAsset | null>(null);
  const [storyCaption, setStoryCaption] = useState('');
  const [deletingStoryId, setDeletingStoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingStoryIndex, setViewingStoryIndex] = useState<number | null>(null);
  const [viewersStory, setViewersStory] = useState<StoryItem | null>(null);
  const [viewers, setViewers] = useState<StoryViewerItem[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);
  const [viewersError, setViewersError] = useState<string | null>(null);
  const styles = createStyles(colors);

  const refresh = useCallback(async () => {
    setLoadingStories(true);
    try {
      setStories(await listActiveStories(profile.id));
      setError(null);
    } catch (loadError) {
      console.error('Unable to load stories', loadError);
      const message = getErrorMessage(loadError);
      setError(
        __DEV__ && message
          ? `Stories could not be loaded: ${message}`
          : 'Stories could not be loaded.',
      );
    } finally {
      setLoadingStories(false);
    }
  }, [profile.id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const createStory = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo access to share a story.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      setStoryDraft(asset);
      setStoryCaption('');
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Story could not be shared.');
    }
  };

  const publishStory = async () => {
    if (!storyDraft || posting) return;
    setPosting(true);
    setError(null);
    try {
      await postStory(profile, storyDraft, storyCaption);
      setStoryDraft(null);
      setStoryCaption('');
      await refresh();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'Story could not be shared.');
    } finally {
      setPosting(false);
    }
  };

  const cancelStoryDraft = () => {
    if (posting) return;
    setStoryDraft(null);
    setStoryCaption('');
    setError(null);
  };

  const onViewed = useCallback((storyId: string, ownerId: string) => {
    recordStoryView(storyId, profile.id, ownerId).catch((viewError: unknown) => {
      setError(viewError instanceof Error ? viewError.message : 'The story view could not be saved.');
    });
  }, [profile.id]);

  const deleteStory = async (story: StoryItem) => {
    setDeletingStoryId(story.id);
    setError(null);
    try {
      const cleanupWarning = await deleteOwnStory(profile.id, story.id);
      setStories((current) => current.filter((item) => item.id !== story.id));
      if (cleanupWarning) setError(cleanupWarning);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The story could not be deleted.');
    } finally {
      setDeletingStoryId(null);
    }
  };

  const confirmDeleteStory = (story: StoryItem) => {
    Alert.alert('Delete this story?', 'This removes the story for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteStory(story) },
    ]);
  };

  const onReaction = useCallback(async (storyId: string, reaction: StoryReaction | null) => {
    await setStoryReaction(storyId, profile.id, reaction);
    setStories((current) => current.map((story) =>
      story.id === storyId ? { ...story, myReaction: reaction } : story,
    ));
  }, [profile.id]);

  const showViewers = async (story: StoryItem) => {
    setViewersStory(story);
    setViewers([]);
    setViewersError(null);
    setLoadingViewers(true);
    try {
      const [list, reactionCount] = await Promise.all([
        listStoryViewers(story.id),
        countStoryReactions(story.id),
      ]);
      setViewers(list);
      setViewersStory({ ...story, viewCount: list.length, reactionCount });
      setStories((current) => current.map((item) =>
        item.id === story.id
          ? { ...item, viewCount: list.length, reactionCount }
          : item,
      ));
    } catch (loadError) {
      setViewersError(
        loadError instanceof Error ? loadError.message : 'Story viewers could not be loaded.',
      );
    } finally {
      setLoadingViewers(false);
    }
  };

  return (
    <View style={styles.feed}>
      <View style={styles.createCard}>
        <Pressable
          style={styles.profileButton}
          onPress={createStory}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Add a story from your profile photo">
          {profile.avatarUrl ? (
            <View style={[styles.profileAvatarRing, stories.some((story) => story.userId === profile.id) && styles.activeStoryRing]}>
              <Image source={{ uri: profile.avatarUrl }} style={styles.createAvatar} />
            </View>
          ) : (
            <View style={[styles.profileAvatarRing, stories.some((story) => story.userId === profile.id) && styles.activeStoryRing]}>
              <View style={[styles.createAvatar, styles.initials]}>
                <Text style={styles.initialText}>{profile.username.slice(1, 3).toUpperCase()}</Text>
              </View>
            </View>
          )}
          <View style={styles.addBadge}>
            <Ionicons name="add" size={14} color={colors.onPrimary} />
          </View>
        </Pressable>
        <View style={styles.createCopy}>
          <Text style={styles.createTitle}>Share your moment</Text>
          <Text style={styles.createSubtitle}>Photos expire after 24 hours</Text>
        </View>
        <Pressable
          style={[styles.addButton, posting && styles.disabledButton]}
          onPress={createStory}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Add a story">
          {posting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Ionicons name="add" size={18} color={colors.onPrimary} />
              <Text style={styles.addButtonText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loadingStories && stories.length === 0 ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator color={colors.red} />
          <Text style={styles.emptyText}>Finding fresh stories…</Text>
        </View>
      ) : stories.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Ionicons name="sparkles-outline" size={28} color={colors.red} />
          </View>
          <Text style={styles.emptyTitle}>Your feed is ready</Text>
          <Text style={styles.emptyText}>Share a photo or check back when your friends post.</Text>
        </View>
      ) : (
        stories.map((story, index) => (
          <StoryPost
            key={story.id}
            story={story}
            colors={colors}
            canSeeViews={story.userId === profile.id}
            onOpen={() => setViewingStoryIndex(index)}
            onShowViewers={() => showViewers(story)}
            onDelete={story.userId === profile.id ? () => confirmDeleteStory(story) : undefined}
            deleting={deletingStoryId === story.id}
          />
        ))
      )}

      {viewingStoryIndex !== null ? (
        <StoryViewer
          key={`${stories[viewingStoryIndex]?.id ?? 'story'}-${viewingStoryIndex}`}
          stories={stories}
          initialIndex={viewingStoryIndex}
          profile={profile}
          colors={colors}
          onClose={() => setViewingStoryIndex(null)}
          onViewed={onViewed}
          onReaction={onReaction}
        />
      ) : null}

      <Modal
        visible={storyDraft !== null}
        transparent
        animationType="slide"
        onRequestClose={cancelStoryDraft}>
        <View style={styles.draftOverlay}>
          <View style={styles.draftCard}>
            <View style={styles.draftHeader}>
              <Text style={styles.draftTitle}>Photo story</Text>
              <Pressable
                onPress={cancelStoryDraft}
                disabled={posting}
                accessibilityRole="button"
                accessibilityLabel="Cancel story">
                <Ionicons name="close" size={23} color={colors.text} />
              </Pressable>
            </View>
            {storyDraft ? (
              <Image source={{ uri: storyDraft.uri }} style={styles.draftImage} resizeMode="cover" />
            ) : null}
            <TextInput
              value={storyCaption}
              onChangeText={setStoryCaption}
              placeholder="Write a caption (optional)"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={500}
              style={styles.captionInput}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.publishButton, posting && styles.disabledButton]}
              onPress={publishStory}
              disabled={posting || !storyDraft}
              accessibilityRole="button"
              accessibilityLabel="Share photo story">
              {posting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <>
                  <Ionicons name="send-outline" size={17} color={colors.onPrimary} />
                  <Text style={styles.publishButtonText}>Share story</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={viewersStory !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setViewersStory(null)}>
        <View style={styles.viewersOverlay}>
          <View style={styles.viewersCard}>
            <View style={styles.viewersHeader}>
              <View>
                <Text style={styles.viewersTitle}>{viewersStory?.viewCount ?? 0} views</Text>
                <Text style={styles.viewersSubtitle}>{viewersStory?.reactionCount ?? 0} reactions</Text>
              </View>
              <Pressable onPress={() => setViewersStory(null)} accessibilityLabel="Close story viewers">
                <Ionicons name="close" size={23} color={colors.text} />
              </Pressable>
            </View>
            {viewersError ? (
              <Text style={styles.viewersError}>{viewersError}</Text>
            ) : loadingViewers ? (
              <ActivityIndicator color={colors.red} style={styles.viewersLoading} />
            ) : viewers.length === 0 ? (
              <Text style={styles.noViewers}>No views yet</Text>
            ) : (
              <ScrollView>
                {viewers.map((viewer) => (
                  <View key={viewer.userId} style={styles.viewerRow}>
                    <Text style={styles.viewerName}>{viewer.username}</Text>
                    <Text style={styles.viewerTime}>{formatViewedAt(viewer.viewedAt)}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StoryPost({
  story,
  colors,
  canSeeViews,
  onOpen,
  onShowViewers,
  onDelete,
  deleting,
}: {
  story: StoryItem;
  colors: AppColors;
  canSeeViews: boolean;
  onOpen: () => void;
  onShowViewers: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const styles = createStyles(colors);
  const ageLabel = getStoryAgeLabel(story.createdAt);
  const remainingHours = Math.max(1, Math.ceil((Date.parse(story.expiresAt) - Date.now()) / 3_600_000));

  return (
    <View style={styles.post}>
      <View style={styles.postHeader}>
        {story.avatarUrl ? (
          <Image source={{ uri: story.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.initials]}>
            <Text style={styles.initialText}>{story.username.slice(1, 3).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.authorCopy}>
          <Text style={styles.username}>{story.username}</Text>
          <Text style={styles.postTime}>{ageLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <Ionicons name="image-outline" size={20} color={colors.muted} />
          {onDelete ? (
            <Pressable
              style={styles.deleteButton}
              onPress={onDelete}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel="Delete your story">
              {deleting ? (
                <ActivityIndicator size="small" color={colors.red} />
              ) : (
                <Ionicons name="trash-outline" size={18} color={colors.red} />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.media}>
        <Pressable onPress={onOpen} style={styles.mediaContent} accessibilityRole="button" accessibilityLabel="Open story">
          <Image source={{ uri: story.mediaUrl }} style={styles.mediaContent} resizeMode="cover" />
        </Pressable>
        <Pressable
          style={styles.expandButton}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="Open story">
          <Ionicons name="expand-outline" size={18} color={colors.onPrimary} />
        </Pressable>
      </View>
      {story.caption ? <Text style={styles.storyCaption}>{story.caption}</Text> : null}
      <View style={styles.postFooter}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerText}>Photo story</Text>
          {canSeeViews ? (
            <View style={styles.ownerStats}>
              <Pressable style={styles.viewsButton} onPress={onShowViewers} accessibilityRole="button">
                <Ionicons name="eye-outline" size={16} color={colors.red} />
                <Text style={styles.viewCount}>{story.viewCount} views</Text>
              </Pressable>
              <View style={styles.viewsButton}>
                <Ionicons name="heart-outline" size={15} color={colors.red} />
                <Text style={styles.viewCount}>{story.reactionCount}</Text>
              </View>
            </View>
          ) : story.myReaction ? (
            <Text style={styles.myReaction}>{story.myReaction}</Text>
          ) : null}
        </View>
        <View style={styles.expiry}>
          <Ionicons name="time-outline" size={14} color={colors.muted} />
          <Text style={styles.footerText}>Expires in {remainingHours}h</Text>
        </View>
      </View>
    </View>
  );
}

function getStoryAgeLabel(createdAt: string): string {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  if (ageMinutes < 1) return 'Just now';
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.floor(ageHours / 24)}d ago`;
}

function formatViewedAt(viewedAt: string): string {
  return new Date(viewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return null;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  feed: { gap: 16, paddingTop: 16 },
  createCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  profileButton: { width: 52, height: 52 },
  profileAvatarRing: { width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  activeStoryRing: { borderColor: colors.red },
  createAvatar: { width: 42, height: 42, borderRadius: 21 },
  addBadge: { position: 'absolute', right: 0, bottom: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  initials: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  initialText: { color: colors.onPrimary, fontWeight: '800' },
  createCopy: { flex: 1 },
  createTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  createSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  addButton: { height: 40, minWidth: 72, borderRadius: 16, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: colors.red },
  disabledButton: { opacity: 0.7 },
  addButtonText: { color: colors.onPrimary, fontSize: 13, fontWeight: '800' },
  error: { color: colors.red, fontSize: 12 },
  emptyCard: { minHeight: 250, alignItems: 'center', justifyContent: 'center', padding: 28, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, maxWidth: 270 },
  post: { overflow: 'hidden', borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  postHeader: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deleteButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  authorCopy: { flex: 1 },
  username: { color: colors.text, fontSize: 14, fontWeight: '900' },
  postTime: { color: colors.muted, fontSize: 11, marginTop: 2 },
  media: { width: '100%', aspectRatio: 0.82, backgroundColor: colors.background },
  mediaContent: { width: '100%', height: '100%' },
  expandButton: { position: 'absolute', top: 12, right: 12, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' },
  postFooter: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  viewsButton: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ownerStats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  viewCount: { color: colors.red, fontSize: 11, fontWeight: '800' },
  myReaction: { fontSize: 16 },
  viewersOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  viewersCard: { maxHeight: '75%', minHeight: 260, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface },
  viewersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  viewersTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  viewersSubtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  viewersLoading: { marginTop: 60 },
  viewersError: { color: colors.red, fontSize: 12, marginTop: 48, textAlign: 'center' },
  noViewers: { color: colors.muted, textAlign: 'center', marginTop: 50 },
  viewerRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  viewerName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  viewerTime: { color: colors.muted, fontSize: 11 },
  draftOverlay: { flex: 1, justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.65)' },
  draftCard: { maxHeight: '94%', gap: 12, padding: 16, borderRadius: 24, backgroundColor: colors.surface },
  draftHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  draftTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  draftImage: { width: '100%', height: 260, borderRadius: 16, backgroundColor: colors.background },
  captionInput: { minHeight: 72, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, color: colors.text, backgroundColor: colors.background, textAlignVertical: 'top' },
  publishButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: colors.red },
  publishButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  storyCaption: { color: colors.text, fontSize: 13, lineHeight: 19, paddingHorizontal: 14, paddingTop: 10 },
});
