import type { SQLiteDatabase } from 'expo-sqlite';

export interface LocalMessage {
  id: number;
  conversationId: number;
  remoteId: string | null;
  senderId: string | null;
  text: string;
  nonce: string | null;
  senderCiphertext: string | null;
  recipientCiphertext: string | null;
  status: 'local' | 'pending' | 'sent' | 'received' | 'failed';
  createdAt: number;
  expiresAt: number | null;
  editedAt: number | null;
  deletedAt: number | null;
}

export interface LocalConversation {
  id: number;
  remoteId: string | null;
  participantId: string | null;
  participantPublicKey: string | null;
  participantUsername: string;
  participantDisplayName: string;
  nickname: string | null;
  participantBiography: string;
  participantAvatarUrl: string | null;
  nicknameSyncPending: boolean;
  lastMessage: string | null;
  updatedAt: number;
  disappearingAfterSeconds: number;
}

export interface PendingContactNickname {
  conversationId: number;
  participantId: string;
  participantUsername: string;
  nickname: string | null;
}

export interface NewLocalMessage {
  remoteId: string;
  senderId: string;
  text: string;
  nonce: string;
  senderCiphertext: string;
  recipientCiphertext: string;
  expiresAt: number | null;
}

export interface RemoteConversationMessage {
  remoteId: string;
  senderId: string;
  text: string;
  nonce: string;
  senderCiphertext: string;
  recipientCiphertext: string;
  createdAt: number;
  expiresAt: number | null;
  editedAt: number | null;
  deletedAt: number | null;
}

export function normalizeParticipantUsername(input: string): string | null {
  const username = input.trim().replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(username)) {
    return null;
  }
  return `@${username}`;
}

