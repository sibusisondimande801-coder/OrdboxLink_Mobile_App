import React, { useEffect, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAppStore } from '../store/appStore';
import { AppColors, useAppColors } from '../theme/colors';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { ConversationsScreen } from '../screens/ConversationsScreen';
import { StoriesScreen } from '../screens/StoriesScreen';
import { ContactsScreen } from '../screens/ContactsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { useMessageSync } from '../hooks/useMessageSync';

export type RootStackParamList = {
  Onboarding: undefined;
  Auth: undefined;
  Main: undefined;
  Chat: {
    conversationId: string;
    title: string;
    participantId?: string;
    participantPublicKey?: string;
    disappearingAfterSeconds?: number;
    nickname?: string | null;
    participantDisplayName?: string;
    participantBiography?: string;
    participantAvatarUrl?: string | null;
  };
};

export type MainTabParamList = {
  Chats: undefined;
  Stories: undefined;
  Contacts: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
type TabBarIcon = NonNullable<BottomTabNavigationOptions['tabBarIcon']>;

const chatsTabIcon: TabBarIcon = ({ color, size, focused }) => (
  <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} color={color} size={size} />
);
const storiesTabIcon: TabBarIcon = ({ color, size, focused }) => (
  <Ionicons name={focused ? 'images' : 'images-outline'} color={color} size={size} />
);
const contactsTabIcon: TabBarIcon = ({ color, size, focused }) => (
  <Ionicons name={focused ? 'people' : 'people-outline'} color={color} size={size} />
);
const settingsTabIcon: TabBarIcon = ({ color, size, focused }) => (
  <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={size} />
);

function MainTabs() {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarStyle: {
          height: 68 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 0,
          elevation: 12,
          shadowColor: colors.navy,
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
        },
      }}>
      <Tabs.Screen
        name="Chats"
        component={ConversationsScreen}
        options={{ tabBarIcon: chatsTabIcon }}
      />
      <Tabs.Screen
        name="Stories"
        component={StoriesScreen}
        options={{ tabBarIcon: storiesTabIcon }}
      />
      <Tabs.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{ tabBarIcon: contactsTabIcon }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarIcon: settingsTabIcon }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const hasOnboarded = useAppStore((state) => state.hasOnboarded);
  const profile = useAppStore((state) => state.profile);
  const colors = useAppColors();
  const styles = createNavigatorStyles(colors);
  const [locked, setLocked] = useState(false);
  useMessageSync(profile);

  useEffect(() => {
    setLocked(Boolean(profile?.biometricLock));
  }, [profile?.biometricLock, profile?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (profile?.biometricLock && state !== 'active') setLocked(true);
      if (profile?.biometricLock && state === 'active') setLocked(true);
    });
    return () => subscription.remove();
  }, [profile?.biometricLock]);

  const unlock = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock OrdboxLink',
        cancelLabel: 'Cancel',
      });
      if (result.success) setLocked(false);
    } catch (error) {
      Alert.alert(
        'Unable to unlock',
        error instanceof Error ? error.message : 'Device authentication failed.',
      );
    }
  };

  if (profile?.biometricLock && locked) {
    return (
      <View style={styles.lockScreen}>
        <View style={styles.lockIcon}>
          <Ionicons name="shield-checkmark" size={38} color={colors.red} />
        </View>
        <Text style={styles.lockTitle}>OrdboxLink is locked</Text>
        <Text style={styles.lockBody}>Authenticate with your device to open your messages.</Text>
        <Pressable style={styles.unlockButton} onPress={() => void unlock()}>
          <Text style={styles.unlockText}>Unlock</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
      {!hasOnboarded ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      ) : !profile ? (
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={{
              headerShown: true,
              title: '',
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const createNavigatorStyles = (colors: AppColors) => StyleSheet.create({
  lockScreen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  lockIcon: { width: 84, height: 84, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  lockTitle: { color: colors.text, fontSize: 24, fontWeight: '900' },
  lockBody: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 10 },
  unlockButton: { height: 52, paddingHorizontal: 36, borderRadius: 13, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  unlockText: { color: colors.onPrimary, fontWeight: '800' },
});
