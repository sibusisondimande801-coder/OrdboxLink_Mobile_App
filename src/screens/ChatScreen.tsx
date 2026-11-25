import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, useAppColors } from '../theme/colors';
import { RootStackParamList } from '../navigation/RootNavigator';
import {
  getLocalMessages,
  LocalMessage,
  getLocalConversations,
  updateLocalConversationContact,
  deleteLocalConversation,
  normalizeParticipantUsername,
} from '../data/chatDatabase';
import {
  AccountProfile,
  saveContact,
  searchAccountByUsername,
  updateSavedContactNickname,
} from '../services/accountService';
import {
  AttachmentKind,
  MAX_VOICE_NOTE_SECONDS,
  getAttachmentFile,
  parseAttachmentEnvelope,
} from '../services/attachmentService';
import {
  deleteEncryptedMessage,
  editEncryptedMessage,
  hideConversationForMe,
  MESSAGE_RECEIVED_EVENT,
  sendEncryptedAttachment,
  sendEncryptedMessage,
} from '../services/messagingService';
import { AttachmentMessage } from '../components/AttachmentMessage';
import { useTypingIndicator } from '../hooks/useTypingIndicator';
import { useAppStore } from '../store/appStore';

type ChatParticipant = Pick<
  AccountProfile,
  'id' | 'username' | 'displayName' | 'publicKey' | 'disappearingAfterSeconds' | 'biography' | 'avatarUrl'
> & { nickname?: string | null };

type AttachmentDraft = {
  kind: 'image' | 'document';
  file: Blob;
  name: string;
  mimeType: string;
};

const VOICE_NOTE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 24000,
  numberOfChannels: 1,
  bitRate: 32000,
  web: {
    ...RecordingPresets.HIGH_QUALITY.web,
    bitsPerSecond: 32000,
  },
};

async function cacheParticipantDetails(
  db: SQLiteDatabase,
  conversationId: number,
  participant: ChatParticipant,
): Promise<ChatParticipant & { nickname: string | null }> {
  const existing = (await getLocalConversations(db)).find((item) => item.id === conversationId);
  const nickname = participant.nickname !== undefined ? participant.nickname : existing?.nickname ?? null;
  await updateLocalConversationContact(db, conversationId, {
    nickname,
    displayName: participant.displayName,
    biography: participant.biography,
    avatarUrl: participant.avatarUrl,
  });
  return { ...participant, nickname };
}

