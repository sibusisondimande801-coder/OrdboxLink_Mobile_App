import { DeviceEventEmitter } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { AccountProfile } from './accountService';
import { AttachmentKind, parseAttachmentEnvelope, uploadAttachment } from './attachmentService';
import {
  deleteLocalMessage,
  getPendingContactNicknames,
  getLocalConversations,
  getLocalMessages,
  getOrCreateConversation,
  linkLocalConversation,
  LocalMessage,
  markLocalMessageDeleted,
  saveLocalMessage,
  saveRemoteMessage,
  updateLocalMessage,
  updateLocalMessageContent,
  updateLocalConversationContact,
} from '../data/chatDatabase';
import { decryptMessage, encryptMessage, getOrCreateDeviceIdentity } from './messageCrypto';
import { getSupabaseClient } from './supabase';

export const MESSAGE_RECEIVED_EVENT = 'mzansilink:message-received';

export async function hideConversationForMe(remoteConversationId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Sign in to delete this conversation.');

  const { error } = await supabase.from('conversation_hides').upsert(
    {
      user_id: userData.user.id,
      conversation_id: remoteConversationId,
      hidden_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,conversation_id' },
  );
  if (error) throw error;
}

export interface RemoteMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  nonce: string;
  sender_ciphertext: string;
  recipient_ciphertext: string;
  created_at: string;
  expires_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
}

export function filterMessagesAfterConversationHide(
  messages: RemoteMessage[],
  hiddenAt: string | undefined,
): RemoteMessage[] {
  if (hiddenAt === undefined) return messages;
  const hiddenTimestamp = Date.parse(hiddenAt);
  if (!Number.isFinite(hiddenTimestamp)) {
    throw new Error('The saved conversation deletion time is invalid.');
  }
  return messages.filter((message) => Date.parse(message.created_at) > hiddenTimestamp);
}

function isTemporaryNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  return typeof error.status === 'number' && error.status >= 500;
}

async function getRemoteConversation(
  currentUserId: string,
  participantId: string,
  existingRemoteId: string | null,
): Promise<string> {
  if (existingRemoteId) return existingRemoteId;

  const supabase = getSupabaseClient();
  const [memberA, memberB] = [currentUserId, participantId].sort();
  const existing = await supabase
    .from('conversations')
    .select('id')
    .eq('member_a', memberA)
    .eq('member_b', memberB)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const created = await supabase
    .from('conversations')
    .insert({ member_a: memberA, member_b: memberB, created_by: currentUserId })
    .select('id')
    .single();
  if (!created.error) return created.data.id;
  if (created.error.code !== '23505') throw created.error;

  const concurrent = await supabase
    .from('conversations')
    .select('id')
    .eq('member_a', memberA)
    .eq('member_b', memberB)
    .single();
  if (concurrent.error) throw concurrent.error;
  return concurrent.data.id;
}

