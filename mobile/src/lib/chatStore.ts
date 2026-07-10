// Handoff slot for reopening a chat: the chats screen deposits the loaded
// conversation here, then the chat screen picks it up on focus and restores
// it. Same pattern as composeStore — avoids pushing large message arrays
// through router params.

import type { StoredChat } from './types';

let pending: StoredChat | null = null;

export function setPendingChat(chat: StoredChat) {
  pending = chat;
}

/** Returns the deposited chat (if any) and clears the slot. */
export function takePendingChat(): StoredChat | null {
  const value = pending;
  pending = null;
  return value;
}

/** New chat id, generated app-side so saves are a simple idempotent upsert. */
export function newChatId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Fallback for runtimes without crypto.randomUUID (v4-shaped, random-based).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
