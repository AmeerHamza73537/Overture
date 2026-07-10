// Chats screen: previous conversations, newest first. Tapping one reopens
// the full conversation in the chat screen (via the chatStore handoff) so the
// user can read it and continue. Rows can also be deleted.

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { ApiError, deleteChat, getChat, listChats } from '@/lib/api';
import { setPendingChat } from '@/lib/chatStore';
import { confirm as confirmDialog, notify } from '@/lib/dialogs';
import type { ChatSummary } from '@/lib/types';

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

/** Pure fetch (no setState) shared by the mount effect and pull-to-refresh. */
async function fetchChats(): Promise<{ chats: ChatSummary[]; error: string | null }> {
  try {
    return { chats: await listChats(), error: null };
  } catch (err) {
    return {
      chats: [],
      error: err instanceof ApiError ? err.message : 'Could not load chats.',
    };
  }
}

export default function ChatsScreen() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const apply = useCallback((result: { chats: ChatSummary[]; error: string | null }) => {
    setChats(result.chats);
    setError(result.error);
  }, []);

  useEffect(() => {
    let active = true;
    fetchChats().then((result) => {
      if (active) apply(result);
    });
    return () => {
      active = false;
    };
  }, [apply]);

  const refresh = async () => {
    setRefreshing(true);
    apply(await fetchChats());
    setRefreshing(false);
  };

  // Load the full conversation, hand it to the chat screen, go back to it.
  const open = async (chat: ChatSummary) => {
    if (openingId) return;
    setOpeningId(chat.id);
    try {
      setPendingChat(await getChat(chat.id));
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      notify('Could not open chat', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setOpeningId(null);
    }
  };

  const remove = async (chat: ChatSummary) => {
    const ok = await confirmDialog('Delete this chat?', `"${chat.title}" will be removed permanently.`, 'Delete');
    if (!ok) return;
    try {
      await deleteChat(chat.id);
      setChats((prev) => prev?.filter((c) => c.id !== chat.id) ?? prev);
    } catch (err) {
      notify('Delete failed', err instanceof ApiError ? err.message : 'Please try again.');
    }
  };

  if (chats === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={chats}
      keyExtractor={(c) => c.id}
      contentContainerStyle={chats.length === 0 ? styles.centerContent : styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="chatbubbles-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>{error ? 'Couldn’t load chats' : 'No chats yet'}</Text>
          <Text style={styles.emptyText}>
            {error ?? 'Your conversations are saved automatically. Start one from the chat screen.'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          onPress={() => open(item)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.rowBody}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.meta}>{timeAgo(item.updated_at)}</Text>
          </View>
          {openingId === item.id ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Pressable onPress={() => remove(item)} hitSlop={10} accessibilityLabel="Delete chat">
              <Ionicons name="trash-outline" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
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
  title: {
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
