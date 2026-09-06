import { Button } from "@/src/components/ui/Button";
import { FadeInView } from "@/src/components/ui/motion";
import { theme } from "@/src/constants/theme";
import { getRecentLogs } from "@/src/telemetry/logBuffer";
import { useRouter } from "expo-router";
import { Check, ClipboardCopy, FileText } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  Alert,
  Clipboard,
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <FadeInView delay={0}>
        <View style={styles.card}>
          <View style={styles.iconHalo}>
            <FileText size={26} color={theme.colors.brandInk} strokeWidth={2} />
          </View>
          <Text style={styles.title}>Report an issue</Text>
          <Text style={styles.hint}>
            Copy recent app logs to paste into an email or issue report. Logs are kept in memory only
            and do not include personal data.
          </Text>
          <Button
            label={copied ? "Copied to clipboard" : "Copy recent logs"}
            variant="primary"
            icon={copied ? Check : ClipboardCopy}
            onPress={copyLogs}
          />
          {copied && (
            <View style={styles.successChip}>
              <Check size={14} color={theme.colors.successDeep} strokeWidth={2.6} />
              <Text style={styles.successChipText}>
                Logs are on your clipboard. Paste them into your report.
              </Text>
            </View>
          )}
        </View>
      </FadeInView>
      <FadeInView delay={90}>
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      </FadeInView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.surfaceAlt },
  container: {
    padding: theme.layout.gutter,
    paddingTop: theme.layout.gutter + 8,
    gap: theme.layout.cardGap,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    ...theme.elevation[2],
  },
  iconHalo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.orangeSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.layout.cardGap,
  },
  title: { ...theme.text.title2, color: theme.colors.navy, marginBottom: 6 },
  hint: {
    ...theme.text.body,
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: theme.layout.gutter,
  },
  successChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.successSoft,
    borderRadius: theme.radius.lg,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: theme.layout.cardGap,
  },
  successChipText: { flex: 1, ...theme.text.caption, color: theme.colors.successDeep },
});
