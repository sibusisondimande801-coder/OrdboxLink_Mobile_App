/// <reference lib="dom" />

import 'fake-indexeddb/auto';
import { getItemAsync, setItemAsync } from '../src/services/webSecureStorage';

function readStoredValue(key: string): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('mzansilink-secure-storage', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const read = database.transaction('secrets', 'readonly').objectStore('secrets').get(key);
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        database.close();
        resolve(read.result);
      };
    };
  });
}

describe('web secure storage', () => {
  it('encrypts and restores device secrets through IndexedDB', async () => {
    const key = 'test-device-key';
    const secret = 'device-secret-material';

    expect(await getItemAsync(key)).toBeNull();
    await setItemAsync(key, secret);

    const stored = await readStoredValue(key);
    expect(stored.iv).toHaveLength(12);
    expect(stored.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(await getItemAsync(key)).toBe(secret);
  });
});