export function ChatScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Chat'>>();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const profile = useAppStore((state) => state.profile);
  const colors = useAppColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [conversationId, setConversationId] = useState(route.params.conversationId);
  const [participantUsername, setParticipantUsername] = useState(
    route.params.conversationId === 'new' && !route.params.participantId ? '' : route.params.title,
  );
  const [participant, setParticipant] = useState<ChatParticipant | null>(
    route.params.participantId && route.params.participantPublicKey
      ? {
          id: route.params.participantId,
          username: route.params.title,
          publicKey: route.params.participantPublicKey,
          disappearingAfterSeconds: route.params.disappearingAfterSeconds ?? 0,
          biography: route.params.participantBiography ?? '',
          avatarUrl: route.params.participantAvatarUrl ?? null,
          displayName: route.params.participantDisplayName ?? '',
          nickname: route.params.nickname ?? null,
        }
      : null,
  );
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [editingMessage, setEditingMessage] = useState<LocalMessage | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<LocalMessage | null>(null);
  const [messageAction, setMessageAction] = useState<'options' | 'delete-confirmation' | null>(null);
  const [chatOptionsVisible, setChatOptionsVisible] = useState(false);
  const [nicknameEditorVisible, setNicknameEditorVisible] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [attachmentDraft, setAttachmentDraft] = useState<AttachmentDraft | null>(null);
  const [attachmentCaption, setAttachmentCaption] = useState('');
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceDurationMillis, setVoiceDurationMillis] = useState(0);
  const recordingWasActive = useRef(false);
  const lastRecordedDuration = useRef(0);
  const recorder = useAudioRecorder(VOICE_NOTE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  const { isParticipantTyping, typingError, updateTyping } = useTypingIndicator(
    profile,
    participant?.id ?? null,
  );
  const isNewConversation = conversationId === 'new';

  const renderHeaderTitle = useCallback(() => {
    const username = participant?.username ?? participantUsername;
    const displayName = participant?.nickname?.trim() || participant?.displayName?.trim() || username || 'New conversation';
    const showUsername = Boolean(
      participant &&
      (participant.nickname?.trim() || (participant.displayName?.trim() && participant.displayName.trim() !== username)),
    );
    const biography = participant?.biography?.trim() || 'No bio added';
    return (
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          {participant?.avatarUrl ? (
            <Image source={{ uri: participant.avatarUrl }} style={styles.headerAvatarImage} />
          ) : (
            <Text style={styles.headerAvatarText}>{(username || '?').replace(/^@/, '').slice(0, 2).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
          {showUsername ? (
            <Text style={styles.headerMeta} numberOfLines={1}>{username}</Text>
          ) : null}
          <Text style={styles.headerBio} numberOfLines={1}>{biography}</Text>
        </View>
      </View>
    );
  }, [participant, participantUsername, styles]);

  const renderHeaderRight = useCallback(() => (
    !isNewConversation ? (
      <Pressable
        style={styles.headerMenuButton}
        onPress={() => setChatOptionsVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Chat options">
        <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
      </Pressable>
    ) : null
  ), [colors.text, isNewConversation, styles]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerTitle: renderHeaderTitle, headerRight: renderHeaderRight });
  }, [navigation, renderHeaderRight, renderHeaderTitle]);

  useEffect(() => {
    if (isNewConversation) {
      setMessages([]);
      return;
    }

    const id = Number(conversationId);
    if (!Number.isSafeInteger(id)) {
      Alert.alert('Unable to open conversation', 'This local conversation has an invalid ID.');
      return;
    }

    let active = true;
    Promise.all([getLocalMessages(db, id), getLocalConversations(db)]).then(
      ([storedMessages, conversations]) => {
        if (active) {
          setMessages(storedMessages);
          const localConversation = conversations.find((item) => item.id === id);
          if (localConversation?.participantId && localConversation.participantPublicKey) {
            setParticipant({
              id: localConversation.participantId,
              username: localConversation.participantUsername,
              publicKey: localConversation.participantPublicKey,
              disappearingAfterSeconds: localConversation.disappearingAfterSeconds,
              biography: localConversation.participantBiography,
              avatarUrl: localConversation.participantAvatarUrl,
              displayName: localConversation.participantDisplayName,
              nickname: localConversation.nickname,
            });
            setParticipantUsername(localConversation.participantUsername);
          }
        }
      },
      (error: unknown) => {
        if (active) {
          Alert.alert(
            'Unable to load messages',
            error instanceof Error ? error.message : 'The local message database could not be read.',
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [conversationId, db, isNewConversation]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(
      MESSAGE_RECEIVED_EVENT,
      (event: { conversationId: number }) => {
        if (Number(conversationId) === event.conversationId) {
          getLocalMessages(db, event.conversationId).then(setMessages, (error: unknown) => {
            Alert.alert(
              'Unable to refresh messages',
              error instanceof Error ? error.message : 'The local message database could not be read.',
            );
          });
        }
      },
    );
    return () => subscription.remove();
  }, [conversationId, db]);

  useEffect(() => {
    if (recorderState.isRecording) {
      lastRecordedDuration.current = recorderState.durationMillis;
    }
    if (recordingWasActive.current && !recorderState.isRecording && recorder.uri) {
      setVoiceDurationMillis(Math.max(lastRecordedDuration.current, recorderState.durationMillis));
      setVoiceReady(true);
    }
    recordingWasActive.current = recorderState.isRecording;
  }, [recorder.uri, recorderState.durationMillis, recorderState.isRecording]);

  const resolveParticipant = useCallback(async () => {
    let target = participant;
    if (!target) {
      const normalizedUsername = normalizeParticipantUsername(participantUsername);
      if (!normalizedUsername) {
        throw new Error('Use 3–24 letters or numbers, starting with a letter.');
      }
      target = await searchAccountByUsername(normalizedUsername) ?? null;
      if (!target) throw new Error('User not found. Check the username and try again.');
    }
    return target;
  }, [participant, participantUsername]);

  const send = useCallback(async () => {
    const text = message.trim();
    if (!text || isSending) return;
    updateTyping(false);
    setIsSending(true);
    setComposerError(null);
    try {
      const target = await resolveParticipant();
      if (!profile) throw new Error('Sign in before starting a conversation.');
      if (editingMessage) {
        await editEncryptedMessage(db, profile, target, editingMessage, text);
        setMessages(await getLocalMessages(db, editingMessage.conversationId));
        setMessage('');
        setEditingMessage(null);
        return;
      }
      const result = await sendEncryptedMessage(db, profile, target, text);
      setConversationId(String(result.conversationId));
      try {
        setParticipant(await cacheParticipantDetails(db, result.conversationId, target));
      } catch (error) {
        setParticipant(target);
        Alert.alert(
          'Message sent',
          error instanceof Error ? `Contact details could not be cached: ${error.message}` : 'Contact details could not be cached.',
        );
      }
      setParticipantUsername(target.username);
      setMessages(await getLocalMessages(db, result.conversationId));
      setMessage('');
      if (!result.queued) {
        await saveContact({ id: target.id, username: target.username }).catch((error: unknown) => {
          Alert.alert('Message sent', error instanceof Error ? `Contact not saved: ${error.message}` : 'Contact could not be saved.');
        });
      }
      if (result.failure) Alert.alert('Message saved but not sent', result.failure);
      if (result.notificationFailure) {
        Alert.alert('Message sent', `The push alert could not be delivered: ${result.notificationFailure}`);
      }
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'The message could not be sent.');
      Alert.alert(
        editingMessage ? 'Message not updated' : 'Message not sent',
        error instanceof Error ? error.message : 'The message could not be saved on this device.',
      );
    } finally {
      setIsSending(false);
    }
  }, [db, editingMessage, isSending, message, profile, resolveParticipant, updateTyping]);

  const removeSelectedMessage = useCallback(async () => {
    if (!selectedMessage || !profile || isSending) return;
    setIsSending(true);
    try {
      await deleteEncryptedMessage(db, profile, selectedMessage);
      setMessages(await getLocalMessages(db, selectedMessage.conversationId));
      if (editingMessage?.id === selectedMessage.id) {
        setEditingMessage(null);
        setMessage('');
      }
      setMessageAction(null);
      setSelectedMessage(null);
    } catch (error) {
      Alert.alert(
        'Message not deleted',
        error instanceof Error ? error.message : 'The message could not be deleted.',
      );
    } finally {
      setIsSending(false);
    }
  }, [db, editingMessage, isSending, profile, selectedMessage]);

  const sendAttachment = useCallback(async (
    kind: AttachmentKind,
    file: Blob,
    name: string,
    mimeType: string,
    caption?: string,
    durationMillis?: number,
  ) => {
    if (isSending) return false;
    setIsSending(true);
    setComposerError(null);
    try {
      const target = await resolveParticipant();
      if (!profile) throw new Error('Sign in before starting a conversation.');
      const result = await sendEncryptedAttachment(
        db,
        profile,
        target,
        kind,
        file,
        name,
        mimeType,
        caption,
        durationMillis,
      );
      setConversationId(String(result.conversationId));
      try {
        setParticipant(await cacheParticipantDetails(db, result.conversationId, target));
      } catch (error) {
        setParticipant(target);
        Alert.alert(
          'Attachment sent',
          error instanceof Error ? `Contact details could not be cached: ${error.message}` : 'Contact details could not be cached.',
        );
      }
      setParticipantUsername(target.username);
      setMessages(await getLocalMessages(db, result.conversationId));
      if (!result.queued) {
        await saveContact({ id: target.id, username: target.username }).catch((error: unknown) => {
          Alert.alert('Message sent', error instanceof Error ? `Contact not saved: ${error.message}` : 'Contact could not be saved.');
        });
      }
      if (result.failure) Alert.alert('Attachment saved but not sent', result.failure);
      if (result.notificationFailure) {
        Alert.alert('Attachment sent', `The push alert could not be delivered: ${result.notificationFailure}`);
      }
      return true;
    } catch (error) {
      console.error('Attachment send failed', error);
      const errorMessage = getActionErrorMessage(error, 'The attachment could not be sent.');
      setComposerError(errorMessage);
      Alert.alert(
        'Attachment not sent',
        errorMessage,
      );
      return false;
    } finally {
      setIsSending(false);
    }
  }, [db, isSending, profile, resolveParticipant]);

  const sendAttachmentDraft = useCallback(async () => {
    if (!attachmentDraft || isSending) return;
    const sent = await sendAttachment(
      attachmentDraft.kind,
      attachmentDraft.file,
      attachmentDraft.name,
      attachmentDraft.mimeType,
      attachmentCaption,
    );
    if (sent) {
      setAttachmentDraft(null);
      setAttachmentCaption('');
    }
  }, [attachmentCaption, attachmentDraft, isSending, sendAttachment]);

  const saveNickname = async () => {
    if (!participant) return;
    const nickname = nicknameDraft.trim() || null;
    if (nickname && nickname.length > 32) {
      Alert.alert('Nickname too long', 'Keep nicknames to 32 characters or fewer.');
      return;
    }

    const localId = Number(conversationId);
    if (!Number.isSafeInteger(localId)) {
      Alert.alert('Nickname not saved', 'This conversation is not ready to be updated.');
      return;
    }

    try {
      await updateLocalConversationContact(db, localId, {
        nickname,
        nicknameSyncPending: true,
      });
      setParticipant((current) => current ? { ...current, nickname } : current);
      setNicknameEditorVisible(false);
    } catch (error) {
      Alert.alert(
        'Nickname not saved',
        error instanceof Error ? error.message : 'The nickname could not be saved on this device.',
      );
      return;
    }

    try {
      await updateSavedContactNickname(
        { id: participant.id, username: participant.username },
        nickname,
      );
      await updateLocalConversationContact(db, localId, { nicknameSyncPending: false });
    } catch (error) {
      Alert.alert(
        'Nickname saved on this device',
        `${error instanceof Error ? error.message : 'It could not be synced.'} It will try again when you are online.`,
      );
    }
  };

  const deleteConversation = async () => {
    if (isDeletingConversation) return;
    setIsDeletingConversation(true);
    try {
      const localId = Number(conversationId);
      if (!Number.isSafeInteger(localId)) {
        throw new Error('This conversation has an invalid local ID.');
      }
      const localConversation = (await getLocalConversations(db)).find((item) => item.id === localId);
      if (!localConversation) throw new Error('This conversation could not be found.');
      if (localConversation.remoteId) await hideConversationForMe(localConversation.remoteId);
      await deleteLocalConversation(db, localId);
      navigation.goBack();
    } catch (error) {
      Alert.alert(
        'Conversation not deleted',
        error instanceof Error ? error.message : 'The conversation could not be deleted for you.',
      );
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const pickPhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setComposerError('Allow photo access to share an image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const file = await getAttachmentFile(asset.uri, asset.file);
      setAttachmentDraft({
        kind: 'image',
        file,
        name: asset.fileName ?? 'Photo',
        mimeType: asset.mimeType ?? file.type ?? 'image/jpeg',
      });
      setAttachmentCaption('');
      setComposerError(null);
    } catch (error) {
      console.error('Photo attachment failed', error);
      setComposerError(getActionErrorMessage(error, 'Photo could not be selected.'));
    }
  }, []);

  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/plain',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const file = await getAttachmentFile(asset.uri, asset.file);
      setAttachmentDraft({
        kind: 'document',
        file,
        name: asset.name,
        mimeType: asset.mimeType ?? file.type ?? 'application/octet-stream',
      });
      setAttachmentCaption('');
      setComposerError(null);
    } catch (error) {
      console.error('Document attachment failed', error);
      setComposerError(getActionErrorMessage(error, 'Document could not be selected.'));
    }
  }, []);

  const toggleVoiceNote = useCallback(async () => {
    try {
      if (voiceReady && !recorderState.isRecording) {
        const uri = recorder.uri;
        if (!uri) {
          setVoiceReady(false);
          setVoiceDurationMillis(0);
          setComposerError('No voice recording was created.');
          return;
        }
        const file = await getAttachmentFile(uri);
        const mimeType = file.type || (Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4');
        const sent = await sendAttachment('voice', file, 'Voice note', mimeType, undefined, voiceDurationMillis);
        if (sent) {
          setVoiceReady(false);
          setVoiceDurationMillis(0);
          lastRecordedDuration.current = 0;
        }
        return;
      }
      if (recorderState.isRecording) {
        const durationMillis = Math.max(lastRecordedDuration.current, recorderState.durationMillis);
        recordingWasActive.current = false;
        await recorder.stop();
        const uri = recorder.uri;
        if (!uri) {
          setComposerError('No voice recording was created.');
          return;
        }
        setVoiceDurationMillis(durationMillis);
        setVoiceReady(true);
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setComposerError('Allow microphone access to record a voice note.');
        return;
      }
      lastRecordedDuration.current = 0;
      setVoiceDurationMillis(0);
      setVoiceReady(false);
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_VOICE_NOTE_SECONDS });
    } catch (error) {
      console.error('Voice note failed', error);
      setComposerError(getActionErrorMessage(error, 'Voice note could not be recorded.'));
    }
  }, [recorder, recorderState.durationMillis, recorderState.isRecording, sendAttachment, voiceDurationMillis, voiceReady]);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {isParticipantTyping ? (
        <Text style={styles.typingIndicator}>{participant?.username ?? 'Your contact'} is typing…</Text>
      ) : typingError ? (
        <Text style={styles.typingError}>{typingError}</Text>
      ) : null}
      <FlatList
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="shield-checkmark-outline" size={28} color={colors.red} /></View>
            <Text style={styles.emptyTitle}>Say hello</Text>
            <Text style={styles.emptyBody}>Your messages will appear here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const outgoing = item.senderId === profile?.id;
          const isDeleted = item.deletedAt !== null;
          const canManage = outgoing && !isDeleted;
          return (
            <View style={[styles.bubble, outgoing ? styles.outgoing : styles.incoming, isDeleted && styles.deletedBubble]}>
              {isDeleted ? (
                <Text style={styles.deletedMessage}>This message was deleted</Text>
              ) : (
                <MessageContent text={item.text} outgoing={outgoing} colors={colors} />
              )}
              <View style={styles.messageFooter}>
                <Text style={[styles.messageTime, outgoing && styles.outgoingTime]}>
                  {item.status === 'pending'
                    ? 'Queued'
                    : item.status === 'failed'
                      ? 'Not sent'
                      : `${item.editedAt ? 'Edited · ' : ''}${new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                </Text>
                {canManage ? (
                  <Pressable
                    onPress={() => {
                      setSelectedMessage(item);
                      setMessageAction('options');
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Message options">
                    <Ionicons name="ellipsis-horizontal" size={17} color={outgoing ? colors.onPrimary : colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
      />
      {!participant && (
        <TextInput
          value={participantUsername}
          onChangeText={setParticipantUsername}
          placeholder="Username, e.g. @SilentLion"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.participantInput}
        />
      )}
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      {editingMessage ? (
        <View style={styles.editingBanner}>
          <Text style={styles.editingLabel}>Editing message</Text>
          <Pressable
            onPress={() => {
              setEditingMessage(null);
              setMessage('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing">
            <Ionicons name="close-circle" size={21} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.attachments}>
          <Pressable
            style={styles.attachmentTool}
            onPress={pickPhoto}
            disabled={isSending || Boolean(attachmentDraft)}
            accessibilityRole="button"
            accessibilityLabel="Attach photo">
            <Ionicons name="image-outline" size={19} color={colors.red} />
            <Text style={styles.attachmentToolLabel}>Photo</Text>
          </Pressable>
          <Pressable
            style={styles.attachmentTool}
            onPress={pickDocument}
            disabled={isSending || Boolean(attachmentDraft)}
            accessibilityRole="button"
            accessibilityLabel="Attach document">
            <Ionicons name="document-attach-outline" size={19} color={colors.red} />
            <Text style={styles.attachmentToolLabel}>Document</Text>
          </Pressable>
          <Pressable
            style={styles.attachmentTool}
            onPress={toggleVoiceNote}
            disabled={isSending || Boolean(attachmentDraft)}
            accessibilityRole="button"
            accessibilityLabel={recorderState.isRecording ? 'Stop voice note' : voiceReady ? 'Send voice note' : 'Record voice note'}>
            <Ionicons
              name={recorderState.isRecording ? 'stop-circle-outline' : voiceReady ? 'send-outline' : 'mic-outline'}
              size={19}
              color={recorderState.isRecording || voiceReady ? colors.red : colors.navy}
            />
            <Text style={styles.attachmentToolLabel}>
              {recorderState.isRecording ? 'Stop' : voiceReady ? 'Send VN' : 'Voice'}
            </Text>
          </Pressable>
          {recorderState.isRecording ? (
            <Text style={styles.recording}>Recording · {formatDuration(recorderState.durationMillis)}</Text>
          ) : voiceReady ? (
            <Text style={styles.recording}>Voice note · {formatDuration(voiceDurationMillis)}</Text>
          ) : null}
        </View>
      )}
      {attachmentDraft ? (
        <View style={styles.attachmentDraft}>
          <View style={styles.attachmentDraftIcon}>
            <Ionicons
              name={attachmentDraft.kind === 'image' ? 'image-outline' : 'document-text-outline'}
              size={20}
              color={colors.red}
            />
          </View>
          <View style={styles.attachmentDraftCopy}>
            <Text style={styles.attachmentDraftName} numberOfLines={1}>{attachmentDraft.name}</Text>
            <Text style={styles.attachmentDraftHint}>Add an optional note below</Text>
          </View>
          <Pressable
            onPress={() => {
              setAttachmentDraft(null);
              setAttachmentCaption('');
            }}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment">
            <Ionicons name="close-circle" size={22} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          value={attachmentDraft ? attachmentCaption : message}
          onChangeText={(text) => {
            if (attachmentDraft) {
              setAttachmentCaption(text);
              return;
            }
            setMessage(text);
            updateTyping(text.length > 0);
          }}
          placeholder={
            attachmentDraft
              ? 'Add a note (optional)'
              : editingMessage
                ? 'Edit your message'
                : 'Write a message'
          }
          maxLength={attachmentDraft ? 1000 : undefined}
          multiline
          style={styles.input}
        />
        <Pressable
          style={[styles.send, isSending && styles.sendDisabled]}
          onPress={attachmentDraft ? sendAttachmentDraft : send}
          disabled={isSending}
          accessibilityRole="button"
          accessibilityLabel={
            attachmentDraft
              ? 'Send attachment'
              : editingMessage
                ? 'Save message changes'
                : 'Send encrypted message'
          }>
          <Ionicons
            name={isSending ? 'time-outline' : attachmentDraft ? 'send-outline' : editingMessage ? 'checkmark' : 'arrow-up'}
            size={21}
            color={colors.onPrimary}
          />
        </Pressable>
      </View>
      <Modal
        visible={messageAction !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMessageAction(null)}>
        <View style={styles.actionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMessageAction(null)} />
          <View style={styles.actionCard}>
            {messageAction === 'options' ? (
              <>
                <Text style={styles.actionTitle}>Message options</Text>
                {selectedMessage &&
                (selectedMessage.status === 'sent' ||
                  selectedMessage.status === 'pending' ||
                  selectedMessage.status === 'received') &&
                isTextMessage(selectedMessage.text) ? (
                  <Pressable
                    style={styles.actionButton}
                    onPress={() => {
                      setEditingMessage(selectedMessage);
                      setMessage(selectedMessage.text);
                      setMessageAction(null);
                    }}>
                    <Ionicons name="create-outline" size={20} color={colors.text} />
                    <Text style={styles.actionButtonText}>Edit message</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.actionButton} onPress={() => setMessageAction('delete-confirmation')}>
                  <Ionicons name="trash-outline" size={20} color={colors.red} />
                  <Text style={[styles.actionButtonText, styles.destructiveText]}>
                    {selectedMessage?.status === 'pending' || selectedMessage?.status === 'failed'
                      ? 'Delete message'
                      : 'Delete for everyone'}
                  </Text>
                </Pressable>
                <Pressable style={styles.cancelButton} onPress={() => setMessageAction(null)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.actionTitle}>
                  {selectedMessage?.status === 'pending' || selectedMessage?.status === 'failed'
                    ? 'Delete this message?'
                    : 'Delete for everyone?'}
                </Text>
                <Text style={styles.confirmText}>
                  {selectedMessage?.status === 'pending' || selectedMessage?.status === 'failed'
                    ? 'This message has not been sent and will be removed from this device.'
                    : 'This removes the message for everyone in the conversation.'}
                </Text>
                <Pressable
                  style={[styles.confirmButton, isSending && styles.sendDisabled]}
                  onPress={removeSelectedMessage}
                  disabled={isSending}>
                  <Text style={styles.confirmButtonText}>{isSending ? 'Deleting…' : 'Delete message'}</Text>
                </Pressable>
                <Pressable style={styles.cancelButton} onPress={() => setMessageAction('options')} disabled={isSending}>
                  <Text style={styles.cancelText}>Keep message</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
      <Modal
        visible={chatOptionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setChatOptionsVisible(false)}>
        <View style={styles.actionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setChatOptionsVisible(false)} />
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Chat options</Text>
            {participant ? (
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setChatOptionsVisible(false);
                  setNicknameDraft(participant.nickname ?? '');
                  setNicknameEditorVisible(true);
                }}>
                <Ionicons name="person-outline" size={20} color={colors.text} />
                <Text style={styles.actionButtonText}>Set nickname</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.actionButton}
              disabled={isDeletingConversation}
              onPress={() => {
                setChatOptionsVisible(false);
                Alert.alert(
                  'Delete conversation for you?',
                  'This removes the chat from your account. The other person keeps their copy.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete conversation', style: 'destructive', onPress: deleteConversation },
                  ],
                );
              }}>
              <Ionicons name="trash-outline" size={20} color={colors.red} />
              <Text style={[styles.actionButtonText, styles.destructiveText]}>Delete conversation</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setChatOptionsVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={nicknameEditorVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNicknameEditorVisible(false)}>
        <View style={styles.actionOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setNicknameEditorVisible(false)} />
          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Set a private nickname</Text>
            <Text style={styles.confirmText}>
              This name is only visible to you. Their username stays {participant?.username ?? 'unchanged'}.
            </Text>
            <TextInput
              value={nicknameDraft}
              onChangeText={setNicknameDraft}
              placeholder="Nickname"
              maxLength={32}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveNickname}
              style={styles.nicknameInput}
            />
            <Pressable style={styles.confirmButton} onPress={saveNickname}>
              <Text style={styles.confirmButtonText}>{nicknameDraft.trim() ? 'Save nickname' : 'Remove nickname'}</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setNicknameEditorVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function isTextMessage(text: string): boolean {
  try {
    return parseAttachmentEnvelope(text) === null;
  } catch {
    return false;
  }
}

function formatDuration(durationMillis: number): string {
  const totalSeconds = Math.floor(durationMillis / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (
    __DEV__ &&
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

function MessageContent({
  text,
  outgoing,
  colors,
}: {
  text: string;
  outgoing: boolean;
  colors: AppColors;
}) {
  const styles = createStyles(colors);
  try {
    const attachment = parseAttachmentEnvelope(text);
    if (attachment) return <AttachmentMessage envelope={attachment} colors={colors} outgoing={outgoing} />;
  } catch {
    return <Text style={styles.messageText}>Attachment unavailable</Text>;
  }
  return <Text style={[styles.messageText, outgoing && styles.outgoingText]}>{text}</Text>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 54, maxWidth: 245 },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  headerAvatarImage: { width: '100%', height: '100%' },
  headerAvatarText: { color: colors.onPrimary, fontSize: 12, fontWeight: '900' },
  headerCopy: { flex: 1, minWidth: 0 },
  headerName: { color: colors.text, fontSize: 13, fontWeight: '900' },
  headerMeta: { color: colors.muted, fontSize: 10, marginTop: 1 },
  headerBio: { color: colors.muted, fontSize: 10, marginTop: 1 },
  headerMenuButton: { padding: 8, marginRight: 2 },
  typingIndicator: { color: colors.muted, fontSize: 12, fontStyle: 'italic', paddingHorizontal: 18, paddingTop: 6 },
  typingError: { color: colors.muted, fontSize: 11, paddingHorizontal: 18, paddingTop: 6 },
  messages: { flexGrow: 1, padding: 16, justifyContent: 'flex-end' },
  empty: { alignItems: 'center', paddingBottom: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 8, maxWidth: 330 },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8 },
  outgoing: { alignSelf: 'flex-end', backgroundColor: colors.red },
  incoming: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  deletedBubble: { opacity: 0.8 },
  deletedMessage: { color: colors.muted, fontStyle: 'italic' },
  messageText: { color: colors.text },
  outgoingText: { color: colors.onPrimary },
  messageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, marginTop: 4 },
  messageTime: { color: colors.muted, fontSize: 10 },
  outgoingTime: { color: colors.onPrimary, opacity: 0.8 },
  participantInput: { height: 48, marginHorizontal: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 14, color: colors.text },
  attachments: { minHeight: 46, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.surface },
  attachmentTool: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingHorizontal: 6 },
  attachmentToolLabel: { color: colors.text, fontSize: 10, fontWeight: '700' },
  attachmentDraft: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border },
  attachmentDraftIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center' },
  attachmentDraftCopy: { flex: 1, minWidth: 0, gap: 2 },
  attachmentDraftName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  attachmentDraftHint: { color: colors.muted, fontSize: 10 },
  editingBanner: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: colors.surface },
  editingLabel: { color: colors.red, fontSize: 12, fontWeight: '800' },
  composerError: { color: colors.red, fontSize: 12, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: colors.surface },
  recording: { color: colors.red, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border },
  input: { flex: 1, minHeight: 42, maxHeight: 110, borderRadius: 21, backgroundColor: colors.background, paddingHorizontal: 14, paddingVertical: 10, color: colors.text },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.6 },
  actionOverlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.42)' },
  actionCard: { borderRadius: 22, padding: 18, backgroundColor: colors.surface, gap: 6 },
  actionTitle: { color: colors.text, fontSize: 17, fontWeight: '900', marginBottom: 6 },
  actionButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  actionButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  destructiveText: { color: colors.red },
  confirmText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  nicknameInput: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.background, paddingHorizontal: 14, color: colors.text, marginBottom: 8 },
  confirmButton: { minHeight: 46, borderRadius: 15, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  confirmButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: '900' },
  cancelButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
});