export async function initializeChatDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON');
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = version?.user_version ?? 0;
  if (currentVersion > 5) {
    throw new Error('This app version cannot open the local message database.');
  }

  if (currentVersion < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          participant_username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          body TEXT NOT NULL CHECK(length(body) > 0),
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS messages_conversation_id_id
          ON messages(conversation_id, id);
      `);
      await db.execAsync('PRAGMA user_version = 1');
    });
  }

  if (currentVersion < 2) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        ALTER TABLE conversations ADD COLUMN remote_id TEXT;
        ALTER TABLE conversations ADD COLUMN participant_id TEXT;
        ALTER TABLE conversations ADD COLUMN participant_public_key TEXT;
        ALTER TABLE conversations ADD COLUMN disappearing_after_seconds INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE messages ADD COLUMN remote_id TEXT;
        ALTER TABLE messages ADD COLUMN sender_id TEXT;
        ALTER TABLE messages ADD COLUMN nonce TEXT;
        ALTER TABLE messages ADD COLUMN sender_ciphertext TEXT;
        ALTER TABLE messages ADD COLUMN recipient_ciphertext TEXT;
        ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'local';
        ALTER TABLE messages ADD COLUMN expires_at INTEGER;
        CREATE UNIQUE INDEX IF NOT EXISTS conversations_remote_id_idx
          ON conversations(remote_id) WHERE remote_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS conversations_participant_id_idx
          ON conversations(participant_id) WHERE participant_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS messages_remote_id_idx
          ON messages(remote_id) WHERE remote_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS messages_status_idx ON messages(status);
      `);
      await db.execAsync('PRAGMA user_version = 2');
    });
  }

  if (currentVersion < 3) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        ALTER TABLE messages ADD COLUMN edited_at INTEGER;
        ALTER TABLE messages ADD COLUMN deleted_at INTEGER;
      `);
      await db.execAsync('PRAGMA user_version = 3');
    });
  }

  if (currentVersion < 4) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        ALTER TABLE conversations ADD COLUMN nickname TEXT;
        ALTER TABLE conversations ADD COLUMN participant_biography TEXT NOT NULL DEFAULT '';
        ALTER TABLE conversations ADD COLUMN participant_avatar_url TEXT;
        ALTER TABLE conversations ADD COLUMN nickname_sync_pending INTEGER NOT NULL DEFAULT 0;
      `);
      await db.execAsync('PRAGMA user_version = 4');
    });
  }

  if (currentVersion < 5) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        ALTER TABLE conversations ADD COLUMN participant_display_name TEXT NOT NULL DEFAULT '';
      `);
      await db.execAsync('PRAGMA user_version = 5');
    });
  }

  await db.runAsync(
    'DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?',
    Date.now(),
  );
}

export async function getOrCreateConversation(
  db: SQLiteDatabase,
  participantUsername: string,
  participantId: string | null = null,
  participantPublicKey: string | null = null,
  remoteId: string | null = null,
  disappearingAfterSeconds = 0,
  participantDisplayName: string | null = null,
): Promise<number> {
  const now = Date.now();
  let conversation = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM conversations
     WHERE (? IS NOT NULL AND remote_id = ?)
        OR (? IS NOT NULL AND participant_id = ?)
        OR participant_username = ? COLLATE NOCASE
     ORDER BY CASE WHEN remote_id = ? THEN 0 WHEN participant_id = ? THEN 1 ELSE 2 END
     LIMIT 1`,
    remoteId,
    remoteId,
    participantId,
    participantId,
    participantUsername,
    remoteId,
    participantId,
  );

  if (!conversation) {
    const result = await db.runAsync(
      `INSERT INTO conversations (
        participant_username, participant_id, participant_public_key, remote_id,
        disappearing_after_seconds, participant_display_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      participantUsername,
      participantId,
      participantPublicKey,
      remoteId,
      disappearingAfterSeconds,
      participantDisplayName ?? '',
      now,
      now,
    );
    conversation = { id: result.lastInsertRowId };
  } else {
    await db.runAsync(
      `UPDATE conversations SET participant_username = ?, participant_id = ?,
        participant_public_key = ?, remote_id = ?, disappearing_after_seconds = ?,
        participant_display_name = CASE WHEN ? IS NULL THEN participant_display_name ELSE ? END
       WHERE id = ?`,
      participantUsername,
      participantId,
      participantPublicKey,
      remoteId,
      disappearingAfterSeconds,
      participantDisplayName,
      participantDisplayName,
      conversation.id,
    );
  }

  if (!conversation) {
    throw new Error('The local conversation could not be created.');
  }
  return conversation.id;
}

export async function saveLocalMessage(
  db: SQLiteDatabase,
  conversationId: number,
  message: NewLocalMessage,
): Promise<LocalMessage> {
  const createdAt = Date.now();
  let messageId = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `INSERT INTO messages (
        remote_id, conversation_id, body, sender_id, nonce, sender_ciphertext,
        recipient_ciphertext, status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      message.remoteId,
      conversationId,
      message.text,
      message.senderId,
      message.nonce,
      message.senderCiphertext,
      message.recipientCiphertext,
      message.expiresAt,
      createdAt,
    );
    messageId = result.lastInsertRowId;
    await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', createdAt, conversationId);
  });
  return {
    id: messageId,
    conversationId,
    remoteId: message.remoteId,
    senderId: message.senderId,
    text: message.text,
    nonce: message.nonce,
    senderCiphertext: message.senderCiphertext,
    recipientCiphertext: message.recipientCiphertext,
    status: 'pending',
    createdAt,
    expiresAt: message.expiresAt,
    editedAt: null,
    deletedAt: null,
  };
}

