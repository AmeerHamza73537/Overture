// Session store: the signed-in user's tokens + profile, kept in memory for
// synchronous access (the API client reads it on every request) and persisted
// so the user stays signed in across launches — SecureStore (Keychain /
// Keystore) on native, localStorage on web.
//
// SecureStore caps values at 2048 bytes and a session carries two JWTs, so it
// is persisted as two keys: the access token alone, and everything else.

import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import type { AuthSession } from './types';

const ACCESS_KEY = 'overture.session.access';
const REST_KEY = 'overture.session.rest';

let session: AuthSession | null = null;
let loaded = false; // false until the stored session has been read once
let snapshot: { session: AuthSession | null; loaded: boolean } = { session, loaded };

const listeners = new Set<() => void>();

function emit() {
  snapshot = { session, loaded };
  listeners.forEach((l) => l());
}

// ---- Storage (per platform) ---------------------------------------------------

const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* private mode etc. — session just won't survive a reload */
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

async function persist(next: AuthSession | null): Promise<void> {
  try {
    if (!next) {
      await Promise.all([storage.remove(ACCESS_KEY), storage.remove(REST_KEY)]);
      return;
    }
    const { access_token, ...rest } = next;
    await Promise.all([
      storage.set(ACCESS_KEY, access_token),
      storage.set(REST_KEY, JSON.stringify(rest)),
    ]);
  } catch {
    // Persistence is best-effort: worst case the user signs in again next launch.
  }
}

// ---- Public API -----------------------------------------------------------------

/** Read the persisted session once at app start. Safe to call repeatedly. */
export async function loadStoredSession(): Promise<void> {
  if (loaded) return;
  try {
    const [accessToken, restJson] = await Promise.all([
      storage.get(ACCESS_KEY),
      storage.get(REST_KEY),
    ]);
    if (accessToken && restJson) {
      const rest = JSON.parse(restJson) as Omit<AuthSession, 'access_token'>;
      if (rest?.refresh_token && rest?.user?.id) {
        session = { access_token: accessToken, ...rest };
      }
    }
  } catch {
    session = null; // corrupt storage — treat as signed out
  }
  loaded = true;
  emit();
}

export function getSession(): AuthSession | null {
  return session;
}

/** Set (or clear, with null) the current session. Persists asynchronously. */
export function setSession(next: AuthSession | null): void {
  session = next;
  if (!loaded) loaded = true; // a fresh sign-in also counts as "loaded"
  void persist(next);
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: { session, loaded } — re-renders on sign-in/out. */
export function useAuth(): { session: AuthSession | null; loaded: boolean } {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