async function deliverPendingMessage(
  db: SQLiteDatabase,
  profile: AccountProfile,
  conversationId: number,
  messageId: number,
  participantId: string,
  remoteConversationId: string | null,
): Promise<string | null> {
  const messages = await getLocalMessages(db, conversationId);
  const message = messages.find((item) => item.id === messageId);
  if (!message || message.status !== 'pending') return null;
  if (message.expiresAt !== null && message.expiresAt <= Date.now()) {
    await updateLocalMessage(db, message.id, { status: 'failed' });
    return null;
  }
  if (!message.nonce || !message.senderCiphertext || !message.recipientCiphertext) {
    throw new Error('The saved message is missing its encrypted payload.');
  }

  const network = await NetInfo.fetch();
  if (!network.isConnected || network.isInternetReachable === false) return null;
  let remoteId: string;
  try {
    remoteId = await getRemoteConversation(profile.id, participantId, remoteConversationId);
  } catch (error) {
    if (!isTemporaryNetworkError(error)) {
      await updateLocalMessage(db, message.id, { status: 'failed' });
    }
    throw error;
  }
  const supabase = getSupabaseClient();
  const inserted = await supabase
    .from('messages')
    .upsert({
      id: message.remoteId,
      conversation_id: remoteId,
      sender_id: profile.id,
      recipient_id: participantId,
      nonce: message.nonce,
      sender_ciphertext: message.senderCiphertext,
      recipient_ciphertext: message.recipientCiphertext,
      edited_at: message.editedAt === null ? null : new Date(message.editedAt).toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: true });
  if (inserted.error) {
    if (!isTemporaryNetworkError(inserted.error)) {
      await updateLocalMessage(db, message.id, { status: 'failed' });
    }
    throw inserted.error;
  }
  const result = await supabase
    .from('messages')
    .select('id, created_at, expires_at')
    .eq('id', message.remoteId)
    .single();
  if (result.error) {
    if (!isTemporaryNetworkError(result.error)) {
      await updateLocalMessage(db, message.id, { status: 'failed' });
    }
    throw result.error;
  }

  await linkLocalConversation(db, conversationId, remoteId);
  await updateLocalMessage(db, message.id, { remoteId: result.data.id, status: 'sent' });
  DeviceEventEmitter.emit(MESSAGE_RECEIVED_EVENT, { conversationId });
  const { data: recipient, error: recipientError } = await supabase
    .from('profiles')
    .select('notifications_enabled')
    .eq('id', participantId)
    .maybeSingle();
  if (recipientError) {
    return `The message was sent, but notification preferences could not be checked: ${recipientError.message}`;
  }
  if (!recipient?.notifications_enabled) return null;

  let notificationFailure: string | null = null;
  try {
    const { error: pushError } = await supabase.functions.invoke('send-message-push', {
      body: { messageId: message.remoteId },
    });
    if (pushError) notificationFailure = pushError.message;
  } catch (error) {
    notificationFailure = error instanceof Error ? error.message : 'The push alert could not be sent.';
  }
  if (notificationFailure) {
    return notificationFailure;
  }
  return null;
}

async function sendEncryptedPayload(
  db: SQLiteDatabase,
  profile: AccountProfile,
  participant: Pick<
    AccountProfile,
    'id' | 'username' | 'displayName' | 'publicKey' | 'disappearingAfterSeconds'
  >,
  text: string,
  remoteConversationId: string | null,
): Promise<{
  conversationId: number;
  messageId: number;
  queued: boolean;
  failure: string | null;
  notificationFailure: string | null;
}> {
  if (participant.id === profile.id) {
    throw new Error('You cannot start a conversation with your own account.');
  }
  if (!participant.publicKey) throw new Error('This user has not set up an encryption key.');

  const conversationId = await getOrCreateConversation(
    db,
    participant.username,
    participant.id,
    participant.publicKey,
    remoteConversationId,
    profile.disappearingAfterSeconds,
    participant.displayName,
  );
  const identity = await getOrCreateDeviceIdentity(profile.id, profile.publicKey);
  const encrypted = encryptMessage(text, identity, participant.publicKey);
  const expiresAt =
    profile.disappearingAfterSeconds > 0
      ? Date.now() + profile.disappearingAfterSeconds * 1000
      : null;
  const saved = await saveLocalMessage(db, conversationId, {
    remoteId: Crypto.randomUUID(),
    senderId: profile.id,
    text,
    ...encrypted,
    expiresAt,
  });

  let failure: string | null = null;
  let notificationFailure: string | null = null;
  try {
    notificationFailure = await deliverPendingMessage(
      db,
      profile,
      conversationId,
      saved.id,
      participant.id,
      remoteConversationId,
    );
  } catch (error) {
    DeviceEventEmitter.emit(MESSAGE_RECEIVED_EVENT, { conversationId });
    const savedMessage = (await getLocalMessages(db, conversationId)).find((item) => item.id === saved.id);
    if (savedMessage?.status === 'sent') {
      notificationFailure = error instanceof Error ? error.message : 'The push alert could not be sent.';
    } else {
      failure = error instanceof Error ? error.message : 'The message could not be sent.';
    }
  }
  DeviceEventEmitter.emit(MESSAGE_RECEIVED_EVENT, { conversationId });
  return {
    conversationId,
    messageId: saved.id,
    queued: (await getLocalMessages(db, conversationId)).find((item) => item.id === saved.id)?.status !== 'sent',
    failure,
    notificationFailure,
  };
}

