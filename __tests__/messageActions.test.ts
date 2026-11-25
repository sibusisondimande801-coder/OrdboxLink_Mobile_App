import { SQLiteDatabase } from 'expo-sqlite';
import { LocalMessage } from '../src/data/chatDatabase';
import { AccountProfile } from '../src/services/accountService';
import {
  deleteEncryptedMessage,
  editEncryptedMessage,
  filterMessagesAfterConversationHide,
  RemoteMessage,
} from '../src/services/messagingService';
import { deleteLocalMessage, updateLocalMessageContent } from '../src/data/chatDatabase';
import { encryptMessage, getOrCreateDeviceIdentity } from '../src/services/messageCrypto';

jest.mock('../src/data/chatDatabase', () => ({
  deleteLocalMessage: jest.fn(),
  getLocalConversations: jest.fn(),
  getLocalMessages: jest.fn(),
  getOrCreateConversation: jest.fn(),
  linkLocalConversation: jest.fn(),
  markLocalMessageDeleted: jest.fn(),
  saveLocalMessage: jest.fn(),
  saveRemoteMessage: jest.fn(),
  updateLocalMessage: jest.fn(),
  updateLocalMessageContent: jest.fn(),
}));

jest.mock('../src/services/messageCrypto', () => ({
  decryptMessage: jest.fn(),
  encryptMessage: jest.fn(),
  getOrCreateDeviceIdentity: jest.fn(),
}));

jest.mock('../src/services/attachmentService', () => ({
  parseAttachmentEnvelope: jest.fn(() => null),
  uploadAttachment: jest.fn(),
}));

jest.mock('../src/services/supabase', () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn() },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}));

const profile: AccountProfile = {
  id: 'sender-id',
  email: 'sender@example.test',
  username: '@sender',
  displayName: '',
  biography: '',
  avatarPath: null,
  avatarUrl: null,
  publicKey: 'sender-public-key',
  themePalette: 'savanna',
  discoverable: true,
  disappearingAfterSeconds: 0,
  notificationsEnabled: true,
  showNotificationPreviews: false,
  biometricLock: false,
};

const localMessage: LocalMessage = {
  id: 21,
  conversationId: 7,
  remoteId: 'message-id',
  senderId: profile.id,
  text: 'Original message',
  nonce: 'old-nonce',
  senderCiphertext: 'old-sender-ciphertext',
  recipientCiphertext: 'old-recipient-ciphertext',
  status: 'pending',
  createdAt: 1,
  expiresAt: null,
  editedAt: null,
  deletedAt: null,
};

const remoteMessageAt = (created_at: string): RemoteMessage => ({
  id: created_at,
  conversation_id: 'conversation-id',
  sender_id: 'sender-id',
  recipient_id: 'recipient-id',
  nonce: 'nonce',
  sender_ciphertext: 'sender-ciphertext',
  recipient_ciphertext: 'recipient-ciphertext',
  created_at,
  expires_at: null,
  edited_at: null,
  deleted_at: null,
});

describe('offline message actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('per-user conversation deletion', () => {
    it('keeps new messages but filters history from before deletion', () => {
      const oldMessage = remoteMessageAt('2026-03-01T10:00:00.000Z');
      const newMessage = remoteMessageAt('2026-03-01T11:00:00.000Z');

      expect(
        filterMessagesAfterConversationHide(
          [oldMessage, newMessage],
          '2026-03-01T10:30:00.000Z',
        ),
      ).toEqual([newMessage]);
    });

    it('keeps all messages when the conversation was never hidden', () => {
      const messages = [remoteMessageAt('2026-03-01T10:00:00.000Z')];

      expect(filterMessagesAfterConversationHide(messages, undefined)).toBe(messages);
    });
  });

  it('re-encrypts an edited queued message and saves it locally', async () => {
    const db = {} as SQLiteDatabase;
    const identity = { publicKey: 'sender-public-key', secretKey: 'secret-key' };
    const encrypted = {
      nonce: 'new-nonce',
      senderCiphertext: 'new-sender-ciphertext',
      recipientCiphertext: 'new-recipient-ciphertext',
    };
    jest.mocked(getOrCreateDeviceIdentity).mockResolvedValue(identity);
    jest.mocked(encryptMessage).mockReturnValue(encrypted);

    await editEncryptedMessage(
      db,
      profile,
      { id: 'recipient-id', publicKey: 'recipient-public-key' },
      localMessage,
      'Updated message',
    );

    expect(encryptMessage).toHaveBeenCalledWith('Updated message', identity, 'recipient-public-key');
    expect(updateLocalMessageContent).toHaveBeenCalledWith(
      db,
      localMessage.id,
      { text: 'Updated message', ...encrypted },
      expect.any(Number),
    );
  });

  it('removes a queued message locally without contacting the server', async () => {
    const db = {} as SQLiteDatabase;

    await deleteEncryptedMessage(db, profile, localMessage);

    expect(deleteLocalMessage).toHaveBeenCalledWith(db, localMessage.id);
  });
});
