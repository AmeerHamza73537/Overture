// Chat screen — the heart of the app. The user describes who they want to
// reach; the assistant replies with its interpretation (filters) and then the
// matching leads, all rendered as chat messages.

import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
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
import { ApiError, parseQuery, saveChat, searchLeads } from '@/lib/api';
import { newChatId, takePendingChat } from '@/lib/chatStore';
import type { ChatMessage, Lead } from '@/lib/types';

const PER_PAGE = 10;

const SUGGESTIONS = [
  'Marketing leaders at fintech companies in the US',
  'Founders of SaaS startups in Germany with 11-50 employees',
  'HR managers at healthcare companies in Canada',
];

// Persistent messages (ChatMessage, from types.ts) + the transient typing dots.
type UiMessage = ChatMessage | { id: string; kind: 'typing' };

let nextId = 0;
const uid = () => `msg-${++nextId}`;

/** After restoring a chat, continue ids past the stored ones (no key clashes). */
function bumpUidPast(messages: ChatMessage[]) {
  for (const m of messages) {
    const n = Number(m.id?.split('-')[1]);
    if (Number.isFinite(n) && n >= nextId) nextId = n + 1;
  }
}

export default function ChatScreen() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const listRef = useRef<FlatList<UiMessage>>(null);
  // Ref-based in-flight guard: state updates are async, so a fast double-tap
  // would pass a `busy` state check twice and fire the search twice.
  const inFlight = useRef(false);
  // Which stored chat this conversation belongs to. Created lazily on the
  // first message; replaced when a previous chat is reopened.
  const chatIdRef = useRef<string | null>(null);
  // Last payload we successfully saved — skips redundant saves (and prevents
  // an immediate re-save right after restoring a chat).
  const lastSavedRef = useRef('');

  const append = (...items: UiMessage[]) =>
    setMessages((prev) => [...prev.filter((m) => m.kind !== 'typing'), ...items]);

  const send = useCallback(
    async (query: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      // First message of a fresh conversation -> mint the chat's id.
      if (!chatIdRef.current) chatIdRef.current = newChatId();
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
    let target: Extract<UiMessage, { kind: 'results' }> | undefined;
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

  // A previous chat was tapped in the chats screen — restore it here so the
  // user can read it and continue the conversation where it left off.
  useFocusEffect(
    useCallback(() => {
      const pending = takePendingChat();
      if (!pending) return;
      const restored = pending.messages ?? [];
      chatIdRef.current = pending.id;
      lastSavedRef.current = JSON.stringify(restored); // already saved — don't re-save
      bumpUidPast(restored);
      setMessages(restored);
      setActiveLead(null);
    }, []),
  );

  // Auto-save: after every completed turn (and load-more), persist the whole
  // conversation. Debounced, deduplicated, best-effort — a failed save never
  // interrupts the chat; storage problems surface on the chats screen.
  useEffect(() => {
    if (busy) return;
    const persistable = messages
      .filter((m): m is ChatMessage => m.kind !== 'typing')
      .map((m) => (m.kind === 'results' ? { ...m, loadingMore: false } : m));
    const firstUser = persistable.find((m) => m.kind === 'user');
    if (!firstUser || !chatIdRef.current) return;

    const payload = JSON.stringify(persistable);
    if (payload === lastSavedRef.current) return;

    const id = chatIdRef.current;
    const title = firstUser.text.slice(0, 80);
    const timer = setTimeout(() => {
      saveChat(id, title, persistable)
        .then(() => {
          lastSavedRef.current = payload;
        })
        .catch(() => {
          /* retried on the next message; chats screen shows storage errors */
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [messages, busy]);

  const clearChat = () => {
    chatIdRef.current = null;
    lastSavedRef.current = '';
    setMessages([]);
    setActiveLead(null);
  };

  const renderMessage = ({ item }: { item: UiMessage }) => {
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
                accessibilityLabel="Previous chats"
              >
                <Ionicons name="chatbubbles-outline" size={22} color={Colors.primary} />
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
            <Image source={require('../../assets/images/logo.png')} style={styles.emptyLogo} />
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
  emptyLogo: {
    width: 76,
    height: 76,
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
