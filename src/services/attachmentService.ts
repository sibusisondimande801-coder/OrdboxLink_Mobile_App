import { Directory, File as ExpoFile, Paths } from 'expo-file-system';
import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { decryptAttachmentBytes, encryptAttachmentBytes } from './messageCrypto';
import { getSupabaseClient } from './supabase';

export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_VOICE_NOTE_SIZE = 5 * 1024 * 1024;
export const MAX_VOICE_NOTE_SECONDS = 120;
const WEB_ATTACHMENT_CACHE_DATABASE = 'ordboxlink-attachment-cache';
const WEB_ATTACHMENT_CACHE_STORE = 'encrypted-attachments';

export type AttachmentKind = 'image' | 'document' | 'voice';

export function normalizeAttachmentMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/\s/g, '');
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('The selected attachment could not be decoded.');
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((clean.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    const a = alphabet.indexOf(chunk[0] ?? '');
    const b = alphabet.indexOf(chunk[1] ?? '');
    const c = chunk[2] === '=' ? 0 : alphabet.indexOf(chunk[2] ?? '');
    const d = chunk[3] === '=' ? 0 : alphabet.indexOf(chunk[3] ?? '');
    const bits = a * 262144 + b * 4096 + c * 64 + d;
    if (outputIndex < bytes.length) bytes[outputIndex++] = Math.floor(bits / 65536) % 256;
    if (outputIndex < bytes.length) bytes[outputIndex++] = Math.floor(bits / 256) % 256;
    if (outputIndex < bytes.length) bytes[outputIndex++] = bits % 256;
  }
  return bytes;
}

async function readLocalFileBytes(uri: string): Promise<Uint8Array> {
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  return decodeBase64(base64);
}

async function readAttachmentBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    try {
      const contents = await file.arrayBuffer();
      if (!(contents instanceof ArrayBuffer)) throw new Error('The attachment reader returned invalid data.');
      return new Uint8Array(contents);
    } catch (error) {
      const uri = 'uri' in file && typeof file.uri === 'string' ? file.uri : null;
      if (!uri || Platform.OS === 'web') throw error;
      return readLocalFileBytes(uri);
    }
  }
  const uri = 'uri' in file && typeof file.uri === 'string' ? file.uri : null;
  if (uri && Platform.OS !== 'web') return readLocalFileBytes(uri);
  throw new Error('This attachment cannot be read. Please choose the file again.');
}

export async function getAttachmentFile(uri: string, browserFile?: Blob): Promise<Blob> {
  if (browserFile) return browserFile;
  if (Platform.OS !== 'web') {
    const file = new ExpoFile(uri);
    if (typeof file.arrayBuffer === 'function') return file;
    const bytes = await readLocalFileBytes(uri);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return new Blob([buffer]);
  }

  const response = await fetch(uri);
  if (!response.ok) throw new Error('The selected attachment could not be read.');
  return response.blob();
}

export interface AttachmentEnvelope {
  version: 1;
  type: 'attachment';
  kind: AttachmentKind;
  path: string;
  key: string;
  nonce: string;
  name: string;
  mimeType: string;
  size: number;
  caption?: string;
  durationMillis?: number;
}

function openWebAttachmentCache(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('Offline attachment storage is not available in this browser.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_ATTACHMENT_CACHE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WEB_ATTACHMENT_CACHE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Attachment storage could not be opened.'));
    request.onblocked = () => reject(new Error('Attachment storage is blocked by another app tab.'));
  });
}

async function getNativeAttachmentCacheFile(path: string): Promise<ExpoFile> {
  const directory = new Directory(Paths.document, 'encrypted-attachments');
  directory.create({ intermediates: true, idempotent: true });
  const cacheKey = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, path);
  return new ExpoFile(directory, `${cacheKey}.bin`);
}

async function readCachedCiphertext(path: string): Promise<Uint8Array | null> {
  if (Platform.OS === 'web') {
    const database = await openWebAttachmentCache();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(WEB_ATTACHMENT_CACHE_STORE, 'readonly');
      const request = transaction.objectStore(WEB_ATTACHMENT_CACHE_STORE).get(path);
      request.onsuccess = () => {
        const stored = request.result as ArrayBuffer | undefined;
        resolve(stored ? new Uint8Array(stored) : null);
      };
      request.onerror = () => reject(request.error ?? new Error('Cached attachment could not be read.'));
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Cached attachment could not be read.'));
      };
    });
  }

  const file = await getNativeAttachmentCacheFile(path);
  return file.exists ? file.bytes() : null;
}

async function cacheCiphertext(path: string, ciphertext: Uint8Array): Promise<void> {
  if (Platform.OS === 'web') {
    const database = await openWebAttachmentCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(WEB_ATTACHMENT_CACHE_STORE, 'readwrite');
      transaction.objectStore(WEB_ATTACHMENT_CACHE_STORE).put(ciphertext.slice().buffer, path);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error('Attachment could not be saved for offline use.'));
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error('Attachment could not be saved for offline use.'));
      };
    });
    return;
  }

  const file = await getNativeAttachmentCacheFile(path);
  if (!file.exists) {
    await file.create({ intermediates: true, overwrite: true });
  }
  await file.write(ciphertext);
}

const allowedMimeTypes: Record<AttachmentKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  document: [
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  voice: ['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/webm'],
};

