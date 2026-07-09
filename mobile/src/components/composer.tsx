// The chat input bar pinned to the bottom of the chat screen.

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Colors, Radius, Spacing } from '@/constants/theme';

export function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const canSend = !busy && text.trim().length > 0;

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    onSend(value);
  };

  return (
    <View style={styles.bar}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Describe who you want to reach…"
        placeholderTextColor={Colors.textMuted}
        multiline
        maxLength={500}
        editable={!busy}
        onSubmitEditing={submit}
        submitBehavior="blurAndSubmit"
        returnKeyType="send"
      />
      <Pressable
        onPress={submit}
        disabled={!canSend}
        style={({ pressed }) => [
          styles.send,
          !canSend && styles.sendDisabled,
          pressed && canSend && styles.sendPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send"
      >
        <Ionicons name="arrow-up" size={20} color={Colors.textOnPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: Colors.background,
    borderRadius: Radius.bubble,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
  },
  send: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: {
    backgroundColor: Colors.primaryPressed,
  },
  sendDisabled: {
    backgroundColor: Colors.border,
  },
});
