// Assistant bubble containing the lead results: summary line, lead cards,
// and footer actions (export CSV / load more).

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { setComposeLeads } from '@/lib/composeStore';
import { exportLeadsCsv } from '@/lib/csv';
import { notify } from '@/lib/dialogs';
import type { Lead, Pagination, PersonLead, SearchType } from '@/lib/types';
import { LeadCard } from './lead-card';

interface Props {
  leads: Lead[];
  pagination: Pagination;
  searchType: SearchType;
  loadingMore: boolean;
  onLoadMore: () => void;
  onLeadPress: (lead: Lead) => void;
}

/** Only person leads with an email address can receive outreach. */
const isEmailable = (lead: Lead): lead is PersonLead =>
  lead.type === 'person' && Boolean(lead.email);

const keyOf = (lead: Lead, index: number) => lead.id ?? `lead-${index}`;

function summaryLine(leads: Lead[], pagination: Pagination, searchType: SearchType): string {
  if (leads.length === 0) {
    return 'No leads found for that search. Try broadening the location, industry or roles.';
  }
  if (searchType === 'organizations') {
    return `Found ${pagination.total_matches.toLocaleString()} matching companies — showing ${leads.length}.`;
  }
  return (
    `Found ${leads.length} contact${leads.length === 1 ? '' : 's'} across ` +
    `${pagination.total_matches.toLocaleString()} matching companies.`
  );
}

export function ResultsBubble({ leads, pagination, searchType, loadingMore, onLoadMore, onLeadPress }: Props) {
  const [exporting, setExporting] = useState(false);
  // Selection for outreach: every emailable lead starts selected; the
  // checkboxes let the user drop the ones they don't want to write to.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const hasMore = pagination.page < pagination.total_pages;

  const emailable = leads.filter(isEmailable);
  const selectedLeads = leads
    .map((lead, index) => ({ lead, key: keyOf(lead, index) }))
    .filter(({ lead, key }) => isEmailable(lead) && !deselected.has(key))
    .map(({ lead }) => lead as PersonLead);

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleExport = async () => {
    if (exporting || leads.length === 0) return;
    setExporting(true);
    try {
      await exportLeadsCsv(leads);
    } catch (err) {
      // Tell the user WHY it failed instead of failing silently.
      notify('Export failed', err instanceof Error ? err.message : 'Could not create the CSV file.');
    } finally {
      setExporting(false);
    }
  };

  const startCompose = () => {
    if (selectedLeads.length === 0) return;
    setComposeLeads(selectedLeads);
    router.push('/compose');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.summary}>{summaryLine(leads, pagination, searchType)}</Text>

      <View style={styles.cards}>
        {leads.map((lead, index) => {
          const key = keyOf(lead, index);
          return (
            <LeadCard
              key={key}
              lead={lead}
              onPress={onLeadPress}
              selected={isEmailable(lead) ? !deselected.has(key) : undefined}
              onToggleSelect={isEmailable(lead) ? () => toggle(key) : undefined}
            />
          );
        })}
      </View>

      {leads.length > 0 && (
        <View style={styles.footer}>
          {emailable.length > 0 && (
            <Pressable
              onPress={startCompose}
              disabled={selectedLeads.length === 0}
              style={({ pressed }) => [
                styles.footerBtn,
                styles.footerBtnPrimary,
                selectedLeads.length === 0 && styles.footerBtnDisabled,
                pressed && styles.footerBtnPressed,
              ]}
            >
              <Ionicons name="mail-outline" size={16} color={Colors.textOnPrimary} />
              <Text style={[styles.footerBtnText, styles.footerBtnTextPrimary]}>
                Write emails ({selectedLeads.length})
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={handleExport}
            style={({ pressed }) => [styles.footerBtn, pressed && styles.footerBtnPressed]}
          >
            <Ionicons name="download-outline" size={16} color={Colors.primary} />
            <Text style={styles.footerBtnText}>{exporting ? 'Exporting…' : 'Export CSV'}</Text>
          </Pressable>

          {hasMore && (
            <Pressable
              onPress={onLoadMore}
              disabled={loadingMore}
              style={({ pressed }) => [styles.footerBtn, pressed && styles.footerBtnPressed]}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
              )}
              <Text style={styles.footerBtnText}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    gap: Spacing.md,
  },
  summary: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.bubble,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
  cards: {
    gap: Spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  footerBtnPrimary: {
    backgroundColor: Colors.primary,
  },
  footerBtnDisabled: {
    opacity: 0.5,
  },
  footerBtnPressed: {
    opacity: 0.7,
  },
  footerBtnText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  footerBtnTextPrimary: {
    color: Colors.textOnPrimary,
  },
});
