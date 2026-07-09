// One lead (person or company) rendered as a tappable card inside the
// results bubble. Tapping opens the actions sheet (copy email, LinkedIn…).

import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Lead } from '@/lib/types';

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function VerificationBadge({ status, confidence }: { status: string | null; confidence: number | null }) {
  if (!status && confidence === null) return null;
  const isValid = status === 'valid';
  return (
    <View style={[styles.badge, isValid ? styles.badgeValid : styles.badgeNeutral]}>
      <Ionicons
        name={isValid ? 'checkmark-circle' : 'help-circle'}
        size={12}
        color={isValid ? Colors.success : Colors.warning}
      />
      <Text style={[styles.badgeText, { color: isValid ? Colors.success : Colors.warning }]}>
        {status ?? 'unverified'}
        {confidence !== null ? ` · ${confidence}%` : ''}
      </Text>
    </View>
  );
}

interface LeadCardProps {
  lead: Lead;
  onPress: (lead: Lead) => void;
  /** When set, a selection checkbox is shown (used for "write emails"). */
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function LeadCard({ lead, onPress, selected, onToggleSelect }: LeadCardProps) {
  const isPerson = lead.type === 'person';
  const subtitle = isPerson
    ? [lead.title, lead.company].filter(Boolean).join(' · ')
    : [lead.industry, lead.employee_count ? `${lead.employee_count} employees` : null]
        .filter(Boolean)
        .join(' · ');

  return (
    <Pressable
      onPress={() => onPress(lead)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Lead: ${lead.name ?? 'Unknown'}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(lead.name)}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {lead.name ?? 'Unknown'}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}

        {isPerson && lead.email ? (
          <View style={styles.emailRow}>
            <Text style={styles.email} numberOfLines={1}>
              {lead.email}
            </Text>
            <VerificationBadge status={lead.email_verification} confidence={lead.email_confidence} />
          </View>
        ) : null}

        {!isPerson && lead.emails_available ? (
          <Text style={styles.subtitle}>{lead.emails_available} contacts available</Text>
        ) : null}

        {lead.location ? (
          <Text style={styles.location} numberOfLines={1}>
            <Ionicons name="location-outline" size={12} color={Colors.textMuted} /> {lead.location}
          </Text>
        ) : null}
      </View>

      {onToggleSelect ? (
        <Pressable onPress={onToggleSelect} hitSlop={10} accessibilityLabel={selected ? 'Deselect' : 'Select'}>
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={22}
            color={selected ? Colors.primary : Colors.textMuted}
          />
        </Pressable>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  cardPressed: {
    backgroundColor: Colors.primarySoft,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: Colors.primaryPressed,
    fontWeight: '700',
    fontSize: 15,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  email: {
    fontSize: 13,
    color: Colors.primary,
    flexShrink: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeValid: {
    backgroundColor: Colors.successSoft,
  },
  badgeNeutral: {
    backgroundColor: Colors.warningSoft,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  location: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});
