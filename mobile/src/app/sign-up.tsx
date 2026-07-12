// Account creation. The backend returns a ready-to-use session, so a
// successful signup drops the user straight into the app (the root guard
// flips when the session is stored).

import { useState } from 'react';

import {
  AuthScreen,
  ErrorText,
  FormField,
  LinkRow,
  PasswordField,
  PrimaryButton,
} from '@/components/auth-ui';
import { ApiError, signUp } from '@/lib/api';
import { router } from 'expo-router';

const PASSWORD_MIN = 8;

export default function SignUpScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await signUp(email.trim(), password, fullName.trim() || undefined);
      // Session stored — the root guard swaps to the main app.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen title="Create your account" subtitle="A minute of setup, then straight to leads.">
      <FormField
        label="Full name (optional)"
        value={fullName}
        onChangeText={setFullName}
        placeholder="Jane Doe"
        autoComplete="name"
        textContentType="name"
      />
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
        placeholder={`At least ${PASSWORD_MIN} characters`}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <PasswordField
        label="Confirm password"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Same password again"
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Create account"
        busy={busy}
        disabled={!email.trim() || !password || !confirm}
        onPress={submit}
      />
      <LinkRow question="Already have an account?" action="Sign in" onPress={() => router.back()} />
    </AuthScreen>
  );
}
