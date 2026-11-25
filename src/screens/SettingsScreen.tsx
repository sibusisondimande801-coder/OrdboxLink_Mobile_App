import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useAppStore } from '../store/appStore';
import { AppColors, themePalettes, useAppColors } from '../theme/colors';
import { SafariBanner } from '../components/SafariBanner';
import {
  AccountProfile,
  blockAccount,
  BlockedAccount,
  listBlockedAccounts,
  unblockAccount,
  uploadProfilePhoto,
  updateAccountProfile,
} from '../services/accountService';
import { registerPushToken, unregisterPushTokens } from '../services/pushNotificationService';
import { clearLocalChatHistory, normalizeParticipantUsername } from '../data/chatDatabase';
import { signOutAccount } from '../services/accountService';
import { PoweredByTag } from '../components/PoweredByTag';

type SettingsSection = 'profile' | 'privacy' | 'security' | 'notifications' | 'local-data';

const expiryOptions = [
  { value: 0, label: 'Never' },
  { value: 3600, label: '1 hour' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '7 days' },
];

export function SettingsScreen() {
  const profile = useAppStore((state) => state.profile);
  const updateProfile = useAppStore((state) => state.updateProfile);
  const logout = useAppStore((state) => state.logout);
  const db = useSQLiteContext();
  const colors = useAppColors();
  const styles = createStyles(colors);
  const [section, setSection] = useState<SettingsSection | null>(null);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [biography, setBiography] = useState(profile?.biography ?? '');
  const [blockUsername, setBlockUsername] = useState('');
  const [blockedAccounts, setBlockedAccounts] = useState<BlockedAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    setUsername(profile?.username ?? '');
    setDisplayName(profile?.displayName ?? '');
    setBiography(profile?.biography ?? '');
  }, [profile?.biography, profile?.displayName, profile?.username]);

  useEffect(() => {
    if (section !== 'privacy') return;
    let active = true;
    listBlockedAccounts().then(
      (accounts) => {
        if (active) setBlockedAccounts(accounts);
      },
      (error: unknown) => {
        if (active) {
          Alert.alert(
            'Unable to load blocked users',
            error instanceof Error ? error.message : 'The block list could not be loaded.',
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [section]);

  const saveProfileUpdate = async (updates: Partial<AccountProfile>) => {
    if (!profile) return false;
    setSaving(true);
    try {
      await updateAccountProfile(profile.id, updates);
      updateProfile(updates);
      return true;
    } catch (error) {
      Alert.alert(
        'Setting not saved',
        error instanceof Error ? error.message : 'The setting could not be updated.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    const normalizedUsername = normalizeParticipantUsername(username);
    if (!normalizedUsername) {
      Alert.alert('Invalid username', 'Use 3–24 letters or numbers, starting with a letter.');
      return;
    }
    if (await saveProfileUpdate({
      username: normalizedUsername,
      displayName: displayName.trim(),
      biography: biography.trim(),
    })) {
      setSection(null);
    }
  };

  const addBlockedAccount = async () => {
    if (!profile || !blockUsername.trim()) return;
    setSaving(true);
    try {
      await blockAccount(profile.id, blockUsername);
      setBlockUsername('');
      setBlockedAccounts(await listBlockedAccounts());
    } catch (error) {
      Alert.alert(
        'Unable to block user',
        error instanceof Error ? error.message : 'The user could not be blocked.',
      );
    } finally {
      setSaving(false);
    }
  };

  const removeBlockedAccount = async (account: BlockedAccount) => {
    try {
      await unblockAccount(account.id);
      setBlockedAccounts((current) => current.filter((item) => item.id !== account.id));
    } catch (error) {
      Alert.alert(
        'Unable to unblock user',
        error instanceof Error ? error.message : 'The user could not be unblocked.',
      );
    }
  };

  const setNotificationsEnabled = async (enabled: boolean) => {
    if (!profile) return;
    setNotificationError(null);
    try {
      if (enabled) await registerPushToken(profile.id);
      else await unregisterPushTokens(profile.id);
      if (!(await saveProfileUpdate({ notificationsEnabled: enabled }))) {
        setNotificationError('Notification setting could not be saved.');
      }
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : 'Notification settings could not be changed.');
      Alert.alert(
        'Notifications not updated',
        error instanceof Error ? error.message : 'Notification settings could not be changed.',
      );
    }
  };

  const chooseProfilePhoto = async () => {
    setPhotoError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPhotoError('Allow photo access to choose a profile picture.');
        Alert.alert('Permission needed', 'Allow photo access to choose a profile picture.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !profile) return;
      const asset = result.assets[0];
      if (!asset) return;
      const avatar = await uploadProfilePhoto(profile.id, asset);
      updateProfile(avatar);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'The profile picture could not be uploaded.');
      setSection('profile');
      Alert.alert(
        'Photo not saved',
        error instanceof Error ? error.message : 'The profile picture could not be uploaded.',
      );
    }
  };

  const setBiometricLock = async (enabled: boolean) => {
    if (enabled) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        Alert.alert('Biometrics unavailable', 'Set up a fingerprint or face unlock on this device first.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm device authentication',
        cancelLabel: 'Cancel',
      });
      if (!result.success) return;
    }
    await saveProfileUpdate({ biometricLock: enabled });
  };

  const clearHistory = () => {
    Alert.alert(
      'Clear local messages?',
      'This deletes cached messages and unsent messages from this device. Messages on the server may sync back later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearLocalChatHistory(db).catch((error: unknown) => {
              Alert.alert(
                'Unable to clear messages',
                error instanceof Error ? error.message : 'Local message data could not be deleted.',
              );
            });
          },
        },
      ],
    );
  };

  const handleLogout = async () => {
    try {
      await signOutAccount();
      logout();
    } catch (error) {
      Alert.alert(
        'Unable to log out',
        error instanceof Error ? error.message : 'Your account could not be signed out.',
      );
    }
  };

  const renderSection = () => {
    switch (section) {
      case 'profile':
        return (
          <>
            <Text style={styles.label}>Username</Text>
            <TextInput value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.input} />
            <Text style={styles.label}>Name others see</Text>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={48}
              placeholder={profile?.username ?? 'Your name'}
              style={styles.input}
            />
            <Text style={styles.helperText}>
              People see this name by default. Their private nickname for you still takes priority.
            </Text>
            <Text style={styles.label}>Biography</Text>
            <TextInput
              value={biography}
              onChangeText={setBiography}
              multiline
              maxLength={240}
              style={[styles.input, styles.multiline]}
            />
            <Pressable style={styles.primaryButton} onPress={saveProfile} disabled={saving}>
              <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save profile'}</Text>
            </Pressable>
          </>
        );
      case 'privacy':
        return (
          <>
            <SettingSwitch
              colors={colors}
              label="Discoverable by username"
              value={profile?.discoverable ?? true}
              onValueChange={(discoverable) => void saveProfileUpdate({ discoverable })}
            />
            <Text style={styles.sectionLabel}>Disappearing messages</Text>
            <Text style={styles.description}>Choose how long new messages stay.</Text>
            {expiryOptions.map((option) => (
              <Pressable
                key={option.value}
                style={styles.option}
                onPress={() => void saveProfileUpdate({ disappearingAfterSeconds: option.value })}>
                <Text style={styles.optionText}>{option.label}</Text>
                {profile?.disappearingAfterSeconds === option.value && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.red} />
                )}
              </Pressable>
            ))}
            <Text style={styles.sectionLabel}>Blocked users</Text>
            <View style={styles.blockRow}>
              <TextInput
                value={blockUsername}
                onChangeText={setBlockUsername}
                placeholder="@username"
                autoCapitalize="none"
                style={[styles.input, styles.blockInput]}
              />
              <Pressable style={styles.secondaryButton} onPress={addBlockedAccount} disabled={saving}>
                <Text style={styles.secondaryButtonText}>Block</Text>
              </Pressable>
            </View>
            {blockedAccounts.map((account) => (
              <View key={account.id} style={styles.blockedRow}>
                <Text style={styles.optionText}>{account.username}</Text>
                <Pressable onPress={() => void removeBlockedAccount(account)}>
                  <Text style={styles.link}>Unblock</Text>
                </Pressable>
              </View>
            ))}
          </>
        );
      case 'security':
        return (
          <>
            <Text style={styles.description}>Keep this device to read your existing messages.</Text>
            <SettingSwitch
              colors={colors}
              label="Require biometrics to open"
              value={profile?.biometricLock ?? false}
              onValueChange={(enabled) => void setBiometricLock(enabled)}
            />
          </>
        );
      case 'notifications':
        return (
          <>
            <SettingSwitch
              colors={colors}
              label="Message alerts"
              value={profile?.notificationsEnabled ?? false}
              onValueChange={(enabled) => void setNotificationsEnabled(enabled)}
            />
            <SettingSwitch
              colors={colors}
              label="Show sender's name"
              value={profile?.showNotificationPreviews ?? false}
              onValueChange={(showNotificationPreviews) =>
                void saveProfileUpdate({ showNotificationPreviews })
              }
            />
            <Text style={styles.description}>Get an alert when someone messages you.</Text>
            {notificationError ? <Text style={styles.warning}>{notificationError}</Text> : null}
          </>
        );
      case 'local-data':
        return (
          <>
            <Text style={styles.description}>Clear messages stored on this device.</Text>
            <Pressable style={styles.dangerButton} onPress={clearHistory}>
              <Text style={styles.dangerButtonText}>Clear local message cache</Text>
            </Pressable>
          </>
        );
      default:
        return null;
    }
  };

  const settingsRows = [
    { section: 'profile', title: 'Profile', detail: 'Username and photo', icon: 'person-circle-outline' },
    { section: 'privacy', title: 'Privacy', detail: 'Discoverability, blocks, and message expiry', icon: 'eye-outline' },
    { section: 'security', title: 'Security', detail: 'Device lock and privacy', icon: 'shield-checkmark-outline' },
    { section: 'notifications', title: 'Notifications', detail: 'Message alerts', icon: 'notifications-outline' },
    { section: 'local-data', title: 'Local messages', detail: 'Messages on this device', icon: 'phone-portrait-outline' },
  ] as const;
  const visibleSettingsRows = settingsRows.filter(
    (row) => row.section !== 'notifications' || Platform.OS === 'android',
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <SafariBanner
          colors={colors}
          eyebrow="MAKE IT YOURS"
          title="Settings"
          subtitle="Pick a palette and make your space feel like you."
          compact
        />
        <View style={styles.profile}>
          <Pressable style={styles.avatar} onPress={chooseProfilePhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
            {profile?.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{profile?.username?.slice(1, 3).toUpperCase()}</Text>
            )}
            <View style={styles.photoBadge}><Ionicons name="camera" size={12} color={colors.onPrimary} /></View>
          </Pressable>
          <View style={styles.profileContent}>
            <Text style={styles.username}>{profile?.username}</Text>
            <Text style={styles.biography}>{profile?.biography || 'No biography yet'}</Text>
            {photoError ? <Text style={styles.warning}>{photoError}</Text> : null}
          </View>
        </View>
        {visibleSettingsRows.map((row) => (
          <Pressable key={row.section} style={styles.row} onPress={() => setSection(row.section)}>
            <View style={styles.rowIcon}>
              <Ionicons name={row.icon} size={20} color={colors.red} />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowDetail}>{row.detail}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
        <View style={styles.paletteCard}>
          <Text style={styles.paletteTitle}>Colour palette</Text>
          <Text style={styles.rowDetail}>Choose your look</Text>
          <View style={styles.paletteOptions}>
            {themePalettes.map((palette) => (
              <Pressable
                key={palette.id}
                style={[
                  styles.paletteOption,
                  profile?.themePalette === palette.id && styles.paletteOptionSelected,
                ]}
                onPress={() => saveProfileUpdate({ themePalette: palette.id })}
                accessibilityRole="button"
                accessibilityLabel={`${palette.label} palette`}>
                <View style={styles.swatches}>
                  {palette.swatches.map((swatch) => (
                    <View key={swatch} style={[styles.swatch, { backgroundColor: swatch }]} />
                  ))}
                </View>
                <Text style={styles.paletteLabel}>{palette.label}</Text>
                {profile?.themePalette === palette.id
                  ? <Ionicons name="checkmark-circle" size={18} color={colors.red} />
                  : null}
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable style={styles.logout} onPress={() => void handleLogout()}>
          <Ionicons name="log-out-outline" size={19} color={colors.red} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <PoweredByTag />
      </ScrollView>
      <Modal visible={section !== null} animationType="slide" onRequestClose={() => setSection(null)}>
        <SafeAreaView style={styles.screen}>
          <KeyboardAvoidingView
            style={styles.keyboardAvoiding}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{settingsRows.find((row) => row.section === section)?.title}</Text>
              <Pressable onPress={() => setSection(null)} accessibilityRole="button" accessibilityLabel="Close settings">
                <Text style={styles.close}>Done</Text>
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag">
              {renderSection()}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function SettingSwitch({
  colors,
  label,
  value,
  onValueChange,
}: {
  colors: AppColors;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const styles = createStyles(colors);
  return (
    <View style={styles.switchRow}>
      <Text style={styles.optionText}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.red }} />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  keyboardAvoiding: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  profile: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 16, marginBottom: 14 },
  profileContent: { flex: 1 },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 29 },
  photoBadge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  avatarText: { color: colors.onPrimary, fontWeight: '900' },
  username: { color: colors.text, fontSize: 18, fontWeight: '900' },
  biography: { color: colors.muted, fontSize: 13, marginTop: 4 },
  row: { minHeight: 76, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 16, marginBottom: 10 },
  rowIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.softRed, alignItems: 'center', justifyContent: 'center' },
  rowContent: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  rowDetail: { color: colors.muted, fontSize: 12, marginTop: 4, maxWidth: 300 },
  paletteCard: { marginTop: 8, padding: 16, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  paletteTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  paletteOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  paletteOption: { minWidth: '47%', flexGrow: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  paletteOptionSelected: { borderColor: colors.red, backgroundColor: colors.softRed },
  swatches: { flexDirection: 'row', marginRight: 2 },
  swatch: { width: 13, height: 13, borderRadius: 7, marginRight: -3, borderWidth: 1, borderColor: colors.surface },
  paletteLabel: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '700' },
  logout: { height: 54, flexDirection: 'row', gap: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.red, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  logoutText: { color: colors.red, fontWeight: '800' },
  modalHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderColor: colors.border },
  modalTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  close: { color: colors.red, fontWeight: '800', fontSize: 16 },
  modalContent: { padding: 20, gap: 12 },
  label: { color: colors.text, fontWeight: '800', marginBottom: 4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.text },
  helperText: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: -4 },
  multiline: { minHeight: 88, textAlignVertical: 'top', paddingTop: 12 },
  primaryButton: { height: 50, backgroundColor: colors.red, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: colors.onPrimary, fontWeight: '800' },
  sectionLabel: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 10 },
  description: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.border },
  optionText: { color: colors.text, fontWeight: '700', flex: 1 },
  optionCheck: { color: colors.red, fontWeight: '900', fontSize: 18 },
  blockRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  blockInput: { flex: 1 },
  secondaryButton: { minHeight: 46, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.red, justifyContent: 'center' },
  secondaryButtonText: { color: colors.onPrimary, fontWeight: '800' },
  blockedRow: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  link: { color: colors.red, fontWeight: '800' },
  keyFingerprint: { color: colors.text, fontFamily: 'monospace' },
  warning: { color: colors.red, lineHeight: 20 },
  switchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  dangerButton: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.red, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  dangerButtonText: { color: colors.red, fontWeight: '800' },
});
