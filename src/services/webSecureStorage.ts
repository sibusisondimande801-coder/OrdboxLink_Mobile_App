/// <reference lib="dom" />

interface EncryptedValue {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

const DATABASE_NAME = 'mzansilink-secure-storage';
const STORE_NAME = 'secrets';
const WRAPPING_KEY_ID = 'wrapping-key';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Secure browser storage is unavailable.'));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open browser key storage.'));
    });
  }
  return databasePromise;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure browser storage requires a secure context such as localhost or HTTPS.');
  }
  return globalThis.crypto;
}

async function readValue<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read browser key storage.'));
  });
}

async function addValue(key: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).add(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not write browser key storage.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Could not write browser key storage.'));
  });
}

async function writeValue(key: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Could not write browser key storage.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Could not write browser key storage.'));
  });
}

async function getWrappingKey(): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  const existing = await readValue<CryptoKey>(WRAPPING_KEY_ID);
  if (existing) return existing;

  const generated = await cryptoApi.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  try {
    await addValue(WRAPPING_KEY_ID, generated);
    return generated;
  } catch (error) {
    const concurrentKey = await readValue<CryptoKey>(WRAPPING_KEY_ID);
    if (concurrentKey) return concurrentKey;
    throw error;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  const stored = await readValue<EncryptedValue>(key);
  if (!stored) return null;

  try {
    const plaintext = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: stored.iv },
      await getWrappingKey(),
      stored.ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('The saved browser encryption key could not be unlocked.');
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  const cryptoApi = getCrypto();
  const iv = cryptoApi.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await getWrappingKey(),
    new TextEncoder().encode(value),
  );
  await writeValue(key, { iv, ciphertext } satisfies EncryptedValue);
}
