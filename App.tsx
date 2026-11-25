import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { SQLiteProvider } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import { initializeChatDatabase } from './src/data/chatDatabase';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useAppStore } from './src/store/appStore';
import { LAUNCH_SPLASH_DURATION_MS, LaunchSplash } from './src/components/LaunchSplash';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const profile = useAppStore((state) => state.profile);
  const [launchDurationElapsed, setLaunchDurationElapsed] = useState(false);
  const [databaseReady, setDatabaseReady] = useState(false);
  const launchFinished = launchDurationElapsed && databaseReady;
  const initializeDatabase = useCallback(async (db: Parameters<typeof initializeChatDatabase>[0]) => {
    await initializeChatDatabase(db);
    setDatabaseReady(true);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setLaunchDurationElapsed(true), LAUNCH_SPLASH_DURATION_MS);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={!launchFinished || !profile ? 'light-content' : 'dark-content'}
      />
      <View style={styles.appContent}>
        <SQLiteProvider databaseName="mzansilink.db" onInit={initializeDatabase}>
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </SQLiteProvider>
        {!launchFinished && (
          <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
            <LaunchSplash />
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContent: { flex: 1 },
});
