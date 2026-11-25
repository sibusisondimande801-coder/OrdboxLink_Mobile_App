import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { AccountProfile, saveContact } from '../services/accountService';
import { sendEncryptedMessage } from '../services/messagingService';
import {
  STORY_REACTIONS,
  StoryItem,
  StoryReaction,
} from '../services/storyService';
import { AppColors } from '../theme/colors';

export function StoryViewer({
  stories,
  initialIndex,
  profile,
  colors,
  onClose,
  onViewed,
  onReaction,
}: {
  stories: StoryItem[];
  initialIndex: number;
  profile: AccountProfile;
  colors: AppColors;
  onClose: () => void;
  onViewed: (storyId: string, ownerId: string) => void;
  onReaction: (storyId: string, reaction: StoryReaction | null) => Promise<void>;
}) {
  const db = useSQLiteContext();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [reply, setReply] = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyStatus, setReplyStatus] = useState<string | null>(null);
  const [reactionBusy, setReactionBusy] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const styles = createStyles(colors);
  const story = stories[currentIndex];
  const activeStoryId = story?.id;
  const activeStoryOwnerId = story?.userId;

  useEffect(() => {
    if (activeStoryId && activeStoryOwnerId) {
      onViewed(activeStoryId, activeStoryOwnerId);
    }
    setReply('');
    setReplyError(null);
    setReplyStatus(null);
    setReactionError(null);
  }, [activeStoryId, activeStoryOwnerId, onViewed]);

  const changeStory = useCallback((direction: number) => {
    const nextIndex = currentIndex + direction;
    if (nextIndex >= stories.length) {
      onClose();
      return;
    }
    if (nextIndex < 0) return;
    setCurrentIndex(nextIndex);
  }, [currentIndex, onClose, stories.length]);

  const panResponder = useMemo(
    () => {
      const isHorizontalSwipe = (_event: unknown, gesture: { dx: number; dy: number }) =>
        Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy);

      return PanResponder.create({
        onMoveShouldSetPanResponder: isHorizontalSwipe,
        onMoveShouldSetPanResponderCapture: isHorizontalSwipe,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > 70) changeStory(1);
          else if (gesture.dx < -70) changeStory(-1);
        },
      });
    },
    [changeStory],
  );

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || replySending || !story || story.userId === profile.id) return;
    setReplySending(true);
    setReplyError(null);
    setReplyStatus(null);
    try {
      const result = await sendEncryptedMessage(
        db,
        profile,
        {
          id: story.userId,
          username: story.username,
          displayName: '',
          publicKey: story.publicKey,
          disappearingAfterSeconds: story.disappearingAfterSeconds,
        },
        `Story reply: ${text}`,
      );
      if (result.failure) throw new Error(result.failure);
      setReply('');
      setReplyStatus(result.queued ? 'Reply saved to send when you are online.' : 'Reply sent.');
      if (!result.queued) {
        await saveContact({ id: story.userId, username: story.username }).catch(() => {
          setReplyStatus('Reply sent. Contact could not be saved.');
        });
      }
      if (result.notificationFailure) {
        setReplyStatus('Reply sent. Its notification could not be delivered.');
      }
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : 'The reply could not be sent.');
    } finally {
      setReplySending(false);
    }
  };

  const react = async (reaction: StoryReaction) => {
    if (!story || story.userId === profile.id || reactionBusy) return;
    setReactionBusy(true);
    setReactionError(null);
    try {
      await onReaction(story.id, story.myReaction === reaction ? null : reaction);
    } catch (error) {
      setReactionError(error instanceof Error ? error.message : 'Your reaction could not be sent.');
    } finally {
      setReactionBusy(false);
    }
  };

  if (!story) return null;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={styles.viewer}>
        <View style={styles.header}>
          <View style={styles.author}>
            {story.avatarUrl ? (
              <Image source={{ uri: story.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.initials]}>
                <Text style={styles.initialText}>{story.username.slice(1, 3).toUpperCase()}</Text>
              </View>
            )}
            <View>
              <Text style={styles.username}>{story.username}</Text>
              <Text style={styles.storyCounter}>{currentIndex + 1} of {stories.length}</Text>
            </View>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close story">
            <Ionicons name="close" size={27} color={colors.onPrimary} />
          </Pressable>
        </View>

        <View style={styles.media} {...panResponder.panHandlers}>
          <Image source={{ uri: story.mediaUrl }} style={styles.mediaContent} resizeMode="contain" />
          {story.caption ? (
            <View style={styles.captionOverlay}>
              <Text style={styles.captionText}>{story.caption}</Text>
            </View>
          ) : null}
        </View>

        {story.userId !== profile.id ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.interactions}>
              <View style={styles.reactions}>
                {STORY_REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction}
                    style={[
                      styles.reactionButton,
                      story.myReaction === reaction && styles.selectedReaction,
                    ]}
                    onPress={() => react(reaction)}
                    disabled={reactionBusy}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${reaction}`}>
                    <Text style={styles.reaction}>{reaction}</Text>
                  </Pressable>
                ))}
              </View>
              {reactionError ? <Text style={styles.error}>{reactionError}</Text> : null}
              <View style={styles.replyRow}>
                <TextInput
                  value={reply}
                  onChangeText={setReply}
                  placeholder="Reply to story…"
                  placeholderTextColor={colors.muted}
                  style={styles.replyInput}
                  maxLength={1000}
                  returnKeyType="send"
                  onSubmitEditing={() => sendReply()}
                />
                <Pressable
                  style={[styles.sendButton, replySending && styles.disabled]}
                  onPress={sendReply}
                  disabled={replySending || !reply.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Send story reply">
                  <Ionicons name={replySending ? 'time-outline' : 'send'} size={19} color={colors.onPrimary} />
                </Pressable>
              </View>
              {replyStatus ? <Text style={styles.status}>{replyStatus}</Text> : null}
              {replyError ? <Text style={styles.error}>{replyError}</Text> : null}
            </View>
          </KeyboardAvoidingView>
        ) : null}
        <Text style={styles.ownerHint}>Swipe right for the next story</Text>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  viewer: { flex: 1, backgroundColor: colors.navy },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  initials: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  initialText: { color: colors.onPrimary, fontWeight: '800' },
  username: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  storyCounter: { color: '#D5D8D6', fontSize: 11, marginTop: 2 },
  media: { flex: 1, backgroundColor: '#080A09' },
  mediaContent: { width: '100%', height: '100%' },
  captionOverlay: { position: 'absolute', left: 16, right: 16, bottom: 18, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.58)' },
  captionText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, fontWeight: '700' },
  interactions: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8 },
  reactions: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  reactionButton: { width: 43, height: 39, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  selectedReaction: { backgroundColor: colors.red },
  reaction: { fontSize: 20 },
  replyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  replyInput: { flex: 1, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: '#777D79', paddingHorizontal: 16, color: colors.onPrimary },
  sendButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red },
  disabled: { opacity: 0.6 },
  status: { color: '#D5D8D6', fontSize: 11 },
  error: { color: '#FF9DA8', fontSize: 11 },
  ownerHint: { color: '#D5D8D6', textAlign: 'center', fontSize: 12, padding: 18 },
});
