// Shared building blocks for the auth screens (sign in / sign up / forgot /
// reset password): a card layout matching the rest of the app, labelled
// inputs, a primary button with a busy state, and error text.

import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';

export function AuthScreen({
  title,
  subtitle,
  children,
  showLogo = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  showLogo?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {showLogo && (
              <Image source={require('../../assets/images/logo.png')} style={styles.logo} />
            )}
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function FormField({
  label,
  ...inputProps
}: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={Colors.textMuted}
        style={styles.input}
        {...inputProps}
      />
    </View>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField({
  label,
  ...inputProps
}: { label: string } & TextInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          placeholderTextColor={Colors.textMuted}
          style={[styles.input, styles.passwordInput]}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          {...inputProps}
        />
        <Pressable onPress={() => setVisible((v) => !v)} hitSlop={8} style={styles.toggle}>
          <Text style={styles.toggleText}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PrimaryButton({
  label,
  busy = false,
  disabled = false,
  onPress,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const blocked = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      style={({ pressed }) => [styles.button, (pressed || blocked) && styles.buttonPressed]}
    >
      {busy ? (
        <ActivityIndicator color={Colors.textOnPrimary} size="small" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

/** "Question? Action" footer row, e.g. "New here? Create an account". */
export function LinkRow({
  question,
  action,
  onPress,
}: {
  question?: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.linkRow}>
      {question ? <Text style={styles.linkQuestion}>{question}</Text> : null}
      <Pressable onPress={onPress} hitSlop={6}>
        <Text style={styles.linkAction}>{action}</Text>
      </Pressable>
    </View>
  );
}

export function ErrorText({ children }: { children: string | null }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  logo: { width: 64, height: 64, alignSelf: 'center', marginBottom: Spacing.sm },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.sm,
  },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  input: {
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'web' ? Spacing.md : Spacing.sm + 2,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  passwordRow: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 64 },
  toggle: { position: 'absolute', right: Spacing.md },
  toggleText: { color: Colors.primary, fontWeight: '600', fontSize: 13 },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 15 },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.xs,
  },
  linkQuestion: { color: Colors.textMuted, fontSize: 14 },
  linkAction: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
  error: {
    color: Colors.danger,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});
