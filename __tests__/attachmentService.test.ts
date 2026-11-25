import 'fake-indexeddb/auto';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

jest.mock('../src/services/supabase', () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: class ExpoFile {
    uri = 'file:///cache/attachment.bin';
    exists = false;
    create = jest.fn();
    write = jest.fn();
    bytes = jest.fn(async () => new Uint8Array());
  },
  Directory: class ExpoDirectory {
    create = jest.fn();
  },
  Paths: { cache: {}, document: {} },
}));

jest.mock('expo-file-system/legacy', () => ({
  EncodingType: { Base64: 'base64' },
  readAsStringAsync: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'attachment-id'),
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `digest-${value}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import {
  downloadAttachment,
  getAttachmentFile,
  normalizeAttachmentMimeType,
  parseAttachmentEnvelope,
  readDownloadedAttachmentBytes,
  uploadAttachment,
} from '../src/services/attachmentService';
import { encryptAttachmentBytes } from '../src/services/messageCrypto';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { getSupabaseClient } from '../src/services/supabase';

const mockReadAsStringAsync = jest.mocked(readAsStringAsync);
const mockGetSupabaseClient = jest.mocked(getSupabaseClient);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('web attachment files', () => {
  it('reads recorder blob URLs as browser blobs', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(new Response('voice note', {
      headers: { 'Content-Type': 'audio/webm' },
    }));

    const file = await getAttachmentFile('blob:recording');

    expect(await file.text()).toBe('voice note');
    expect(file.type).toBe('audio/webm');
    expect(fetchSpy).toHaveBeenCalledWith('blob:recording');
  });

  it('reports an unreadable web attachment instead of returning an invalid file', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(getAttachmentFile('blob:missing')).rejects.toThrow(
      'The selected attachment could not be read.',
    );
  });

  it('falls back to the legacy native reader when the picked file arrayBuffer API fails', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    const upload = jest.fn().mockResolvedValue({ error: null });
    mockGetSupabaseClient.mockReturnValue({
      storage: {
        from: jest.fn(() => ({ upload })),
      },
    } as never);
    mockReadAsStringAsync.mockResolvedValue('aGVsbG8=');
    const file = Object.assign(new Blob(['ignored'], { type: 'image/png' }), {
      arrayBuffer: jest.fn().mockRejectedValue(new TypeError('undefined is not a function')),
      uri: 'file:///photo.png',
    });

    try {
      await expect(
        uploadAttachment('conversation-id', 'image', file, 'photo.png', 'image/png'),
      ).resolves.toMatchObject({ kind: 'image', mimeType: 'image/png' });
      expect(mockReadAsStringAsync).toHaveBeenCalledWith(
        'file:///photo.png',
        { encoding: EncodingType.Base64 },
      );
      expect(upload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    }
  });
});

describe('voice-note envelope metadata', () => {
  const voiceEnvelope = {
    version: 1,
    type: 'attachment',
    kind: 'voice',
    path: 'conversation/voice',
    key: 'secret-key',
    nonce: 'nonce',
    name: 'Voice note',
    mimeType: 'audio/webm',
    size: 1024,
  };

  it('keeps recording length with a voice-note message', () => {
    expect(parseAttachmentEnvelope(JSON.stringify({ ...voiceEnvelope, durationMillis: 4200 })))
      .toMatchObject({ kind: 'voice', durationMillis: 4200 });
  });

  describe('downloaded attachment bytes', () => {
    it('uses FileReader when the native Blob arrayBuffer method is unavailable', async () => {
      const originalFileReader = globalThis.FileReader;
      const file = Object.assign(new Blob(['voice note']), { arrayBuffer: undefined });
      const reader = {
        result: null as ArrayBuffer | null,
        error: null,
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        readAsArrayBuffer: jest.fn((blob: Blob) => {
          blob.text().then((text) => {
            reader.result = new TextEncoder().encode(text).buffer;
            reader.onload?.();
          });
        }),
      };
      Object.defineProperty(globalThis, 'FileReader', {
        configurable: true,
        value: jest.fn(() => reader),
      });

      try {
        const bytes = await readDownloadedAttachmentBytes(file);
        expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode('voice note')));
        expect(reader.readAsArrayBuffer).toHaveBeenCalledWith(file);
      } finally {
        Object.defineProperty(globalThis, 'FileReader', {
          configurable: true,
          value: originalFileReader,
        });
      }
    });
  });

  it('rejects invalid voice-note lengths', () => {
    expect(() => parseAttachmentEnvelope(JSON.stringify({ ...voiceEnvelope, durationMillis: 130_000 })))
      .toThrow('This attachment message is invalid.');
  });

  it('normalizes browser recorder MIME types with codec parameters', () => {
    expect(normalizeAttachmentMimeType('Audio/WebM;codecs=opus')).toBe('audio/webm');
  });
});

describe('offline attachment cache', () => {
  it('opens a sent attachment from its local encrypted copy without downloading it', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const download = jest.fn();
    mockGetSupabaseClient.mockReturnValue({
      storage: {
        from: jest.fn(() => ({ upload, download })),
      },
    } as never);

    const envelope = await uploadAttachment(
      'offline-conversation',
      'voice',
      new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
      'Voice note',
      'audio/webm',
      undefined,
      1000,
    );

    await expect(downloadAttachment(envelope)).resolves.toMatch(/^blob:/);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
  });

  it('caches a received attachment after its first online download', async () => {
    const encrypted = encryptAttachmentBytes(new Uint8Array([1, 2, 3]));
    const encryptedBuffer = new ArrayBuffer(encrypted.ciphertext.byteLength);
    new Uint8Array(encryptedBuffer).set(encrypted.ciphertext);
    const download = jest.fn().mockResolvedValue({
      data: new Blob([encryptedBuffer]),
      error: null,
    });
    mockGetSupabaseClient.mockReturnValue({
      storage: {
        from: jest.fn(() => ({ download })),
      },
    } as never);
    const envelope = {
      version: 1 as const,
      type: 'attachment' as const,
      kind: 'voice' as const,
      path: 'received-conversation/received-voice',
      key: encrypted.key,
      nonce: encrypted.nonce,
      name: 'Voice note',
      mimeType: 'audio/webm',
      size: 3,
    };

    await downloadAttachment(envelope);
    await downloadAttachment(envelope);

    expect(download).toHaveBeenCalledTimes(1);
  });
});
