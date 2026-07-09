import Constants from 'expo-constants';

/**
 * Resolve the backend base URL.
 *
 * Priority:
 *  1. EXPO_PUBLIC_API_URL (set this to your deployed backend for release
 *     builds — e.g. in eas.json or .env: EXPO_PUBLIC_API_URL=https://api.example.com)
 *  2. The dev machine that Metro is running on (works out of the box with
 *     Expo Go on the same Wi-Fi — the phone talks to your PC's local backend)
 *  3. localhost (web / last resort)
 */
export function getApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:3000`;

  return 'http://localhost:3000';
}
