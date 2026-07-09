// Compose flow — three steps in one screen:
//   1. campaign  the user states WHY they're reaching out (purpose, their
//                name/company, custom details like offers/links, tone) — once
//                for the whole batch. Nothing generates until they tap the button.
//   2. review    every AI draft shown together; each is manually editable,
//                can be revised with plain-language AI feedback, or excluded.
//   3. results   per-lead sent/failed/skipped after the batch send.

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { ApiError, generateEmails, gmailStatus, reviseEmail, sendEmails } from '@/lib/api';
import { takeComposeLeads } from '@/lib/composeStore';
import { confirm as confirmDialog, notify } from '@/lib/dialogs';
import { startGmailConnect } from '@/lib/gmailConnect';
import type { Campaign, PersonLead, SendResult } from '@/lib/types';

const TONES = ['friendly', 'professional', 'casual', 'direct'];

/** One email being reviewed: the draft plus its UI state. */
interface ReviewItem {
  lead: PersonLead;
  subject: string;
  body: string;
  included: boolean;
  generateError?: string;
  instruction: string; // the AI-feedback input value
  revising: boolean;
  reviseError?: string;
}

export default function ComposeScreen() {
  // Leads are deposited by the results bubble right before navigation.
  const [leads] = useState<PersonLead[]>(() => takeComposeLeads());
  const [step, setStep] = useState<'campaign' | 'review' | 'results'>('campaign');

  // Step 1 state — the once-per-batch context.
  const [purpose, setPurpose] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderCompany, setSenderCompany] = useState('');
  const [details, setDetails] = useState('');
  const [tone, setTone] = useState('friendly');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2/3 state.
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const campaign: Campaign = {
    purpose: purpose.trim(),
    sender_name: senderName.trim(),
    sender_company: senderCompany.trim(),
    details: details.trim(),
    tone,
  };

  // ---- Step 1 -> 2: generate all drafts (explicitly user-triggered) --------
  const generate = async () => {
    if (!campaign.purpose || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const drafts = await generateEmails(leads, campaign);
      setItems(
        leads.map((lead, i) => {
          const draft = drafts[i];
          return {
            lead,
            subject: draft?.subject ?? '',
            body: draft?.body ?? '',
            included: draft?.status === 'ok',
            generateError: draft?.status === 'failed' ? draft.error : undefined,
            instruction: '',
            revising: false,
          };
        }),
      );
      setStep('review');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const updateItem = (index: number, patch: Partial<ReviewItem>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  // ---- Step 2: AI revision of a single draft --------------------------------
  const revise = async (index: number) => {
    const item = items[index];
    const instruction = item.instruction.trim();
    if (!instruction || item.revising) return;
    updateItem(index, { revising: true, reviseError: undefined });
    try {
      // The campaign context is sent along so the AI keeps the outreach
      // intent intact while applying the feedback.
      const revised = await reviseEmail({
        lead: item.lead,
        campaign,
        subject: item.subject,
        body: item.body,
        instruction,
      });
      updateItem(index, {
        subject: revised.subject,
        body: revised.body,
        instruction: '',
        revising: false,
      });
    } catch (err) {
      updateItem(index, {
        revising: false,
        reviseError: err instanceof ApiError ? err.message : 'Revision failed.',
      });
    }
  };

  // ---- Step 2 -> 3: final send ----------------------------------------------
  const included = items.filter((i) => i.included && i.subject.trim() && i.body.trim());

  const confirmSend = async () => {
    if (included.length === 0 || sending) return;

    // Gate on the Gmail connection BEFORE sending so the user gets a clear
    // prompt instead of a batch of failures.
    const status = await gmailStatus().catch(() => null);
    if (!status?.connected) {
      if (status?.configured) {
        const goConnect = await confirmDialog(
          'Gmail not connected',
          'Connect your Gmail account first — emails are sent from your own address.',
          'Connect',
        );
        if (goConnect) await startGmailConnect();
      } else {
        notify(
          'Gmail not configured',
          'The backend has no Google credentials yet. See "Gmail setup" in backend/README.md.',
        );
      }
      return;
    }

    const proceed = await confirmDialog(
      `Send ${included.length} email${included.length === 1 ? '' : 's'}?`,
      `They will be sent from ${status.email ?? 'your Gmail'} with a short pause between each.`,
      'Send',
    );
    if (proceed) await doSend();
  };

  const doSend = async () => {
    setSending(true);
    setError(null);
    try {
      const response = await sendEmails(
        included.map((item) => ({
          lead_id: item.lead.id,
          to: item.lead.email!,
          subject: item.subject.trim(),
          body: item.body.trim(),
        })),
      );
      setResults(response.results);
      setNeedsReconnect(response.needs_reconnect);
      setStep('results');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sending failed. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ---- No leads (screen opened directly) -------------------------------------
  if (leads.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No leads selected. Pick leads from a search result first.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {step === 'campaign' && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>
              Writing to {leads.length} lead{leads.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.stepHint}>
              Tell the AI about your outreach once — every email is personalized from this plus
              each lead&apos;s own data.
            </Text>

            <Text style={styles.label}>Why are you reaching out? *</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              multiline
              value={purpose}
              onChangeText={setPurpose}
              placeholder="e.g. We build AI chatbots that cut support costs; looking for pilot customers"
              placeholderTextColor={Colors.textMuted}
            />

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Text style={styles.label}>Your name</Text>
                <TextInput
                  style={styles.input}
                  value={senderName}
                  onChangeText={setSenderName}
                  placeholder="Jane Doe"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={styles.rowItem}>
                <Text style={styles.label}>Your company</Text>
                <TextInput
                  style={styles.input}
                  value={senderCompany}
                  onChangeText={setSenderCompany}
                  placeholder="Acme AI"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            </View>

            <Text style={styles.label}>Extra details to include (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              multiline
              value={details}
              onChangeText={setDetails}
              placeholder="Offers, pricing, portfolio links, personal notes — the AI will weave these in"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.label}>Tone</Text>
            <View style={styles.tones}>
              {TONES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setTone(t)}
                  style={[styles.toneChip, tone === t && styles.toneChipOn]}
                >
                  <Text style={[styles.toneText, tone === t && styles.toneTextOn]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={generate}
              disabled={!campaign.purpose || generating}
              style={({ pressed }) => [
                styles.primaryBtn,
                (!campaign.purpose || generating) && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
            >
              {generating ? (
                <ActivityIndicator size="small" color={Colors.textOnPrimary} />
              ) : (
                <Ionicons name="sparkles" size={16} color={Colors.textOnPrimary} />
              )}
              <Text style={styles.primaryBtnText}>
                {generating ? 'Writing drafts…' : `Generate ${leads.length} email${leads.length === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          </View>
        )}

        {step === 'review' && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Review before sending</Text>
            <Text style={styles.stepHint}>
              Edit any email directly, or type feedback and tap the wand to have the AI revise it.
              Uncheck the ones you don&apos;t want to send.
            </Text>

            {items.map((item, index) => (
              <View key={item.lead.id ?? index} style={[styles.draftCard, !item.included && styles.draftCardOff]}>
                <View style={styles.draftHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.draftName}>{item.lead.name ?? item.lead.email}</Text>
                    <Text style={styles.draftTo} numberOfLines={1}>
                      to {item.lead.email}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => updateItem(index, { included: !item.included })}
                    hitSlop={10}
                    accessibilityLabel={item.included ? 'Exclude from send' : 'Include in send'}
                  >
                    <Ionicons
                      name={item.included ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={item.included ? Colors.primary : Colors.textMuted}
                    />
                  </Pressable>
                </View>

                {item.generateError ? (
                  <Text style={styles.error}>Draft failed: {item.generateError}</Text>
                ) : null}

                <Text style={styles.smallLabel}>Subject</Text>
                <TextInput
                  style={styles.input}
                  value={item.subject}
                  onChangeText={(v) => updateItem(index, { subject: v })}
                  editable={item.included && !item.revising}
                />

                <Text style={styles.smallLabel}>Body</Text>
                <TextInput
                  style={[styles.input, styles.bodyInput]}
                  multiline
                  value={item.body}
                  onChangeText={(v) => updateItem(index, { body: v })}
                  editable={item.included && !item.revising}
                />

                {/* AI-assisted editing: plain-language feedback for THIS email */}
                <View style={styles.reviseRow}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={item.instruction}
                    onChangeText={(v) => updateItem(index, { instruction: v })}
                    placeholder='AI edit — e.g. "make it shorter", "more formal"'
                    placeholderTextColor={Colors.textMuted}
                    editable={item.included && !item.revising}
                    onSubmitEditing={() => revise(index)}
                  />
                  <Pressable
                    onPress={() => revise(index)}
                    disabled={!item.instruction.trim() || item.revising || !item.included}
                    style={[
                      styles.wandBtn,
                      (!item.instruction.trim() || item.revising || !item.included) && styles.btnDisabled,
                    ]}
                    accessibilityLabel="Revise with AI"
                  >
                    {item.revising ? (
                      <ActivityIndicator size="small" color={Colors.textOnPrimary} />
                    ) : (
                      <Ionicons name="color-wand" size={18} color={Colors.textOnPrimary} />
                    )}
                  </Pressable>
                </View>
                {item.reviseError ? <Text style={styles.error}>{item.reviseError}</Text> : null}
              </View>
            ))}

            <Pressable
              onPress={confirmSend}
              disabled={included.length === 0 || sending}
              style={({ pressed }) => [
                styles.primaryBtn,
                (included.length === 0 || sending) && styles.btnDisabled,
                pressed && styles.pressed,
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color={Colors.textOnPrimary} />
              ) : (
                <Ionicons name="send" size={16} color={Colors.textOnPrimary} />
              )}
              <Text style={styles.primaryBtnText}>
                {sending
                  ? 'Sending… (paced, this takes a moment)'
                  : `Send ${included.length} email${included.length === 1 ? '' : 's'}`}
              </Text>
            </Pressable>
          </View>
        )}

        {step === 'results' && results && (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Send results</Text>
            {needsReconnect ? (
              <View style={styles.reconnect}>
                <Text style={styles.reconnectText}>
                  Gmail access was revoked — reconnect your account to keep sending.
                </Text>
                <Pressable onPress={() => router.push('/gmail')} style={({ pressed }) => [styles.reconnectBtn, pressed && styles.pressed]}>
                  <Text style={styles.reconnectBtnText}>Open Gmail settings</Text>
                </Pressable>
              </View>
            ) : null}

            {results.map((result, index) => {
              const item = items.find((i) => i.lead.id === result.lead_id);
              const icon =
                result.status === 'sent' ? 'checkmark-circle' : result.status === 'failed' ? 'close-circle' : 'remove-circle';
              const color =
                result.status === 'sent' ? Colors.success : result.status === 'failed' ? Colors.danger : Colors.warning;
              return (
                <View key={`${result.lead_id ?? index}`} style={styles.resultRow}>
                  <Ionicons name={icon} size={20} color={color} />
                  <View style={styles.flex}>
                    <Text style={styles.resultName}>{item?.lead.name ?? result.to}</Text>
                    <Text style={styles.resultMeta} numberOfLines={2}>
                      {result.status}
                      {result.error ? ` — ${result.error}` : ''}
                    </Text>
                  </View>
                </View>
              );
            })}

            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
            >
              <Text style={styles.primaryBtnText}>Done</Text>
            </Pressable>
          </View>
        )}

        {error ? <Text style={[styles.error, styles.centerText]}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  centerText: { textAlign: 'center' },
  muted: { color: Colors.textMuted, fontSize: 14 },
  scroll: { padding: Spacing.lg, maxWidth: 720, width: '100%', alignSelf: 'center' },
  section: { gap: Spacing.md },
  stepTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  stepHint: { fontSize: 13, color: Colors.textMuted, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.text, marginTop: Spacing.xs },
  smallLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' },
  bodyInput: { minHeight: 140, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: Spacing.md },
  rowItem: { flex: 1, gap: Spacing.xs },
  tones: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  toneChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 7,
  },
  toneChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toneText: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  toneTextOn: { color: Colors.textOnPrimary },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingVertical: 14,
    marginTop: Spacing.md,
  },
  primaryBtnText: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  draftCard: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  draftCardOff: { opacity: 0.55 },
  draftHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  draftName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  draftTo: { fontSize: 12, color: Colors.textMuted },
  reviseRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  wandBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: Colors.danger, fontSize: 13 },
  reconnect: {
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  reconnectText: { color: Colors.warning, fontSize: 13, lineHeight: 19 },
  reconnectBtn: { alignSelf: 'flex-start' },
  reconnectBtnText: { color: Colors.primary, fontWeight: '700', fontSize: 13 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  resultName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  resultMeta: { fontSize: 12, color: Colors.textMuted },
});
