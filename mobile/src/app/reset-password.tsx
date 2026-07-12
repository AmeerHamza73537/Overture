// Reset-password screen — the deep-link target of the reset email.
//
// Supabase verifies the emailed link, then redirects the browser to this
// screen's deep link with a short-lived RECOVERY session in the URL fragment:
//   overture://reset-password#access_token=...&refresh_token=...&type=recovery
// (or #error=...&error_description=... when the link is expired/used).
// We parse that fragment, collect a new password, and send both to the
// backend, which verifies the token and updates the password.
//
// The screen is deliberately OUTSIDE both route guards: it must open whether
// or not someone is signed in on this device.

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';

import {
  AuthScreen,
  ErrorText,
  LinkRow,
  PasswordField,
  PrimaryButton,
} from '@/components/auth-ui';
import { ApiError, resetPassword } from '@/lib/api';
import { setSession, useAuth } from '@/lib/authStore';
import { notify } from '@/lib/dialogs';

const PASSWORD_MIN = 8;

/** Parse `#a=1&b=2` (and `?a=1`) params out of a deep-link URL by hand —
 * avoids relying on URL/URLSearchParams quirks across RN runtimes. */
function parseLinkParams(url: string | null): Record<string, string> {
  if (!url) return {};
  const params: Record<string, string> = {};
  const raw = [url.split('#')[1], url.split('?')[1]?.split('#')[0]]
    .filter(Boolean)
    .join('&');
  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    try {
      params[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
        pair.slice(eq + 1).replace(/\+/g, ' '),
      );
    } catch {
      /* skip malformed pair */
    }
  }
  return params;
}

export default function ResetPasswordScreen() {
  // On native the deep link arrives through expo-linking; on web useURL can
  // miss the URL fragment, so read the browser's location directly there.
  // (window is absent during static rendering — hence the typeof guard.)
  const nativeUrl = Linking.useURL();
  const url =
    Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href : nativeUrl;
  const { session } = useAuth();
  const link = useMemo(() => parseLinkParams(url), [url]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token = link.access_token ?? null;
  const linkError = link.error_description ?? (link.error ? 'This reset link is invalid.' : null);

  const submit = async () => {
    if (busy || !token) return;
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
      await resetPassword(token, password);
      // The backend revoked every session on the account (including any on
      // this device), so clear local state and head to sign-in.
      setSession(null);
      notify('Password updated', 'Sign in with your new password.');
      router.replace('/sign-in');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Link expired / already used / opened without a token.
  if (!token) {
    return (
      <AuthScreen
        title={linkError ? 'Link expired' : 'Open your reset link'}
        subtitle={
          linkError ??
          'This screen opens from the link in the password-reset email. Request a link and tap it on this device.'
        }
      >
        <PrimaryButton
          label="Request a new link"
          onPress={() => router.replace('/forgot-password')}
        />
        <LinkRow
          action={session ? 'Back to the app' : 'Back to sign in'}
          onPress={() => router.replace(session ? '/' : '/sign-in')}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title="Set a new password" subtitle="Almost done — choose a new password for your account.">
      <PasswordField
        label="New password"
        value={password}
        onChangeText={setPassword}
        placeholder={`At least ${PASSWORD_MIN} characters`}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <PasswordField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        placeholder="Same password again"
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
      />
      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Update password"
        busy={busy}
        disabled={!password || !confirm}
        onPress={submit}
      />
    </AuthScreen>
  );
}
