import { createAuthSessionStorage, KeyValueStorage } from '../src/services/authSessionStorage';

describe('remember-me session storage', () => {
  it('keeps sessions in memory when remember me is off and persists them when enabled', async () => {
    const values = new Map<string, string>([['auth-key', 'previous-session']]);
    const storage: KeyValueStorage = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    };
    const auth = createAuthSessionStorage(storage, 'auth-key');

    await auth.setRememberSession(false);
    await auth.storage.setItem('auth-key', 'temporary-session');
    expect(await auth.storage.getItem('auth-key')).toBe('temporary-session');
    expect(values.has('auth-key')).toBe(false);

    await auth.setRememberSession(true);
    await auth.storage.setItem('auth-key', 'remembered-session');
    expect(await auth.storage.getItem('auth-key')).toBe('remembered-session');
    expect(values.get('auth-key')).toBe('remembered-session');
  });
});
