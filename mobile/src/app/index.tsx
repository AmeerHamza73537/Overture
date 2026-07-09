// Chat screen — the heart of the app. The user describes who they want to
// reach; the assistant replies with its interpretation (filters) and then the
// matching leads, all rendered as chat messages.

import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Composer } from '@/components/composer';
import { FilterSummary } from '@/components/filter-summary';
import { LeadActionsSheet } from '@/components/lead-actions-sheet';
import { ResultsBubble } from '@/components/results-bubble';
import { TypingDots } from '@/components/typing-dots';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { ApiError, parseQuery, searchLeads } from '@/lib/api';
import { takePendingQuery } from '@/lib/pendingQuery';
import type { Lead, LeadFilters, Pagination } from '@/lib/types';

const PER_PAGE = 10;

const SUGGESTIONS = [
  'Marketing leaders at fintech companies in the US',
  'Founders of SaaS startups in Germany with 11-50 employees',
  'HR managers at healthcare companies in Canada',
];

type ChatMessage =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'bot'; text: string }
  | { id: string; kind: 'filters'; filters: LeadFilters }
  | {
      id: string;
      kind: 'results';
      query: string;
      filters: LeadFilters;
      leads: Lead[];
      pagination: Pagination;
      loadingMore: boolean;
    }
  | { id: string; kind: 'typing' }
  | { id: string; kind: 'error'; text: string; retryQuery: string };

let nextId = 0;
const uid = () => `msg-${++nextId}`;

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Ref-based in-flight guard: state updates are async, so a fast double-tap
  // would pass a `busy` state check twice and fire the search twice.
  const inFlight = useRef(false);

  const append = (...items: ChatMessage[]) =>
    setMessages((prev) => [...prev.filter((m) => m.kind !== 'typing'), ...items]);

  const send = useCallback(
    async (query: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      append({ id: uid(), kind: 'user', text: query }, { id: uid(), kind: 'typing' });

      try {
        // 1. Natural language -> structured filters.
        const parsed = await parseQuery(query);
        append({ id: uid(), kind: 'filters', filters: parsed.filters }, { id: uid(), kind: 'typing' });

        // 2. Filters -> leads.
        const result = await searchLeads(parsed.filters, {
          page: 1,
          perPage: PER_PAGE,
          rawQuery: query,
        });
        append({
          id: uid(),
          kind: 'results',
          query,
          filters: parsed.filters,
          leads: result.leads,
          pagination: result.pagination,
          loadingMore: false,
        });
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';
        append({ id: uid(), kind: 'error', text: message, retryQuery: query });
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const loadMore = useCallback(async (messageId: string) => {
    let target: Extract<ChatMessage, { kind: 'results' }> | undefined;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId && m.kind === 'results' && !m.loadingMore) {
          target = m;
          return { ...m, loadingMore: true };
        }
        return m;
      }),
    );
    if (!target) return;

    try {
      const next = await searchLeads(target.filters, {
        page: target.pagination.page + 1,
        perPage: PER_PAGE,
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.kind === 'results'
            ? {
                ...m,
                leads: [...m.leads, ...next.leads],
                pagination: next.pagination,
                loadingMore: false,
              }
            : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId && m.kind === 'results' ? { ...m, loadingMore: false } : m)),
      );
    }
  }, []);

  // A history item was tapped — run it as a fresh chat query.
  useFocusEffect(
    useCallback(() => {
      const pending = takePendingQuery();
      if (pending) send(pending);
    }, [send]),
  );

  const clearChat = () => {
    setMessages([]);
    setActiveLead(null);
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    switch (item.kind) {
      case 'user':
        return (
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{item.text}</Text>
          </View>
        );
      case 'bot':
        return (
          <View style={styles.botBubble}>
            <Text style={styles.botText}>{item.text}</Text>
          </View>
        );
      case 'filters':
        return <FilterSummary filters={item.filters} />;
      case 'results':
        return (
          <ResultsBubble
            leads={item.leads}
            pagination={item.pagination}
            searchType={item.filters.search_type}
            loadingMore={item.loadingMore}
            onLoadMore={() => loadMore(item.id)}
            onLeadPress={setActiveLead}
          />
        );
      case 'typing':
        return <TypingDots />;
      case 'error':
        return (
          <View style={styles.errorBubble}>
            <Text style={styles.errorText}>{item.text}</Text>
            <Pressable onPress={() => send(item.retryQuery)} disabled={busy}>
              <Text style={styles.retryText}>Tap to retry</Text>
            </Pressable>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              {messages.length > 0 && (
                <Pressable onPress={clearChat} hitSlop={8} accessibilityLabel="New chat">
                  <Ionicons name="create-outline" size={22} color={Colors.primary} />
                </Pressable>
              )}
              <Pressable
                onPress={() => router.push('/history')}
                hitSlop={8}
                accessibilityLabel="Search history"
              >
                <Ionicons name="time-outline" size={22} color={Colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => router.push('/gmail')}
                hitSlop={8}
                accessibilityLabel="Gmail account"
              >
                <Ionicons name="mail-outline" size={22} color={Colors.primary} />
              </Pressable>
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyBadge}>
              <Ionicons name="chatbubble-ellipses" size={30} color={Colors.textOnPrimary} />
            </View>
            <Text style={styles.emptyTitle}>Find your next leads</Text>
            <Text style={styles.emptyText}>
              Describe who you want to reach in plain language — I&apos;ll find matching
              contacts with verified emails.
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => send(s)}
                  style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          />
        )}

        <Composer busy={busy} onSend={send} />
      </KeyboardAvoidingView>

      <LeadActionsSheet lead={activeLead} onClose={() => setActiveLead(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  headerButtons: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  list: {
    padding: Spacing.lg,
    gap: Spacing.md,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.bubble,
    borderBottomRightRadius: Radius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  userText: {
    color: Colors.textOnPrimary,
    fontSize: 15,
    lineHeight: 21,
  },
  botBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.bubble,
    borderBottomLeftRadius: Radius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  botText: {
    color: Colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: Colors.dangerSoft,
    borderRadius: Radius.bubble,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  retryText: {
    color: Colors.danger,
    fontWeight: '700',
    fontSize: 13,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  emptyBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  suggestions: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
    alignSelf: 'stretch',
  },
  suggestion: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  suggestionPressed: {
    backgroundColor: Colors.primarySoft,
  },
  suggestionText: {
    color: Colors.primaryPressed,
    fontSize: 14,
    fontWeight: '500',
  },
});
