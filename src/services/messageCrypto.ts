import 'react-native-get-random-values';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import * as WebSecureStorage from './webSecureStorage';

export interface DeviceIdentity {
  publicKey: string;
  secretKey: string;
}

export interface EncryptedMessage {
  nonce: string;
  senderCiphertext: string;
  recipientCiphertext: string;
}

export interface EncryptedAttachment {
  key: string;
  nonce: string;
  ciphertext: Uint8Array;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
    throw new Error('The saved encryption key or message is invalid.');
  }
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function utf8ToBytes(value: string): Uint8Array {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return Uint8Array.from(bytes);
}

function bytesToUtf8(bytes: Uint8Array): string {
  const encoded = Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, '0')}`).join('');
  return decodeURIComponent(encoded);
}

export async function getOrCreateDeviceIdentity(
  userId: string,
  publishedPublicKey: string | null,
): Promise<DeviceIdentity> {
  const storageKey = `mzansilink-e2ee-${userId}`;
  const savedSecretKey =
    Platform.OS === 'web'
      ? await WebSecureStorage.getItemAsync(storageKey)
      : await SecureStore.getItemAsync(storageKey);

  if (savedSecretKey) {
    const secretKey = hexToBytes(savedSecretKey);
    if (secretKey.length !== nacl.box.secretKeyLength) {
      throw new Error('The encryption key stored on this device is invalid.');
    }
    const keyPair = nacl.box.keyPair.fromSecretKey(secretKey);
    const publicKey = bytesToHex(keyPair.publicKey);
    if (publishedPublicKey && publicKey !== publishedPublicKey) {
      throw new Error('This device encryption key does not match the account key.');
    }
    return { publicKey, secretKey: savedSecretKey };
  }

  if (publishedPublicKey) {
    throw new Error(
      'This account has an encryption key on another device. Key recovery is not available yet.',
    );
  }

  const keyPair = nacl.box.keyPair();
  const secretKey = bytesToHex(keyPair.secretKey);
  const publicKey = bytesToHex(keyPair.publicKey);
  if (Platform.OS === 'web') {
    await WebSecureStorage.setItemAsync(storageKey, secretKey);
  } else {
    await SecureStore.setItemAsync(storageKey, secretKey);
  }
  return { publicKey, secretKey };
}

export function encryptMessage(
  text: string,
  identity: DeviceIdentity,
  recipientPublicKey: string,
): EncryptedMessage {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const secretKey = hexToBytes(identity.secretKey);
  const senderPublicKey = hexToBytes(identity.publicKey);
  const recipientKey = hexToBytes(recipientPublicKey);
  const plaintext = utf8ToBytes(text);

  if (
    secretKey.length !== nacl.box.secretKeyLength ||
    senderPublicKey.length !== nacl.box.publicKeyLength ||
    recipientKey.length !== nacl.box.publicKeyLength
  ) {
    throw new Error('A conversation encryption key is invalid.');
  }

  return {
    nonce: bytesToHex(nonce),
    senderCiphertext: bytesToHex(nacl.box(plaintext, nonce, senderPublicKey, secretKey)),
    recipientCiphertext: bytesToHex(nacl.box(plaintext, nonce, recipientKey, secretKey)),
  };
}

export function decryptMessage(
  ciphertext: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string,
): string {
  const plaintext = nacl.box.open(
    hexToBytes(ciphertext),
    hexToBytes(nonce),
    hexToBytes(senderPublicKey),
    hexToBytes(recipientSecretKey),
  );
  if (!plaintext) {
    throw new Error('This message could not be decrypted with the device key.');
  }
  return bytesToUtf8(plaintext);
}

export function encryptAttachmentBytes(plaintext: Uint8Array): EncryptedAttachment {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return {
    key: bytesToHex(key),
    nonce: bytesToHex(nonce),
    ciphertext: nacl.secretbox(plaintext, nonce, key),
  };
}

export function decryptAttachmentBytes(
  ciphertext: Uint8Array,
  nonceHex: string,
  keyHex: string,
): Uint8Array {
  const plaintext = nacl.secretbox.open(ciphertext, hexToBytes(nonceHex), hexToBytes(keyHex));
  if (!plaintext) {
    throw new Error('This attachment could not be decrypted.');
  }
  return plaintext;
}
