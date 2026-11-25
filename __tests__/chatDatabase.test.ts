import { SQLiteDatabase } from 'expo-sqlite';
import {
  getLocalConversations,
  initializeChatDatabase,
  normalizeParticipantUsername,
  updateLocalConversationContact,
} from '../src/data/chatDatabase';

describe('normalizeParticipantUsername', () => {
  it('trims whitespace and accepts an optional @ prefix', () => {
    expect(normalizeParticipantUsername('  @SilentLion  ')).toBe('@SilentLion');
  });

  it('rejects usernames that do not meet the local username rules', () => {
    expect(normalizeParticipantUsername('ab')).toBeNull();
    expect(normalizeParticipantUsername('1stPlace')).toBeNull();
    expect(normalizeParticipantUsername('name with spaces')).toBeNull();
  });
});

describe('chat database contact details', () => {
  it('migrates version 3 databases to the nickname and display-name cache schema', async () => {
    const statements: string[] = [];
    const db = {
      execAsync: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
      getFirstAsync: jest.fn().mockResolvedValue({ user_version: 3 }),
      runAsync: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
      withTransactionAsync: jest.fn(async (callback: () => Promise<void>) => callback()),
    } as unknown as SQLiteDatabase;

    await initializeChatDatabase(db);

    expect(statements.some((sql) => sql.includes('ALTER TABLE conversations ADD COLUMN nickname TEXT'))).toBe(true);
    expect(statements).toContain('PRAGMA user_version = 4');
    expect(statements.some((sql) => sql.includes('ADD COLUMN participant_display_name'))).toBe(true);
    expect(statements).toContain('PRAGMA user_version = 5');
  });

  it('maps cached nicknames and profile details from local conversations', async () => {
    const db = {
      getAllAsync: jest.fn().mockResolvedValue([{
        id: 8,
        remote_id: 'remote-8',
        participant_id: 'contact-8',
        participant_public_key: 'key-8',
        participant_username: '@lion',
        participant_display_name: 'Lion Heart',
        nickname: 'Sunny',
        participantDisplayName: 'Lion Heart',
        participant_biography: 'Always exploring',
        participant_avatar_url: 'https://example.test/avatar',
        nickname_sync_pending: 0,
        last_message: 'Hello',
        updated_at: 20,
        disappearing_after_seconds: 0,
      }]),
    } as unknown as SQLiteDatabase;

    await expect(getLocalConversations(db)).resolves.toMatchObject([{
      nickname: 'Sunny',
      participantBiography: 'Always exploring',
      participantAvatarUrl: 'https://example.test/avatar',
      nicknameSyncPending: false,
    }]);
  });

  it('can clear a local nickname while queueing the remote update', async () => {
    const runAsync = jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 0 });
    const db = { runAsync } as unknown as SQLiteDatabase;

    await updateLocalConversationContact(db, 8, {
      nickname: null,
      displayName: 'Lion Heart',
      nicknameSyncPending: true,
    });

    expect(runAsync).toHaveBeenCalledWith(
      'UPDATE conversations SET nickname = ?, participant_display_name = ?, nickname_sync_pending = ? WHERE id = ?',
      null,
      'Lion Heart',
      1,
      8,
    );
  });
});
