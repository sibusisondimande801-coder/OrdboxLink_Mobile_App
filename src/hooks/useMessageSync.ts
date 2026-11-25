import { useEffect } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useSQLiteContext } from 'expo-sqlite';
import { AccountProfile } from '../services/accountService';
import {
  createMessageSubscription,
  receiveEncryptedMessage,
  synchronizeMessages,
} from '../services/messagingService';
import { isSupabaseConfigured } from '../services/supabase';
import { useAppStore } from '../store/appStore';

export function useMessageSync(profile: AccountProfile | null): void {
  const db = useSQLiteContext();
  const setSyncError = useAppStore((state) => state.setSyncError);

  useEffect(() => {
    if (!profile) return;
    if (!isSupabaseConfigured) {
      setSyncError('Set up Supabase configuration to send or receive messages.');
      return;
    }

    let active = true;
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const notificationFailures = await synchronizeMessages(db, profile);
        if (active) {
          setSyncError(
            notificationFailures.length > 0
              ? `A message was sent, but its push alert could not be delivered: ${notificationFailures[0]}`
              : null,
          );
        }
      } catch (error) {
        if (active) {
          setSyncError(error instanceof Error ? error.message : 'Messages could not be synchronized.');
        }
      } finally {
        syncing = false;
      }
    };

    const subscription = createMessageSubscription(
      profile,
      (message) => {
        void receiveEncryptedMessage(db, profile, message)
          .catch((error: unknown) => {
            if (active) {
              setSyncError(error instanceof Error ? error.message : 'The incoming message could not be opened.');
            }
          });
      },
      (status) => {
        if (active && status === 'CHANNEL_ERROR') {
          setSyncError('Live message connection failed. Check your internet connection.');
        }
      },
    );
    const networkSubscription = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void sync();
      }
    });
    void NetInfo.fetch().then((state) => {
      if (state.isConnected && state.isInternetReachable !== false) void sync();
    });

    return () => {
      active = false;
      networkSubscription();
      void subscription.unsubscribe();
    };
  }, [db, profile, setSyncError]);
}