export async function sendEncryptedMessage(
  db: SQLiteDatabase,
  profile: AccountProfile,
  participant: Pick<
    AccountProfile,
    'id' | 'username' | 'displayName' | 'publicKey' | 'disappearingAfterSeconds'
  >,
  text: string,
): Promise<{
  conversationId: number;
  messageId: number;
  queued: boolean;
  failure: string | null;
  notificationFailure: string | null;
}> {
  return sendEncryptedPayload(db, profile, participant, text, null);
}

export async function editEncryptedMessage(
  db: SQLiteDatabase,
  profile: AccountProfile,
  participant: Pick<AccountProfile, 'id' | 'publicKey'>,
  message: LocalMessage,
  text: string,
): Promise<void> {
  const updatedText = text.trim();
  if (!updatedText) throw new Error('Enter a message before saving.');
  if (message.senderId !== profile.id || message.deletedAt !== null) {
    throw new Error('Only your active messages can be edited.');
  }
  if (parseAttachmentEnvelope(message.text)) {
    throw new Error('Photo, voice, and document messages cannot be edited.');
  }
  if (
    message.status !== 'pending' &&
    message.status !== 'sent' &&
    message.status !== 'received'
  ) {
    throw new Error('This message cannot be edited until it has been sent.');
  }
  if (!participant.publicKey) throw new Error('This user has not set up an encryption key.');

  const identity = await getOrCreateDeviceIdentity(profile.id, profile.publicKey);
  const encrypted = encryptMessage(updatedText, identity, participant.publicKey);
  const editedAt = Date.now();

  if (message.status !== 'pending') {
    if (!message.remoteId) throw new Error('The sent message is missing its remote ID.');
    const { data, error } = await getSupabaseClient()
      .from('messages')
      .update({
        nonce: encrypted.nonce,
        sender_ciphertext: encrypted.senderCiphertext,
        recipient_ciphertext: encrypted.recipientCiphertext,
        edited_at: new Date(editedAt).toISOString(),
      })
      .eq('id', message.remoteId)
      .eq('sender_id', profile.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This message may have been deleted or expired.');
  }

  await updateLocalMessageContent(
    db,
    message.id,
    { text: updatedText, ...encrypted },
    editedAt,
  );
  DeviceEventEmitter.emit(MESSAGE_RECEIVED_EVENT, { conversationId: message.conversationId });
}

export async function deleteEncryptedMessage(
  db: SQLiteDatabase,
  profile: AccountProfile,
  message: LocalMessage,
): Promise<void> {
  if (message.senderId !== profile.id || message.deletedAt !== null) {
    throw new Error('Only your active messages can be deleted for everyone.');
  }

  if (message.status === 'pending' || message.status === 'failed') {
    await deleteLocalMessage(db, message.id);
  } else {
    if (!message.remoteId) throw new Error('The sent message is missing its remote ID.');
    const deletedAt = Date.now();
    const { data, error } = await getSupabaseClient()
      .from('messages')
      .update({
        nonce: '',
        sender_ciphertext: '',
        recipient_ciphertext: '',
        deleted_at: new Date(deletedAt).toISOString(),
      })
      .eq('id', message.remoteId)
      .eq('sender_id', profile.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This message may have already been deleted or expired.');
    await markLocalMessageDeleted(db, message.id, deletedAt);
  }

  DeviceEventEmitter.emit(MESSAGE_RECEIVED_EVENT, { conversationId: message.conversationId });
}

export async function sendEncryptedAttachment(
  db: SQLiteDatabase,
  profile: AccountProfile,
  participant: Pick<
    AccountProfile,
    'id' | 'username' | 'displayName' | 'publicKey' | 'disappearingAfterSeconds'
  >,
  kind: AttachmentKind,
  file: Blob,
  name: string,
  mimeType: string,
  caption?: string,
  durationMillis?: number,
): Promise<{
  conversationId: number;
  messageId: number;
  queued: boolean;
  failure: string | null;
  notificationFailure: string | null;
}> {
  const network = await NetInfo.fetch();
  if (!network.isConnected || network.isInternetReachable === false) {
    throw new Error('Connect to the internet to send an attachment.');
  }
  if (participant.id === profile.id) {
    throw new Error('You cannot start a conversation with your own account.');
  }
  if (!participant.publicKey) throw new Error('This user has not set up an encryption key.');

  const remoteConversationId = await getRemoteConversation(profile.id, participant.id, null);
  const envelope = await uploadAttachment(
    remoteConversationId,
    kind,
    file,
    name,
    mimeType,
    caption,
    durationMillis,
  );
  return sendEncryptedPayload(
    db,
    profile,
    participant,
    JSON.stringify(envelope),
    remoteConversationId,
  );
}

async function storeRemoteMessage(
  db: SQLiteDatabase,
  profile: AccountProfile,
  message: RemoteMessage,
  participantId: string,
  participantUsername: string,
  participantDisplayName: string,
  participantPublicKey: string,
  remoteConversationId: string,
): Promise<{ text: string; username: string; inserted: boolean }> {
  const localConversationId = await getOrCreateConversation(
    db,
    participantUsername,
    participantId,
    participantPublicKey,
    remoteConversationId,
    profile.disappearingAfterSeconds,
    participantDisplayName,
  );
  const deletedAt = message.deleted_at ? Date.parse(message.deleted_at) : null;
  const text = deletedAt
    ? 'Message deleted'
    : decryptMessage(
        message.sender_id === profile.id ? message.sender_ciphertext : message.recipient_ciphertext,
        message.nonce,
        message.sender_id === profile.id ? profile.publicKey : participantPublicKey,
        (await getOrCreateDeviceIdentity(profile.id, profile.publicKey)).secretKey,
      );
  const inserted = await saveRemoteMessage(db, localConversationId, {
    remoteId: message.id,
    senderId: message.sender_id,
    text,
    nonce: message.nonce,
    senderCiphertext: message.sender_ciphertext,
    recipientCiphertext: message.recipient_ciphertext,
    createdAt: Date.parse(message.created_at),
    expiresAt: message.expires_at ? Date.parse(message.expires_at) : null,
    editedAt: message.edited_at ? Date.parse(message.edited_at) : null,
    deletedAt,
  });
  DeviceEventEmitter.emit(MESSAGE_RECEIVED_EVENT, { conversationId: localConversationId });
  return { text, username: participantUsername, inserted };
}

export async function synchronizeMessages(
  db: SQLiteDatabase,
  profile: AccountProfile,
): Promise<string[]> {
  const notificationFailures: string[] = [];
  const supabase = getSupabaseClient();
  const pendingNicknames = await getPendingContactNicknames(db);
  if (pendingNicknames.length > 0) {
    const { updateSavedContactNickname } = await import('./accountService');
    for (const contact of pendingNicknames) {
      await updateSavedContactNickname(
        { id: contact.participantId, username: contact.participantUsername },
        contact.nickname,
      );
      await updateLocalConversationContact(db, contact.conversationId, { nicknameSyncPending: false });
    }
  }

  const { data: hiddenConversations, error: hiddenError } = await supabase
    .from('conversation_hides')
    .select('conversation_id, hidden_at')
    .eq('user_id', profile.id);
  if (hiddenError) throw hiddenError;
  const hiddenAtByConversation = new Map(
    (hiddenConversations ?? []).map((hidden) => [hidden.conversation_id, hidden.hidden_at]),
  );

  const { data: remoteConversations, error: conversationError } = await supabase
    .from('conversations')
    .select('id, member_a, member_b')
    .or(`member_a.eq.${profile.id},member_b.eq.${profile.id}`);
  if (conversationError) throw conversationError;

  for (const conversation of remoteConversations ?? []) {
    const participantId =
      conversation.member_a === profile.id ? conversation.member_b : conversation.member_a;
    const { data: participant, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name, public_key')
      .eq('id', participantId)
      .single();
    if (profileError) throw profileError;
    if (!participant.public_key) continue;

    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_id, recipient_id, nonce, sender_ciphertext, recipient_ciphertext, created_at, expires_at, edited_at, deleted_at',
      )
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true });
    if (messagesError) throw messagesError;

    const visibleMessages = filterMessagesAfterConversationHide(
      (messages ?? []) as RemoteMessage[],
      hiddenAtByConversation.get(conversation.id),
    );
    for (const message of visibleMessages) {
      await storeRemoteMessage(
        db,
        profile,
        message as RemoteMessage,
        participantId,
        `@${participant.username}`,
        participant.display_name?.trim() ?? '',
        participant.public_key,
        conversation.id,
      );
    }
  }

  const localConversations = await getLocalConversations(db);
  for (const conversation of localConversations) {
    if (!conversation.participantId) continue;
    const messages = await getLocalMessages(db, conversation.id);
    for (const message of messages) {
      if (message.status !== 'pending') continue;
      const notificationFailure = await deliverPendingMessage(
        db,
        profile,
        conversation.id,
        message.id,
        conversation.participantId,
        conversation.remoteId,
      ).catch((error: unknown) => {
        if (isTemporaryNetworkError(error)) throw error;
        return null;
      });
      if (notificationFailure) notificationFailures.push(notificationFailure);
    }
  }
  return notificationFailures;
}

