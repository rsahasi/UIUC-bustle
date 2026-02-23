import { getRecentLogs } from "@/src/telemetry/logBuffer";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Alert,
  Clipboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

export default function ReportIssueScreen() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const copyLogs = useCallback(() => {
    const header = "--- UIUC Bus app debug logs (no PII) ---\n";
    const logs = getRecentLogs();
    const body = logs || "(no logs yet)";
    Clipboard.setString(header + body);
    setCopied(true);
    Alert.alert("Copied", "Recent logs copied to clipboard. Paste them when reporting an issue.");
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Report an issue</Text>
      <Text style={styles.hint}>
        Copy recent app logs to paste into an email or issue report. Logs are kept in memory only
        and do not include personal data.
      </Text>
      <Pressable style={styles.button} onPress={copyLogs}>
        <Text style={styles.buttonText}>{copied ? "Copied" : "Copy recent logs"}</Text>
      </Pressable>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backBtnText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: "700", color: "#13294b", marginBottom: 12 },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  button: {
    backgroundColor: "#13294b",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  backBtn: { padding: 12, alignItems: "center" },
  backBtnText: { fontSize: 16, color: "#13294b" },
});
