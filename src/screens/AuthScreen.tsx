import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppStore } from '../store/appStore';
import { AppColors, useAppColors } from '../theme/colors';
import { registerAccount, signInAccount } from '../services/accountService';
import { PoweredByTag } from '../components/PoweredByTag';

export function AuthScreen() {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const savedRememberMe = useAppStore((state) => state.rememberMe);
  const [rememberMe, setRememberMe] = useState(savedRememberMe);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const setProfile = useAppStore((state) => state.setProfile);
  const colors = useAppColors();
  const styles = createStyles(colors);

  useEffect(() => {
    setRememberMe(savedRememberMe);
  }, [savedRememberMe]);

  const submit = async () => {
    const clean = username.trim().replace(/^@/, '');
    if (mode === 'register' && !/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(clean)) {
      setErrorMessage('Use 3–24 letters, numbers or underscores for your username, starting with a letter.');
      return;
    }
    if (!email.trim() || !password) {
      setErrorMessage('Enter your email and password to continue.');
      return;
    }
    if (password.length < 8) {
      setErrorMessage('Use a password with at least 8 characters.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const profile =
        mode === 'register'
          ? await registerAccount(email, password, clean)
          : await signInAccount(email, password, rememberMe);
      if (!profile) {
        setErrorMessage(
          'Email confirmation is enabled. Turn off Confirm email in your Supabase Email provider settings, remove this pending account, and sign up again.',
        );
        return;
      }
      setProfile(profile, mode === 'register' || rememberMe);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Account setup failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={styles.card}>
            <View style={styles.brandRow}>
              <View style={styles.brandIcon}>
                <Ionicons name="chatbubbles" size={25} color={colors.onPrimary} />
              </View>
              <View>
                <Text style={styles.brand}>OrdboxLink</Text>
                <Text style={styles.brandSubtitle}>Private conversations</Text>
              </View>
            </View>
            <PoweredByTag />
            <Text style={styles.title}>{mode === 'register' ? 'Create your identity' : 'Welcome back'}</Text>
            <Text style={styles.notice}>Join to find and message your people.</Text>
            {errorMessage && (
              <Text accessibilityRole="alert" style={styles.errorMessage}>
                {errorMessage}
              </Text>
            )}
            <View style={styles.segment}>
              <Pressable style={[styles.segmentButton, mode === 'register' && styles.segmentActive]} onPress={() => setMode('register')}>
                <Ionicons name="person-add-outline" size={16} color={mode === 'register' ? colors.red : colors.muted} />
                <Text style={[styles.segmentText, mode === 'register' && styles.segmentTextActive]}>Sign up</Text>
              </Pressable>
              <Pressable style={[styles.segmentButton, mode === 'login' && styles.segmentActive]} onPress={() => setMode('login')}>
                <Ionicons name="log-in-outline" size={17} color={mode === 'login' ? colors.red : colors.muted} />
                <Text style={[styles.segmentText, mode === 'login' && styles.segmentTextActive]}>Log in</Text>
              </Pressable>
            </View>
            {mode === 'register' && (
              <>
                <Text style={styles.label}>Username</Text>
                <TextInput value={username} onChangeText={setUsername} placeholder="@SilentLion" autoCapitalize="none" autoCorrect={false} style={styles.input} />
              </>
            )}
            <Text style={styles.label}>Email</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoCorrect={false} style={styles.input} />
            <Text style={styles.label}>Password</Text>
            <TextInput value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry style={styles.input} />
            {mode === 'login' && (
              <Pressable
                style={styles.rememberRow}
                onPress={() => setRememberMe((current) => !current)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberMe }}>
                <Ionicons
                  name={rememberMe ? 'checkbox' : 'square-outline'}
                  size={21}
                  color={rememberMe ? colors.red : colors.muted}
                />
                <View style={styles.rememberCopy}>
                  <Text style={styles.rememberTitle}>Remember me</Text>
                  <Text style={styles.rememberDetail}>Stay signed in on this device</Text>
                </View>
              </Pressable>
            )}
            <Pressable style={[styles.button, isSubmitting && styles.buttonDisabled]} onPress={submit} disabled={isSubmitting}>
              <Ionicons name={mode === 'register' ? 'arrow-forward' : 'lock-open-outline'} size={18} color={colors.onPrimary} />
              <Text style={styles.buttonText}>{isSubmitting ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  keyboardAvoiding: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 22 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  brand: { color: colors.text, fontSize: 17, fontWeight: '900' },
  brandSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  title: { color: colors.text, fontSize: 28, fontWeight: '900', marginTop: 8 },
  notice: { color: colors.muted, fontSize: 13, lineHeight: 19, backgroundColor: colors.softSurface, borderRadius: 10, padding: 10, marginTop: 12 },
  errorMessage: { color: colors.red, fontSize: 13, lineHeight: 19, marginTop: 12 },
  segment: { flexDirection: 'row', backgroundColor: colors.background, borderRadius: 12, padding: 4, marginTop: 18 },
  segmentButton: { flex: 1, height: 40, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { color: colors.muted, fontWeight: '700' },
  segmentTextActive: { color: colors.red },
  label: { color: colors.text, fontWeight: '700', marginTop: 16, marginBottom: 7 },
  input: { height: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.text },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13 },
  rememberCopy: { flex: 1 },
  rememberTitle: { color: colors.text, fontWeight: '700' },
  rememberDetail: { color: colors.muted, fontSize: 12, marginTop: 2 },
  button: { height: 54, flexDirection: 'row', gap: 9, backgroundColor: colors.red, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.onPrimary, fontWeight: '800', fontSize: 16 },
});
