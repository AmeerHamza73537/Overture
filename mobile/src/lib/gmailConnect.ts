// Starts the Gmail consent flow from wherever the user tapped "Connect".
//
// The catch in development: Google finishes the flow by redirecting the
// browser to http://localhost:3000/api/gmail/callback — "localhost" from the
// PHONE's point of view is the phone itself, so a consent started in the
// phone browser dead-ends after approval (the code never reaches the
// backend, and mobile Chrome falls back to whatever tab it had open).
// Google only allows localhost/https redirect URIs, so the LAN IP can't be
// registered either. The only working dev path is a browser ON THE PC that
// runs the backend — so on a phone talking to a local backend we copy that
// link and tell the user instead of opening a browser into a dead end.
//
// Once the backend is deployed (EXPO_PUBLIC_API_URL=https://...), the phone
// browser can complete the whole flow itself and we just open it.

import * as Clipboard from 'expo-clipboard';
import { Linking, Platform } from 'react-native';
import { gmailConnectUrl } from './api';
import { notify } from './dialogs';

export async function startGmailConnect(): Promise<void> {
  const url = gmailConnectUrl();
  const match = url.match(/^http:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(?::(\d+))?\//);

  if (Platform.OS !== 'web' && match) {
    // Native app + local backend: hand the user the PC link.
    const pcLink = `http://localhost:${match[2] ?? '80'}/api/gmail/connect`;
    await Clipboard.setStringAsync(pcLink);
    notify(
      'Finish on your PC',
      'Google sends the result back to the computer running the backend, so the consent page must be opened there.\n\n' +
        `Link copied to clipboard — paste it into a browser on that PC:\n${pcLink}\n\n` +
        'Then come back here and tap "Refresh status".',
    );
    return;
  }

  // Web build, or a deployed backend: the browser flow works end-to-end.
  Linking.openURL(url);
}