export async function getLocalMessages(
  db: SQLiteDatabase,
  conversationId: number,
): Promise<LocalMessage[]> {
  const rows = await db.getAllAsync<{
    id: number;
    conversation_id: number;
    remote_id: string | null;
    sender_id: string | null;
    body: string;
    nonce: string | null;
    sender_ciphertext: string | null;
    recipient_ciphertext: string | null;
    status: LocalMessage['status'];
    created_at: number;
    expires_at: number | null;
    edited_at: number | null;
    deleted_at: number | null;
  }>(
    `SELECT id, conversation_id, remote_id, sender_id, body, nonce,
            sender_ciphertext, recipient_ciphertext, status, created_at, expires_at,
            edited_at, deleted_at
     FROM messages
     WHERE conversation_id = ?
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY id ASC`,
    conversationId,
    Date.now(),
  );
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    remoteId: row.remote_id,
    senderId: row.sender_id,
    text: row.body,
    nonce: row.nonce,
    senderCiphertext: row.sender_ciphertext,
    recipientCiphertext: row.recipient_ciphertext,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  }));
}

export async function getLocalConversations(db: SQLiteDatabase): Promise<LocalConversation[]> {
  const rows = await db.getAllAsync<{
    id: number;
    remote_id: string | null;
    participant_id: string | null;
    participant_public_key: string | null;
    participant_username: string;
    participant_display_name: string;
    nickname: string | null;
    participant_biography: string;
    participant_avatar_url: string | null;
    nickname_sync_pending: number;
    last_message: string | null;
    updated_at: number;
    disappearing_after_seconds: number;
  }>(`
    SELECT c.id, c.remote_id, c.participant_id, c.participant_public_key,
           c.participant_username, c.participant_display_name, c.nickname, c.participant_biography,
           c.participant_avatar_url, c.nickname_sync_pending,
           m.body AS last_message, c.updated_at,
           c.disappearing_after_seconds
    FROM conversations c
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages
      WHERE conversation_id = c.id
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY id DESC
      LIMIT 1
    )
    ORDER BY c.updated_at DESC, c.id DESC
  `, Date.now());
  return rows.map((row) => ({
    id: row.id,
    remoteId: row.remote_id,
    participantId: row.participant_id,
    participantPublicKey: row.participant_public_key,
    participantUsername: row.participant_username,
    participantDisplayName: row.participant_display_name,
    nickname: row.nickname,
    participantBiography: row.participant_biography,
    participantAvatarUrl: row.participant_avatar_url,
    nicknameSyncPending: row.nickname_sync_pending === 1,
    lastMessage: row.last_message,
    updatedAt: row.updated_at,
    disappearingAfterSeconds: row.disappearing_after_seconds,
  }));
}

export async function updateLocalConversationContact(
  db: SQLiteDatabase,
  conversationId: number,
  updates: {
    nickname?: string | null;
    displayName?: string;
    biography?: string;
    avatarUrl?: string | null;
    nicknameSyncPending?: boolean;
  },
): Promise<void> {
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  if ('nickname' in updates) {
    assignments.push('nickname = ?');
    values.push(updates.nickname ?? null);
  }
  if (updates.displayName !== undefined) {
    assignments.push('participant_display_name = ?');
    values.push(updates.displayName);
  }
  if (updates.biography !== undefined) {
    assignments.push('participant_biography = ?');
    values.push(updates.biography);
  }
  if ('avatarUrl' in updates) {
    assignments.push('participant_avatar_url = ?');
    values.push(updates.avatarUrl ?? null);
  }
  if (updates.nicknameSyncPending !== undefined) {
    assignments.push('nickname_sync_pending = ?');
    values.push(updates.nicknameSyncPending ? 1 : 0);
  }
  if (assignments.length === 0) return;
  await db.runAsync(
    `UPDATE conversations SET ${assignments.join(', ')} WHERE id = ?`,
    ...values,
    conversationId,
  );
}

export async function getPendingContactNicknames(db: SQLiteDatabase): Promise<PendingContactNickname[]> {
  const rows = await db.getAllAsync<{
    id: number;
    participant_id: string;
    participant_username: string;
    nickname: string | null;
  }>(`
    SELECT id, participant_id, participant_username, nickname
    FROM conversations
    WHERE participant_id IS NOT NULL AND nickname_sync_pending = 1
  `);
  return rows.map((row) => ({
    conversationId: row.id,
    participantId: row.participant_id,
    participantUsername: row.participant_username,
    nickname: row.nickname,
  }));
}

