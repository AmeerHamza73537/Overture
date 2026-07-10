import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '@/constants/theme';

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
        <Stack.Screen name="index" options={{ title: 'Overture' }} />
        <Stack.Screen name="history" options={{ title: 'Chats' }} />
        <Stack.Screen name="gmail" options={{ title: 'Gmail account' }} />
        <Stack.Screen name="compose" options={{ title: 'Write outreach' }} />
      </Stack>
    </ThemeProvider>
  );
}
