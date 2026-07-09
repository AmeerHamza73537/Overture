// Assistant bubble showing how the query was interpreted: grouped filter
// chips plus any assumptions the parser made.

import { StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { LeadFilters } from '@/lib/types';

function ChipGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {values.map((value) => (
          <View key={value} style={styles.chip}>
            <Text style={styles.chipText}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function FilterSummary({ filters }: { filters: LeadFilters }) {
  const locations = [
    ...new Set([...filters.person_locations, ...filters.organization_locations]),
  ];

  return (
    <View style={styles.bubble}>
      <Text style={styles.heading}>
        {filters.search_type === 'organizations'
          ? "Here's how I understood it — searching for companies:"
          : "Here's how I understood it — searching for people:"}
      </Text>

      <ChipGroup label="Roles" values={filters.job_titles} />
      <ChipGroup label="Departments" values={filters.departments} />
      <ChipGroup label="Seniority" values={filters.seniorities} />
      <ChipGroup label="Locations" values={locations} />
      <ChipGroup label="Industries" values={filters.industries} />
      <ChipGroup
        label="Company size"
        values={filters.employee_ranges.map((r) => `${r} employees`)}
      />
      <ChipGroup label="Keywords" values={filters.keywords ? [filters.keywords] : []} />

      {filters.assumptions.length > 0 && (
        <View style={styles.assumptions}>
          {filters.assumptions.map((a) => (
            <Text key={a} style={styles.assumptionText}>
              • {a}
            </Text>
          ))}
        </View>
      )}

      {filters.needs_clarification && (
        <View style={styles.clarify}>
          <Text style={styles.clarifyText}>
            That was quite broad — I searched with my best guess. Add a role, industry or
            location for sharper results.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'stretch',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.bubble,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  heading: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  group: {
    gap: 6,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
  },
  chipText: {
    color: Colors.primaryPressed,
    fontSize: 13,
    fontWeight: '500',
  },
  assumptions: {
    gap: 2,
  },
  assumptionText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  clarify: {
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  clarifyText: {
    color: Colors.warning,
    fontSize: 13,
    lineHeight: 18,
  },
});
