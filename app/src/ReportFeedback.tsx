import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { sendReportFeedback } from "./relay";
import { colors, styles as s } from "./theme";

type Report = { id: string; updatedAt: string; feedbackContext?: { agentId?: string } };
export default function ReportFeedback({ page }: { page: Report }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const sending = useRef(false);
  const attempt = useRef<{ id: string; text: string; version: string } | null>(null);
  async function send() {
    const message = text.trim();
    if (!message || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    if (attempt.current?.text !== message || attempt.current.version !== page.updatedAt)
      attempt.current = { id: Crypto.randomUUID(), text: message, version: page.updatedAt };
    try {
      await sendReportFeedback(attempt.current.id, page.id, page.updatedAt, message);
      setText("");
      attempt.current = null;
      setStatus("Feedback submitted with this report’s context.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send feedback. Your message is still here; try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const recipient = page.feedbackContext?.agentId;
  return <View style={s.card}>
    <Text accessibilityRole="header" style={s.title}>Give feedback</Text>
    <Text style={s.muted}>{recipient ? `To ${recipient}` : "To your agent"} · This report’s context is included.</Text>
    <TextInput
      accessibilityLabel="Feedback for your agent"
      placeholder="What should your agent know or change?"
      placeholderTextColor={colors.secondary}
      multiline
      maxLength={4000}
      editable={!busy}
      value={text}
      onChangeText={value => { setText(value); setStatus(""); }}
      style={[s.input, { minHeight: 110, textAlignVertical: "top", borderWidth: 1, borderColor: colors.separator }]}
    />
    {error !== "" && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {status !== "" && <Text accessibilityRole="alert" style={s.text}>{status}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !text.trim(), busy }} disabled={busy || !text.trim()} onPress={() => void send()} style={[s.button, { opacity: busy || !text.trim() ? 0.5 : 1 }]}>
      <Text style={s.buttonText}>{busy ? "Sending…" : "Send feedback"}</Text>
    </Pressable>
  </View>;
}
