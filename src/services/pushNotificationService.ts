import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { getSupabaseClient } from './supabase';

export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Push notifications are available in the installed Android app only.');
  }
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error('Push notifications need an EAS project ID. Add one to the app configuration.');
  }

  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (permission.status !== 'granted') {
    throw new Error('Allow notifications in your device settings to receive message alerts.');
  }

  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    importance: Notifications.AndroidImportance.HIGH,
  });
  const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId });
  const { error } = await getSupabaseClient().from('notification_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: tokenData,
      platform: 'android',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'expo_push_token' },
  );
  if (error) throw error;
}

export async function unregisterPushTokens(userId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('notification_tokens')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}
