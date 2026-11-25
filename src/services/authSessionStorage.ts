export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createAuthSessionStorage(storage: KeyValueStorage, sessionKey: string) {
  let rememberSession = true;
  const temporaryValues = new Map<string, string>();

  return {
    storage: {
      getItem: (key: string) =>
        rememberSession ? storage.getItem(key) : Promise.resolve(temporaryValues.get(key) ?? null),
      setItem: async (key: string, value: string) => {
        if (rememberSession) {
          await storage.setItem(key, value);
        } else {
          temporaryValues.set(key, value);
        }
      },
      removeItem: async (key: string) => {
        temporaryValues.delete(key);
        await storage.removeItem(key);
      },
    },
    setRememberSession: async (remember: boolean) => {
      rememberSession = remember;
      temporaryValues.clear();
      if (!remember) {
        await storage.removeItem(sessionKey);
      }
    },
  };
}