function isAttachmentEnvelope(value: unknown): value is AttachmentEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AttachmentEnvelope>;
  return (
    candidate.version === 1 &&
    candidate.type === 'attachment' &&
    ['image', 'document', 'voice'].includes(candidate.kind ?? '') &&
    typeof candidate.path === 'string' &&
    typeof candidate.key === 'string' &&
    typeof candidate.nonce === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.size === 'number' &&
    (candidate.durationMillis === undefined ||
      (candidate.kind === 'voice' &&
        typeof candidate.durationMillis === 'number' &&
        Number.isFinite(candidate.durationMillis) &&
        candidate.durationMillis > 0 &&
        candidate.durationMillis <= MAX_VOICE_NOTE_SECONDS * 1000))
  );
}

export function parseAttachmentEnvelope(body: string): AttachmentEnvelope | null {
  if (!body.startsWith('{"version":1,"type":"attachment"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('This attachment message is invalid.');
    throw error;
  }
  if (!isAttachmentEnvelope(parsed)) {
    throw new Error('This attachment message is invalid.');
  }
  return parsed;
}

export function getMessagePreview(body: string): string {
  try {
    const attachment = parseAttachmentEnvelope(body);
    if (!attachment) return body;
    if (attachment.kind === 'image') return 'Photo';
    if (attachment.kind === 'voice') return 'Voice note';
    return attachment.name;
  } catch {
    return 'Attachment';
  }
}

export async function uploadAttachment(
  conversationId: string,
  kind: AttachmentKind,
  file: Blob,
  name: string,
  mimeType: string,
  caption?: string,
  durationMillis?: number,
): Promise<AttachmentEnvelope> {
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType);
  const maxSize = kind === 'voice' ? MAX_VOICE_NOTE_SIZE : MAX_ATTACHMENT_SIZE;
  if (file.size <= 0 || file.size > maxSize) {
    throw new Error(
      kind === 'voice'
        ? 'Voice notes must be under 5 MB.'
        : 'Photos and documents must be under 10 MB.',
    );
  }
  if (!allowedMimeTypes[kind].includes(normalizedMimeType)) {
    throw new Error('This file type is not supported.');
  }
  if (durationMillis !== undefined && kind !== 'voice') {
    throw new Error('Only voice notes can include a recording duration.');
  }
  if (durationMillis !== undefined && (!Number.isFinite(durationMillis) || durationMillis <= 0)) {
    throw new Error('A voice note duration must be greater than zero.');
  }
  if (durationMillis !== undefined && durationMillis > MAX_VOICE_NOTE_SECONDS * 1000) {
    throw new Error('Voice notes must be 2 minutes or shorter.');
  }

  const encrypted = encryptAttachmentBytes(await readAttachmentBytes(file));
  const path = `${conversationId}/${Crypto.randomUUID()}`;
  await cacheCiphertext(path, encrypted.ciphertext);
  const { error } = await getSupabaseClient()
    .storage.from('message-media')
    .upload(path, encrypted.ciphertext.buffer, { contentType: 'application/octet-stream' });
  if (error) throw error;

  return {
    version: 1,
    type: 'attachment',
    kind,
    path,
    key: encrypted.key,
    nonce: encrypted.nonce,
    name: Array.from(name, (character) => {
      const codePoint = character.charCodeAt(0);
      return character === '/' || character === '\\' || codePoint < 32 ? '_' : character;
    }).join('').slice(0, 120) || 'Attachment',
    mimeType: normalizedMimeType,
    size: file.size,
    ...(caption?.trim() ? { caption: caption.trim().slice(0, 1000) } : {}),
    ...(durationMillis === undefined ? {} : { durationMillis: Math.round(durationMillis) }),
  };
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'application/pdf':
      return 'pdf';
    case 'text/plain':
      return 'txt';
    case 'audio/mp4':
    case 'audio/aac':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/mpeg':
      return 'mp3';
    default:
      return 'jpg';
  }
}

export async function downloadAttachment(envelope: AttachmentEnvelope): Promise<string> {
  let encrypted = await readCachedCiphertext(envelope.path);
  if (!encrypted) {
    const { data, error } = await getSupabaseClient()
      .storage.from('message-media')
      .download(envelope.path);
    if (error) throw error;
    encrypted = await readDownloadedAttachmentBytes(data);
    await cacheCiphertext(envelope.path, encrypted);
  }
  const plaintext = decryptAttachmentBytes(encrypted, envelope.nonce, envelope.key);
  if (Platform.OS === 'web') {
    const buffer = new ArrayBuffer(plaintext.byteLength);
    new Uint8Array(buffer).set(plaintext);
    return URL.createObjectURL(new Blob([buffer], { type: envelope.mimeType }));
  }

  const file = new ExpoFile(Paths.cache, `${Crypto.randomUUID()}.${extensionForMimeType(envelope.mimeType)}`);
  await file.create({ intermediates: true, overwrite: true });
  await file.write(plaintext);
  return file.uri;
}

export async function readDownloadedAttachmentBytes(file: Blob): Promise<Uint8Array> {
  let arrayBufferError: unknown;
  if (typeof file.arrayBuffer === 'function') {
    try {
      const contents = await file.arrayBuffer();
      if (contents instanceof ArrayBuffer) return new Uint8Array(contents);
      arrayBufferError = new Error('The downloaded attachment returned invalid data.');
    } catch (error) {
      arrayBufferError = error;
    }
  }

  if (typeof FileReader === 'undefined') {
    if (arrayBufferError) throw arrayBufferError;
    throw new Error('This downloaded attachment cannot be read on this device.');
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error('The downloaded attachment returned invalid data.'));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The downloaded attachment could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}