export async function receiveEncryptedMessage(
  db: SQLiteDatabase,
  profile: AccountProfile,
  message: RemoteMessage,
): Promise<{ text: string; username: string; inserted: boolean } | null> {
  const supabase = getSupabaseClient();
  const { data: hidden, error: hiddenError } = await supabase
    .from('conversation_hides')
    .select('hidden_at')
    .eq('user_id', profile.id)
    .eq('conversation_id', message.conversation_id)
    .maybeSingle();
  if (hiddenError) throw hiddenError;
  if (hidden && Date.parse(message.created_at) <= Date.parse(hidden.hidden_at)) return null;

  const { data: participant, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, public_key')
    .eq('id', message.sender_id)
    .single();
  if (error) throw error;
  if (!participant.public_key) throw new Error('The sender encryption key is unavailable.');

  return storeRemoteMessage(
    db,
    profile,
    message,
    participant.id,
    `@${participant.username}`,
    participant.display_name?.trim() ?? '',
    participant.public_key,
    message.conversation_id,
  );
}

export function createMessageSubscription(
  profile: AccountProfile,
  onMessage: (message: RemoteMessage) => void,
  onStatus: (status: string) => void,
) {
  return getSupabaseClient()
    .channel(`messages:${profile.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `recipient_id=eq.${profile.id}`,
      },
      (payload) => onMessage(payload.new as RemoteMessage),
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${profile.id}`,
      },
      (payload) => onMessage(payload.new as RemoteMessage),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `recipient_id=eq.${profile.id}`,
      },
      (payload) => onMessage(payload.new as RemoteMessage),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${profile.id}`,
      },
      (payload) => onMessage(payload.new as RemoteMessage),
    )
    .subscribe(onStatus);
}

export function createTypingChannel(
  currentUserId: string,
  participantId: string,
  onTyping: (isTyping: boolean) => void,
): RealtimeChannel {
  const topic = `typing:${[currentUserId, participantId].sort().join(':')}`;
  return getSupabaseClient()
    .channel(topic, {
      config: {
        private: true,
        broadcast: { ack: false, self: false },
      },
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const event = payload as { userId?: unknown; isTyping?: unknown };
      if (event.userId === participantId && typeof event.isTyping === 'boolean') {
        onTyping(event.isTyping);
      }
    });
}
