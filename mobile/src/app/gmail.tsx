// Gmail connection screen: shows whether a Gmail account is connected and
// lets the user connect (browser consent flow) or disconnect.

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { ApiError, disconnectGmail, gmailStatus } from '@/lib/api';
import { startGmailConnect } from '@/lib/gmailConnect';
import type { GmailStatus } from '@/lib/types';

export default function GmailScreen() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(() => {
    gmailStatus()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not reach the server.'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Opens the consent flow, or (phone + local backend) copies the PC link
  // with instructions — see lib/gmailConnect.ts for why.
  const connect = () => startGmailConnect();

  const disconnect = async () => {
    setWorking(true);
    try {
      await disconnectGmail();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disconnect failed.');
    } finally {
      setWorking(false);
    }
  };

  if (!status && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={[styles.iconBadge, status?.connected && styles.iconBadgeOn]}>
          <Ionicons
            name={status?.connected ? 'mail' : 'mail-outline'}
            size={26}
            color={status?.connected ? Colors.textOnPrimary : Colors.primary}
          />
        </View>

        {status?.connected ? (
          <>
            <Text style={styles.title}>Gmail connected</Text>
            <Text style={styles.subtitle}>{status.email ?? 'Your account'}</Text>
            <Text style={styles.hint}>
              Approved outreach emails are sent from this account. Only the
              &quot;send email&quot; permission was granted — the app cannot read your inbox.
            </Text>
            <Pressable
              onPress={disconnect}
              disabled={working}
              style={({ pressed }) => [styles.button, styles.buttonDanger, pressed && styles.pressed]}
            >
              <Text style={styles.buttonDangerText}>{working ? 'Disconnecting…' : 'Disconnect'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Connect your Gmail</Text>
            <Text style={styles.hint}>
              {status?.configured
                ? 'Approve access in the browser, then come back and refresh. In development, finish the Google page in a browser on the PC that runs the backend.'
                : 'The backend has no Google credentials yet. Follow the "Gmail setup" section in backend/README.md, then restart the backend.'}
            </Text>
            {status?.configured && (
              <Pressable onPress={connect} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
                <Ionicons name="logo-google" size={16} color={Colors.textOnPrimary} />
                <Text style={styles.buttonText}>Connect Gmail</Text>
              </Pressable>
            )}
            <Pressable onPress={refresh} style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}>
              <Ionicons name="refresh" size={14} color={Colors.primary} />
              <Text style={styles.refreshText}>Refresh status</Text>
            </Pressable>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: Spacing.lg, alignItems: 'center' },
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgeOn: { backgroundColor: Colors.success },
  title: { fontSize: 19, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 15, fontWeight: '600', color: Colors.primary },
  hint: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  buttonText: { color: Colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  buttonDanger: { backgroundColor: Colors.dangerSoft },
  buttonDangerText: { color: Colors.danger, fontWeight: '600', fontSize: 15 },
  refresh: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: Spacing.sm },
  refreshText: { color: Colors.primary, fontWeight: '600', fontSize: 13 },
  pressed: { opacity: 0.7 },
  error: { color: Colors.danger, fontSize: 13, textAlign: 'center' },
});
