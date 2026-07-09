// Bottom sheet with quick actions for a tapped lead: copy email, open
// LinkedIn, open website. Implemented with a plain Modal to avoid extra deps.

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Lead } from '@/lib/types';

type ActionRow = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void | Promise<void>;
};

export function LeadActionsSheet({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!lead) return null;

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(label);
    setTimeout(() => {
      setCopied(null);
      onClose();
    }, 700);
  };

  const website = lead.type === 'person' ? lead.company_website : lead.website;
  const email = lead.type === 'person' ? lead.email : null;

  const actions: ActionRow[] = [];
  if (email) {
    actions.push({
      key: 'copy-email',
      icon: 'copy-outline',
      label: copied === 'email' ? 'Copied!' : 'Copy email',
      onPress: () => copy('email', email),
    });
    actions.push({
      key: 'mail',
      icon: 'mail-outline',
      label: 'Send email',
      onPress: () => Linking.openURL(`mailto:${email}`),
    });
  }
  if (lead.linkedin_url) {
    actions.push({
      key: 'linkedin',
      icon: 'logo-linkedin',
      label: 'Open LinkedIn',
      onPress: () => Linking.openURL(lead.linkedin_url!),
    });
  }
  if (website) {
    actions.push({
      key: 'website',
      icon: 'globe-outline',
      label: 'Open website',
      onPress: () => Linking.openURL(website),
    });
  }
  if (lead.name) {
    actions.push({
      key: 'copy-name',
      icon: 'person-outline',
      label: copied === 'name' ? 'Copied!' : 'Copy name',
      onPress: () => copy('name', lead.name!),
    });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={1}>
            {lead.name ?? 'Lead'}
          </Text>
          {lead.type === 'person' && (lead.title || lead.company) ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {[lead.title, lead.company].filter(Boolean).join(' · ')}
            </Text>
          ) : null}

          <View style={styles.actions}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                onPress={action.onPress}
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              >
                <Ionicons name={action.icon} size={20} color={Colors.primary} />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </Pressable>
            ))}
            {actions.length === 0 && (
              <Text style={styles.subtitle}>No actions available for this lead.</Text>
            )}
          </View>

          <Pressable onPress={onClose} style={({ pressed }) => [styles.cancel, pressed && styles.actionPressed]}>
            <Text style={styles.cancelLabel}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.xl,
    paddingBottom: Spacing.xl + Spacing.md,
    gap: Spacing.xs,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  actions: {
    marginTop: Spacing.lg,
    gap: 2,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  actionPressed: {
    backgroundColor: Colors.primarySoft,
  },
  actionLabel: {
    fontSize: 15,
    color: Colors.text,
    fontWeight: '500',
  },
  cancel: {
    marginTop: Spacing.md,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textMuted,
  },
});
