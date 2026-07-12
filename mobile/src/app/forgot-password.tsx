// Forgot password: the user enters their email and the backend has Supabase
// send a reset link. The link deep-links back into THIS app's reset-password
// screen — Linking.createURL gives the right URL for wherever the app is
// running (overture://reset-password in a build, exp://.../--/reset-password
// in Expo Go). That URL must be on the Supabase redirect allowlist — see
// backend/README.md "Authentication".

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreen, ErrorText, FormField, LinkRow, PrimaryButton } from '@/components/auth-ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { ApiError, forgotPassword } from '@/lib/api';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim(), Linking.createURL('reset-password'));
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <AuthScreen title="Check your email" subtitle={`If an account exists for ${sentTo}, a reset link is on its way.`}>
        <View style={styles.hintBox}>
          <Text style={styles.hint}>
            Open the link on THIS device — it brings you back here to set a new
            password. It can take a minute to arrive; check spam too.
          </Text>
        </View>
        <PrimaryButton label="Back to sign in" onPress={() => router.dismissTo('/sign-in')} />
        <LinkRow question="Wrong address?" action="Try again" onPress={() => setSentTo(null)} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Reset your password"
      subtitle="Enter your account email and we'll send you a link to set a new password."
    >
      <FormField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@company.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton label="Send reset link" busy={busy} disabled={!email.trim()} onPress={submit} />
      <LinkRow question="Remembered it?" action="Sign in" onPress={() => router.back()} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  hintBox: {
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  hint: {
    color: Colors.primaryPressed,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
