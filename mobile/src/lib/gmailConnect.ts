// Starts the Gmail consent flow from wherever the user tapped "Connect".
//
// The consent URL is fetched from the backend (it is bound to the signed-in
// user via the OAuth `state` value), then opened in a browser.
//
// The catch in development: Google finishes the flow by redirecting the
// browser to http://localhost:3000/api/gmail/callback — "localhost" from the
// PHONE's point of view is the phone itself, so a consent started in the
// phone browser dead-ends after approval (the code never reaches the
// backend, and mobile Chrome falls back to whatever tab it had open).
// Google only allows localhost/https redirect URIs, so the LAN IP can't be
// registered either. The only working dev path is a browser ON THE PC that
// runs the backend — so on a phone talking to a local backend we copy the
// consent link (it works from any browser; Google's redirect back to
// localhost then lands on the PC's backend) and tell the user.
//
// Once the backend is deployed (EXPO_PUBLIC_API_URL=https://...), the phone
// browser can complete the whole flow itself and we just open it.

import * as Clipboard from 'expo-clipboard';
import { Linking, Platform } from 'react-native';
import { ApiError, gmailConnectUrl } from './api';
import { getApiBase } from './config';
import { notify } from './dialogs';

export async function startGmailConnect(): Promise<void> {
  let consent: { url: string; state: string };
  try {
    consent = await gmailConnectUrl();
  } catch (err) {
    notify('Could not start', err instanceof ApiError ? err.message : 'Could not reach the server.');
    return;
  }

  const base = getApiBase();
  const local = base.match(/^http:\/\/(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(?::(\d+))?$/);

  if (Platform.OS !== 'web' && local) {
    // Native app + local backend: hand the user a short link for the PC. The
    // state inside it is what ties the connection to their account.
    const pcLink = `http://localhost:${local[2] ?? '80'}/api/gmail/connect?state=${consent.state}`;
    await Clipboard.setStringAsync(pcLink);
    notify(
      'Finish on your PC',
      'Google sends the result back to the computer running the backend, so the consent page must be completed there.\n\n' +
        `Link copied to clipboard — paste it into a browser on that PC:\n${pcLink}\n\n` +
        'It expires in 10 minutes. Then come back here and tap "Refresh status".',
    );
    return;
  }

  // Web build, or a deployed backend: the browser flow works end-to-end.
  Linking.openURL(consent.url);
}
