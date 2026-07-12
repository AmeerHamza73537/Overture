// Sign-in screen — the app's front door when signed out. On success the
// session lands in authStore and the root layout's guard swaps the stack to
// the main app automatically.

import { router } from 'expo-router';
import { useState } from 'react';

import {
  AuthScreen,
  ErrorText,
  FormField,
  LinkRow,
  PasswordField,
  PrimaryButton,
} from '@/components/auth-ui';
import { ApiError, signIn } from '@/lib/api';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // No navigation needed — setting the session flips the root guard.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen
      showLogo
      title="Welcome back"
      subtitle="Sign in to find leads and send outreach."
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
      />
      <PasswordField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Sign in"
        busy={busy}
        disabled={!email.trim() || !password}
        onPress={submit}
      />
      <LinkRow action="Forgot password?" onPress={() => router.push('/forgot-password')} />
      <LinkRow
        question="New here?"
        action="Create an account"
        onPress={() => router.push('/sign-up')}
      />
    </AuthScreen>
  );
}
