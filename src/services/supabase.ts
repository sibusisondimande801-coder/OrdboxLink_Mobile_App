import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createAuthSessionStorage } from './authSessionStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const projectRef = supabaseUrl?.match(/^https?:\/\/([^.]+)/)?.[1];
const authStorageKey = projectRef ? `sb-${projectRef}-auth-token` : 'mzansilink-auth';
const authSessionStorage = createAuthSessionStorage(AsyncStorage, authStorageKey);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client: SupabaseClient | null = null;

export async function setRememberSession(remember: boolean): Promise<void> {
  await authSessionStorage.setRememberSession(remember);
}

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    throw new Error('Add the Supabase URL and anon key to your .env file, then restart Expo.');
  }

  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: authSessionStorage.storage,
        storageKey: authStorageKey,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}
