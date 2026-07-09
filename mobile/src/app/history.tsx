// Search history screen: past searches recorded by the backend (Supabase).
// Tapping an entry re-runs it in the chat.

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { ApiError, listSearches } from '@/lib/api';
import { setPendingQuery } from '@/lib/pendingQuery';
import type { HistoryEntry } from '@/lib/types';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

// Pure fetch (no setState) so it can be shared by the mount effect and
// pull-to-refresh without tripping react-hooks/set-state-in-effect.
async function fetchEntries(): Promise<{ entries: HistoryEntry[]; error: string | null }> {
  try {
    return { entries: await listSearches(), error: null };
  } catch (err) {
    return {
      entries: [],
      error: err instanceof ApiError ? err.message : 'Could not load history.',
    };
  }
}

export default function HistoryScreen() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    fetchEntries().then((result) => {
      if (!active) return;
      setEntries(result.entries);
      setError(result.error);
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    const result = await fetchEntries();
    setEntries(result.entries);
    setError(result.error);
    setRefreshing(false);
  };

  const rerun = (entry: HistoryEntry) => {
    setPendingQuery(entry.raw_query);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (entries === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => String(e.id)}
      contentContainerStyle={entries.length === 0 ? styles.centerContent : styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>{error ? 'Couldn’t load history' : 'No searches yet'}</Text>
          <Text style={styles.emptyText}>
            {error ?? 'Your past searches will appear here. Run one from the chat to get started.'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => rerun(item)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.rowBody}>
            <Text style={styles.query} numberOfLines={2}>
              {item.raw_query}
            </Text>
            <Text style={styles.meta}>
              {timeAgo(item.created_at)}
              {typeof item.result_count === 'number' ? ` · ${item.result_count} leads` : ''}
            </Text>
          </View>
          <Ionicons name="refresh-outline" size={18} color={Colors.primary} />
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  list: {
    padding: Spacing.lg,
    gap: Spacing.sm,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  rowPressed: {
    backgroundColor: Colors.primarySoft,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  query: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
  },
  meta: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 320,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});
