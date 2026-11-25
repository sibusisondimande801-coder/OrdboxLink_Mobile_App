import { File as ExpoFile } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type { ImagePickerAsset } from 'expo-image-picker';
import { getOrCreateDeviceIdentity } from './messageCrypto';
import { getSupabaseClient, setRememberSession } from './supabase';
import type { ThemePaletteId } from '../theme/colors';

export interface AccountProfile {
  id: string;
  email: string;
  username: string;
  displayName: string;
  biography: string;
  avatarPath: string | null;
  avatarUrl: string | null;
  publicKey: string;
  themePalette: ThemePaletteId;
  discoverable: boolean;
  disappearingAfterSeconds: number;
  notificationsEnabled: boolean;
  showNotificationPreviews: boolean;
  biometricLock: boolean;
}

export interface BlockedAccount {
  id: string;
  username: string;
}

interface RemoteProfile {
  id: string;
  username: string;
  display_name: string | null;
  biography: string | null;
  avatar_path: string | null;
  public_key: string | null;
  theme_palette: ThemePaletteId | null;
  discoverable: boolean;
  disappearing_after_seconds: number;
  notifications_enabled: boolean;
  show_notification_previews: boolean;
  biometric_lock: boolean;
}

async function getAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await getSupabaseClient()
    .storage.from('profile-photos')
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  return data.signedUrl;
}

async function mapProfile(profile: RemoteProfile, email: string): Promise<AccountProfile> {
  if (!profile.public_key) {
    throw new Error('The account encryption key has not been registered.');
  }
  return {
    id: profile.id,
    email,
    username: `@${profile.username}`,
    displayName: profile.display_name?.trim() ?? '',
    biography: profile.biography ?? '',
    avatarPath: profile.avatar_path,
    avatarUrl: await getAvatarUrl(profile.avatar_path),
    publicKey: profile.public_key,
    themePalette: profile.theme_palette ?? 'savanna',
    discoverable: profile.discoverable,
    disappearingAfterSeconds: profile.disappearing_after_seconds,
    notificationsEnabled: profile.notifications_enabled,
    showNotificationPreviews: profile.show_notification_previews,
    biometricLock: profile.biometric_lock,
  };
}

async function loadAccountProfile(
  userId: string,
  email: string,
  usernameForNewAccount?: string,
): Promise<AccountProfile> {
  const supabase = getSupabaseClient();
  let { data: profile, error } = await supabase
    .from('profiles')
    .select(
      'id, username, display_name, biography, avatar_path, public_key, theme_palette, discoverable, disappearing_after_seconds, notifications_enabled, show_notification_previews, biometric_lock',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!profile && usernameForNewAccount) {
    const username = usernameForNewAccount.trim().replace(/^@/, '').toLowerCase();
    const created = await supabase
      .from('profiles')
      .upsert(
        { id: userId, username },
        { onConflict: 'id' },
      )
      .select(
        'id, username, display_name, biography, avatar_path, public_key, theme_palette, discoverable, disappearing_after_seconds, notifications_enabled, show_notification_previews, biometric_lock',
      )
      .single();
    if (created.error) throw created.error;
    profile = created.data;
  }

  if (!profile) {
    throw new Error('Account profile not found. Check your Supabase Auth and profiles setup.');
  }

  const identity = await getOrCreateDeviceIdentity(userId, profile.public_key);
  if (!profile.public_key) {
    const update = await supabase
      .from('profiles')
      .update({ public_key: identity.publicKey })
      .eq('id', userId)
      .select(
        'id, username, display_name, biography, avatar_path, public_key, theme_palette, discoverable, disappearing_after_seconds, notifications_enabled, show_notification_previews, biometric_lock',
      )
      .single();
    if (update.error) throw update.error;
    profile = update.data;
  }

  return mapProfile(profile, email);
}

export async function registerAccount(
  email: string,
  password: string,
  username: string,
): Promise<AccountProfile | null> {
  await setRememberSession(true);
  const supabase = getSupabaseClient();
  const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { username: normalizedUsername } },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Supabase did not return a user account.');
  if (!data.session) return null;
  return loadAccountProfile(data.user.id, data.user.email ?? email, normalizedUsername);
}

