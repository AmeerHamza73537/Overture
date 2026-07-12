import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { loadStoredSession, useAuth } from '@/lib/authStore';

const OvertureTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.primary,
    background: Colors.background,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
  },
};

export default function RootLayout() {
  const { session, loaded } = useAuth();

  // Read the persisted session once at launch; until then show a neutral
  // loading view instead of flashing the sign-in screen at a signed-in user.
  useEffect(() => {
    void loadStoredSession();
  }, []);

  if (!loaded) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: Colors.background,
        }}
      >
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const authed = Boolean(session);

  return (
    <ThemeProvider value={OvertureTheme}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTitleStyle: { fontWeight: '700', color: Colors.text },
          headerShadowVisible: false,
          headerTintColor: Colors.primary,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
        {/* Main app — only while signed in. Signing out flips the guard and
            expo-router redirects to the first available screen (sign-in). */}
        <Stack.Protected guard={authed}>
          <Stack.Screen name="index" options={{ title: 'Overture' }} />
          <Stack.Screen name="history" options={{ title: 'Chats' }} />
          <Stack.Screen name="gmail" options={{ title: 'Gmail account' }} />
          <Stack.Screen name="compose" options={{ title: 'Write outreach' }} />
        </Stack.Protected>

        {/* Auth flow — only while signed out. */}
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="sign-up" options={{ title: '' }} />
          <Stack.Screen name="forgot-password" options={{ title: '' }} />
        </Stack.Protected>

        {/* Deep-link target of the reset email — reachable in BOTH states
            (an expired session must still be able to finish a reset). */}
        <Stack.Screen name="reset-password" options={{ title: 'Reset password' }} />
      </Stack>
    </ThemeProvider>
  );
}