export async function deleteLocalConversation(db: SQLiteDatabase, conversationId: number): Promise<void> {
  await db.runAsync('DELETE FROM conversations WHERE id = ?', conversationId);
}

export async function updateLocalMessage(
  db: SQLiteDatabase,
  localId: number,
  updates: { remoteId?: string; status: LocalMessage['status'] },
): Promise<void> {
  await db.runAsync(
    `UPDATE messages SET remote_id = COALESCE(?, remote_id), status = ? WHERE id = ?`,
    updates.remoteId ?? null,
    updates.status,
    localId,
  );
}

export async function updateLocalMessageContent(
  db: SQLiteDatabase,
  localId: number,
  message: Pick<NewLocalMessage, 'text' | 'nonce' | 'senderCiphertext' | 'recipientCiphertext'>,
  editedAt: number,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `UPDATE messages SET body = ?, nonce = ?, sender_ciphertext = ?,
        recipient_ciphertext = ?, edited_at = ?, deleted_at = NULL
       WHERE id = ? AND deleted_at IS NULL`,
      message.text,
      message.nonce,
      message.senderCiphertext,
      message.recipientCiphertext,
      editedAt,
      localId,
    );
    if (result.changes === 0) throw new Error('This message may have already been deleted.');
    await db.runAsync(
      `UPDATE conversations SET updated_at = MAX(updated_at, ?)
       WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)`,
      editedAt,
      localId,
    );
  });
}

export async function markLocalMessageDeleted(
  db: SQLiteDatabase,
  localId: number,
  deletedAt: number,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE messages SET body = 'Message deleted', nonce = '',
        sender_ciphertext = '', recipient_ciphertext = '', deleted_at = ?
       WHERE id = ?`,
      deletedAt,
      localId,
    );
    await db.runAsync(
      `UPDATE conversations SET updated_at = MAX(updated_at, ?)
       WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)`,
      deletedAt,
      localId,
    );
  });
}

export async function deleteLocalMessage(db: SQLiteDatabase, localId: number): Promise<void> {
  await db.runAsync('DELETE FROM messages WHERE id = ?', localId);
}

export async function linkLocalConversation(
  db: SQLiteDatabase,
  conversationId: number,
  remoteId: string,
): Promise<void> {
  await db.runAsync(
    'UPDATE conversations SET remote_id = ? WHERE id = ?',
    remoteId,
    conversationId,
  );
}

export async function saveRemoteMessage(
  db: SQLiteDatabase,
  conversationId: number,
  message: RemoteConversationMessage,
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO messages (
      remote_id, conversation_id, sender_id, body, nonce, sender_ciphertext,
      recipient_ciphertext, status, expires_at, created_at, edited_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?)
    ON CONFLICT(remote_id) WHERE remote_id IS NOT NULL DO UPDATE SET
      body = excluded.body,
      nonce = excluded.nonce,
      sender_ciphertext = excluded.sender_ciphertext,
      recipient_ciphertext = excluded.recipient_ciphertext,
      edited_at = excluded.edited_at,
      deleted_at = excluded.deleted_at`,
    message.remoteId,
    conversationId,
    message.senderId,
    message.text,
    message.nonce,
    message.senderCiphertext,
    message.recipientCiphertext,
    message.expiresAt,
    message.createdAt,
    message.editedAt,
    message.deletedAt,
  );
  await db.runAsync(
    'UPDATE conversations SET updated_at = MAX(updated_at, ?) WHERE id = ?',
    message.createdAt,
    conversationId,
  );
  return result.changes > 0;
}

export async function clearLocalChatHistory(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM messages');
    await db.runAsync('DELETE FROM conversations');
  });
}