export async function signInAccount(
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<AccountProfile> {
  await setRememberSession(rememberMe);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  return loadAccountProfile(data.user.id, data.user.email ?? email);
}

export async function signOutAccount(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
  if (error) throw error;
}

export async function updateAccountProfile(
  userId: string,
  updates: Partial<
    Pick<
      AccountProfile,
      | 'username'
      | 'displayName'
      | 'biography'
      | 'discoverable'
      | 'disappearingAfterSeconds'
      | 'notificationsEnabled'
      | 'showNotificationPreviews'
      | 'biometricLock'
      | 'themePalette'
    >
  >,
): Promise<void> {
  const supabase = getSupabaseClient();
  const remoteUpdates = {
    ...(updates.username === undefined
      ? {}
      : { username: updates.username.trim().replace(/^@/, '').toLowerCase() }),
    ...(updates.displayName === undefined ? {} : { display_name: updates.displayName.trim() }),
    ...(updates.biography === undefined ? {} : { biography: updates.biography }),
    ...(updates.discoverable === undefined ? {} : { discoverable: updates.discoverable }),
    ...(updates.disappearingAfterSeconds === undefined
      ? {}
      : { disappearing_after_seconds: updates.disappearingAfterSeconds }),
    ...(updates.notificationsEnabled === undefined
      ? {}
      : { notifications_enabled: updates.notificationsEnabled }),
    ...(updates.showNotificationPreviews === undefined
      ? {}
      : { show_notification_previews: updates.showNotificationPreviews }),
    ...(updates.biometricLock === undefined ? {} : { biometric_lock: updates.biometricLock }),
    ...(updates.themePalette === undefined ? {} : { theme_palette: updates.themePalette }),
  };
  const { error } = await supabase.from('profiles').update(remoteUpdates).eq('id', userId);
  if (error) throw error;
}

export async function searchAccountByUsername(username: string): Promise<AccountProfile | null> {
  const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select(
      'id, username, display_name, biography, avatar_path, public_key, theme_palette, discoverable, disappearing_after_seconds, notifications_enabled, show_notification_previews, biometric_lock',
    )
    .eq('username', normalizedUsername)
    .eq('discoverable', true)
    .maybeSingle();
  if (error) throw error;
  if (!data?.public_key) return null;
  return mapProfile(data, '');
}

export async function uploadProfilePhoto(
  userId: string,
  asset: ImagePickerAsset,
): Promise<Pick<AccountProfile, 'avatarPath' | 'avatarUrl'>> {
  const supabase = getSupabaseClient();
  const image = asset.file ?? new ExpoFile(asset.uri);
  const size = asset.fileSize ?? image.size ?? 0;
  if (size > 5 * 1024 * 1024) {
    throw new Error('Choose a profile photo under 5 MB.');
  }
  const mimeType = asset.mimeType ?? image.type ?? 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Choose a JPG, PNG, or WebP profile photo.');
  }
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/${Crypto.randomUUID()}.${extension}`;
  const bytes = await image.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(path, bytes, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', userId);
  if (profileError) {
    const { error: cleanupError } = await supabase.storage.from('profile-photos').remove([path]);
    if (cleanupError) {
      throw new Error(`${profileError.message} The uploaded photo could not be cleaned up: ${cleanupError.message}`);
    }
    throw profileError;
  }
  return { avatarPath: path, avatarUrl: await getAvatarUrl(path) };
}

export interface SavedContact {
  id: string;
  username: string;
  displayName: string;
  nickname: string | null;
  biography: string;
  publicKey: string | null;
  avatarUrl: string | null;
  disappearingAfterSeconds: number;
}

export async function saveContact(contact: Pick<AccountProfile, 'id' | 'username'>): Promise<void> {
  const { data: userData, error: userError } = await getSupabaseClient().auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Sign in to save contacts.');
  if (userData.user.id === contact.id) return;

  const { error } = await getSupabaseClient().from('saved_contacts').upsert(
    {
      user_id: userData.user.id,
      contact_id: contact.id,
      username_snapshot: contact.username.replace(/^@/, ''),
    },
    { onConflict: 'user_id,contact_id' },
  );
  if (error) throw error;
}

export async function updateSavedContactNickname(
  contact: Pick<AccountProfile, 'id' | 'username'>,
  nickname: string | null,
): Promise<void> {
  await saveContact(contact);
  const { error } = await getSupabaseClient()
    .from('saved_contacts')
    .update({ nickname: nickname?.trim() || null })
    .eq('contact_id', contact.id);
  if (error) throw error;
}

export async function listSavedContacts(): Promise<SavedContact[]> {
  const supabase = getSupabaseClient();
  const { data: contacts, error } = await supabase
    .from('saved_contacts')
    .select('contact_id, username_snapshot, nickname')
    .order('username_snapshot', { ascending: true });
  if (error) throw error;
  if (contacts.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, display_name, biography, avatar_path, public_key, disappearing_after_seconds')
    .in('id', contacts.map((contact) => contact.contact_id));
  if (profileError) throw profileError;

  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return Promise.all(
    contacts.map(async (contact) => {
      const current = byId.get(contact.contact_id);
      return {
        id: contact.contact_id,
        username: current ? `@${current.username}` : `@${contact.username_snapshot}`,
        displayName: current?.display_name?.trim() ?? '',
        nickname: contact.nickname,
        biography: current?.biography ?? '',
        publicKey: current?.public_key ?? null,
        avatarUrl: current ? await getAvatarUrl(current.avatar_path) : null,
        disappearingAfterSeconds: current?.disappearing_after_seconds ?? 0,
      };
    }),
  );
}

export async function listBlockedAccounts(): Promise<BlockedAccount[]> {
  const { data, error } = await getSupabaseClient()
    .from('user_blocks')
    .select('blocked_user_id, blocked_username')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((item) => ({
    id: item.blocked_user_id,
    username: item.blocked_username,
  }));
}

export async function blockAccount(userId: string, username: string): Promise<void> {
  const target = await searchAccountByUsername(username);
  if (!target) throw new Error('No discoverable user found with that username.');
  const { error } = await getSupabaseClient()
    .from('user_blocks')
    .upsert(
      {
        user_id: userId,
        blocked_user_id: target.id,
        blocked_username: target.username,
      },
      { onConflict: 'user_id,blocked_user_id' },
    );
  if (error) throw error;
}

export async function unblockAccount(userId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('user_blocks')
    .delete()
    .eq('blocked_user_id', userId);
  if (error) throw error;
}
