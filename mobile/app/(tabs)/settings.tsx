import { fetchBuildings, fetchClasses, fetchHealth } from "@/src/api/client";
import { resetAllPatterns } from "@/src/utils/patternEngine";
import { theme } from "@/src/constants/theme";
import { WALKING_MODES } from "@/src/constants/walkingMode";
import { FadeInView, PressableScale } from "@/src/components/ui/motion";
import { useAuth } from "@/src/auth/useAuth";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useClassNotificationsEnabled } from "@/src/hooks/useClassNotificationsEnabled";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import {
  cancelAllClassReminders,
  requestNotificationPermission,
  scheduleClassReminders,
  sendTestNotification,
} from "@/src/notifications/classReminders";
import { MAX_BUFFER, MAX_WEIGHT_KG, MIN_BUFFER, MIN_WEIGHT_KG } from "@/src/storage/recommendationSettings";
import Slider from "@react-native-community/slider";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

const WIDGET_STEPS = [
  "Long-press your iPhone home screen until icons jiggle",
  "Tap the + button in the top-left corner",
  'Search for "UIUC Bus" and choose a size (small, medium, or large)',
];

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { apiBaseUrl, setApiBaseUrl, apiKey, setApiKey } = useApiBaseUrl();
  const { enabled: classNotificationsEnabled, setEnabled: setClassNotificationsEnabled } =
    useClassNotificationsEnabled();
  const {
    walkingModeId,
    bufferMinutes,
    weightKg,
    rainMode,
    setWalkingModeId,
    setBufferMinutes,
    setWeightKg,
    setRainMode,
  } = useRecommendationSettings();
  const [input, setInput] = useState(apiBaseUrl);
  const [apiKeyInput, setApiKeyInput] = useState(apiKey ?? "");
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [notificationsToggling, setNotificationsToggling] = useState(false);
  const [bufferSlider, setBufferSlider] = useState(bufferMinutes);
  const [weightSlider, setWeightSlider] = useState(weightKg);

  // Keep input in sync when stored URL loads or changes
  useEffect(() => {
    setInput(apiBaseUrl);
  }, [apiBaseUrl]);
  useEffect(() => {
    setApiKeyInput(apiKey ?? "");
  }, [apiKey]);

  useEffect(() => {
    setBufferSlider(bufferMinutes);
  }, [bufferMinutes]);

  useEffect(() => {
    setWeightSlider(weightKg);
  }, [weightKg]);

  const onClassNotificationsToggle = useCallback(
    async (value: boolean) => {
      setNotificationsToggling(true);
      try {
        if (value) {
          const granted = await requestNotificationPermission();
          if (!granted) {
            Alert.alert(
              "Permission needed",
              "Enable notifications in your device Settings to get class reminders."
            );
            return;
          }
          let scheduleOk = true;
          try {
            const [classesRes, buildingsRes] = await Promise.all([
              fetchClasses(apiBaseUrl, { apiKey: apiKey ?? undefined }),
              fetchBuildings(apiBaseUrl, { apiKey: apiKey ?? undefined }),
            ]);
            const classes = classesRes.classes ?? [];
            const buildings = buildingsRes.buildings ?? [];
            const buildingMap: Record<string, string> = {};
            for (const b of buildings) buildingMap[b.building_id] = b.name;
            await cancelAllClassReminders();
            await scheduleClassReminders(classes, buildingMap);
          } catch (_) {
            scheduleOk = false;
            await scheduleClassReminders([]);
          }
          await setClassNotificationsEnabled(true);
          if (!scheduleOk) {
            Alert.alert(
              "Reminders enabled",
              "Schedule couldn’t be loaded. Open Home to set class reminders when you’re online."
            );
          }
        } else {
          await cancelAllClassReminders();
          await setClassNotificationsEnabled(false);
        }
      } finally {
        setNotificationsToggling(false);
      }
    },
    [apiBaseUrl, apiKey, setClassNotificationsEnabled]
  );

  const handleSignOut = useCallback(() => {
    Alert.alert(
      "Sign out",
      "Are you sure you want to sign out?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => signOut() },
      ]
    );
  }, [signOut]);

  const isValidApiUrl = useCallback((value: string) => {
    const url = value.trim().replace(/\/$/, "");
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, []);

  const save = useCallback(async () => {
    const url = input.trim().replace(/\/$/, "");
    if (!isValidApiUrl(input)) {
      Alert.alert("Invalid URL", "Enter a valid API base URL (e.g. http://localhost:8000 or https://api.example.com).");
      return;
    }
    setSaving(true);
    try {
      await setApiBaseUrl(url);
      await setApiKey(apiKeyInput.trim() || null);
      Alert.alert("Saved", "API base URL and optional API key saved.");
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [input, apiKeyInput, setApiBaseUrl, setApiKey, isValidApiUrl]);

  const testConnection = useCallback(async () => {
    const url = input.trim().replace(/\/$/, "");
    if (!isValidApiUrl(input)) {
      Alert.alert("Invalid URL", "Enter a valid URL first, then tap Test connection.");
      return;
    }
    setTestingConnection(true);
    try {
      await fetchHealth(url, { apiKey: apiKeyInput.trim() || undefined });
      Alert.alert("Connection OK", "The server responded. You can save this URL.");
    } catch (e) {
      Alert.alert("Connection failed", e instanceof Error ? e.message : "Server unreachable. Check URL and that the backend is running.");
    } finally {
      setTestingConnection(false);
    }
  }, [input, isValidApiUrl]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: theme.colors.surfaceAlt }}
    >
    <ScrollView contentContainerStyle={styles.container}>
      <FadeInView delay={0}>
        <Text style={styles.sectionHeader}>Account</Text>
        <View style={styles.sectionCard}>
          <View style={styles.accountRow}>
            <LinearGradient
              colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.accountAvatar}
            >
              <Text style={styles.accountAvatarText}>
                {(user?.email?.[0] ?? "?").toUpperCase()}
              </Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountEmail}>{user?.email ?? "—"}</Text>
              <Text style={styles.accountHint}>Signed in via Supabase</Text>
            </View>
          </View>
          <PressableScale
            style={styles.signOutBtn}
            onPress={handleSignOut}
            accessibilityLabel="Sign out"
            accessibilityRole="button"
          >
            <Text style={styles.signOutBtnText}>Sign out</Text>
          </PressableScale>
        </View>
      </FadeInView>

      <FadeInView delay={70}>
      <Text style={styles.sectionHeader}>Connection</Text>
      <View style={styles.sectionCard}>
      <Text style={styles.label}>API base URL</Text>
      <Text style={styles.hint}>
        Use localhost for simulator; use your computer’s IP for a physical device (e.g. http://192.168.1.100:8000).
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        keyboardType="url"
        onChangeText={setInput}
        onBlur={() => setInput((v) => v.trim().replace(/\/$/, ""))}
        placeholder="http://localhost:8000"
        placeholderTextColor={theme.colors.textMuted}
        style={styles.input}
        value={input}
      />
      <Text style={styles.label}>API key (optional)</Text>
      <Text style={styles.hint}>Required only if the server has API key auth enabled. Leave blank for local dev.</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        onChangeText={setApiKeyInput}
        placeholder="Leave blank if not required"
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry
        style={styles.input}
        value={apiKeyInput}
      />
      <View style={styles.buttonRow}>
        <View style={{ flex: 1 }}>
          <PressableScale
            accessibilityLabel="Test connection"
            accessibilityRole="button"
            disabled={saving || testingConnection}
            onPress={testConnection}
            style={[styles.buttonSecondary, (saving || testingConnection) && styles.buttonDisabled]}
          >
            {testingConnection ? (
              <ActivityIndicator color={theme.colors.navy} size="small" />
            ) : (
              <Text style={styles.buttonSecondaryText}>Test connection</Text>
            )}
          </PressableScale>
        </View>
        <View style={{ flex: 1 }}>
          <PressableScale
            accessibilityLabel="Save API URL"
            accessibilityRole="button"
            disabled={saving || testingConnection}
            onPress={save}
            style={[styles.buttonWrap, (saving || testingConnection) && styles.buttonDisabled]}
          >
            <LinearGradient
              colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.buttonGradient}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Save</Text>
              )}
            </LinearGradient>
          </PressableScale>
        </View>
      </View>
      </View>
      </FadeInView>

      <FadeInView delay={140}>
      <Text style={styles.sectionHeader}>Walking preferences</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Walking mode</Text>
        <Text style={styles.hint}>
          Affects route times and recommendation order. Faster = shorter walk estimates.
        </Text>
        <View style={styles.walkingRow}>
          {WALKING_MODES.map((mode) => (
            <PressableScale
              key={mode.id}
              scaleTo={0.93}
              accessibilityLabel={`Walking mode ${mode.label}`}
              accessibilityRole="button"
              accessibilityState={{ selected: walkingModeId === mode.id }}
              onPress={() => setWalkingModeId(mode.id)}
              style={[
                styles.walkingBtn,
                walkingModeId === mode.id && styles.walkingBtnOn,
              ]}
            >
              <Text
                style={[
                  styles.walkingBtnText,
                  walkingModeId === mode.id && styles.walkingBtnTextOn,
                ]}
              >
                {mode.label}
              </Text>
            </PressableScale>
          ))}
        </View>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelInRow]}>Buffer (minutes)</Text>
          <View style={styles.valuePill}>
            <Text style={styles.valuePillText}>{Math.round(bufferSlider)} min</Text>
          </View>
        </View>
        <Text style={styles.hint}>
          Extra time before arrival (0–15 min). More buffer = earlier suggested departure.
        </Text>
        <View style={styles.sliderRow}>
          <Slider
            accessibilityLabel="Buffer minutes before arrival"
            accessibilityValue={{ min: MIN_BUFFER, max: MAX_BUFFER, now: Math.round(bufferSlider) }}
            maximumTrackTintColor={theme.colors.borderSoft}
            maximumValue={MAX_BUFFER}
            minimumTrackTintColor={theme.colors.orange}
            thumbTintColor={theme.colors.orangeBright}
            minimumValue={MIN_BUFFER}
            onSlidingComplete={(v) => setBufferMinutes(v)}
            onValueChange={setBufferSlider}
            step={1}
            style={styles.slider}
            value={bufferSlider}
          />
          <View style={styles.sliderLabelRow}>
            <Text style={styles.sliderMinMax}>0 min</Text>
            <Text style={styles.sliderMinMax}>15 min</Text>
          </View>
        </View>
      </View>

      <View style={[styles.toggleRow, styles.dividerTop]}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, styles.labelInRow]}>Body weight (lbs)</Text>
          <View style={styles.valuePill}>
            <Text style={styles.valuePillText}>{Math.round(weightSlider * 2.20462)} lbs</Text>
          </View>
        </View>
        <Text style={styles.hint}>
          Used to calculate calories burned during walks (88–330 lbs).
        </Text>
        <Text style={[styles.hint, { fontSize: 12, color: theme.colors.textMuted, marginTop: -8 }]}>
          Stored on-device only. Never transmitted to any server.
        </Text>
        <View style={styles.sliderRow}>
          <Slider
            accessibilityLabel="Body weight in pounds"
            accessibilityValue={{ min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG, now: Math.round(weightSlider) }}
            maximumTrackTintColor={theme.colors.borderSoft}
            maximumValue={MAX_WEIGHT_KG}
            minimumTrackTintColor={theme.colors.orange}
            thumbTintColor={theme.colors.orangeBright}
            minimumValue={MIN_WEIGHT_KG}
            onSlidingComplete={(v) => setWeightKg(v)}
            onValueChange={setWeightSlider}
            step={1}
            style={styles.slider}
            value={weightSlider}
          />
          <View style={styles.sliderLabelRow}>
            <Text style={styles.sliderMinMax}>{Math.round(MIN_WEIGHT_KG * 2.20462)} lbs</Text>
            <Text style={styles.sliderMinMax}>{Math.round(MAX_WEIGHT_KG * 2.20462)} lbs</Text>
          </View>
        </View>
      </View>
      </View>
      </FadeInView>

      <FadeInView delay={210}>
      <Text style={styles.sectionHeader}>Notifications</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Class notifications</Text>
        <Text style={styles.hint}>
          Remind you 20 minutes before each class today. Opens Home with route options when you tap.
        </Text>
        <View style={styles.switchRow}>
          <Text style={styles.toggleLabel}>
            {classNotificationsEnabled ? "On" : "Off"}
          </Text>
          <Switch
            accessibilityLabel="Class notifications on or off"
            accessibilityRole="switch"
            accessibilityState={{ checked: classNotificationsEnabled, disabled: notificationsToggling }}
            disabled={notificationsToggling}
            onValueChange={onClassNotificationsToggle}
            value={classNotificationsEnabled}
            trackColor={{ false: theme.colors.border, true: theme.colors.orange }}
            thumbColor="#fff"
          />
        </View>
        <PressableScale
          style={styles.testNotifBtn}
          onPress={async () => {
            try {
              await sendTestNotification();
              Alert.alert("Test sent", "You should get a notification in a few seconds.");
            } catch (e) {
              Alert.alert("Failed", e instanceof Error ? e.message : "Enable notifications and try again.");
            }
          }}
        >
          <Text style={styles.testNotifBtnText}>Send test notification</Text>
        </PressableScale>
      </View>

      <View style={styles.innerCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Rain mode</Text>
        <Text style={styles.hint}>
          Adds 5 min buffer and prioritises bus routes over walking when raining.
        </Text>
        <View style={styles.switchRow}>
          <Text style={styles.toggleLabel}>{rainMode ? "On — bus preferred" : "Off"}</Text>
          <Switch
            accessibilityLabel="Rain mode on or off"
            accessibilityRole="switch"
            accessibilityState={{ checked: rainMode }}
            onValueChange={setRainMode}
            value={rainMode}
            trackColor={{ false: theme.colors.border, true: theme.colors.orange }}
            thumbColor="#fff"
          />
        </View>
      </View>

      </View>
      </View>
      </FadeInView>

      <FadeInView delay={280}>
      <Text style={styles.sectionHeader}>Privacy & data</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Commute learning</Text>
        <Text style={styles.hint}>
          The app quietly learns your walk times, stop choices, and departure habits to make suggestions more accurate. All data stays on your device and is never uploaded.
        </Text>
        <PressableScale
          accessibilityLabel="Reset learned patterns"
          accessibilityRole="button"
          onPress={() =>
            Alert.alert(
              "Reset patterns?",
              "This will delete all learned walk times, stop preferences, and departure habits. Suggestions will return to defaults.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset",
                  style: "destructive",
                  onPress: async () => {
                    await resetAllPatterns();
                    Alert.alert("Patterns reset", "All learned data has been cleared.");
                  },
                },
              ]
            )
          }
          style={styles.dangerBtn}
        >
          <Text style={styles.dangerBtnText}>Reset my patterns</Text>
        </PressableScale>
      </View>
      </View>
      </FadeInView>

      <FadeInView delay={350}>
      <Text style={styles.sectionHeader}>Home screen widget</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Add widget</Text>
        <Text style={styles.hint}>
          The UIUC Bus widget shows your next class and departure time on your home screen or lock screen. To add it:
        </Text>
        <View style={styles.widgetSteps}>
          {WIDGET_STEPS.map((step, i) => (
            <View key={step} style={styles.widgetStepRow}>
              <View style={styles.stepCircle}>
                <Text style={styles.stepCircleText}>{i + 1}</Text>
              </View>
              <Text style={styles.widgetStep}>{step}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.hint} numberOfLines={0}>
          The widget refreshes every 15 minutes in the background. Tap the widget to open the app.
        </Text>
        <Text style={[styles.hint, { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 }]}>
          Note: Widget requires a production build via EAS Build (not Expo Go).
        </Text>
      </View>
      </View>
      </FadeInView>

      <FadeInView delay={420}>
      <Text style={styles.sectionHeader}>Debug</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Report issue</Text>
        <Text style={styles.hint}>Copy recent logs to paste when reporting a bug (no external service).</Text>
        <PressableScale
          accessibilityLabel="Open Report issue screen"
          accessibilityRole="button"
          onPress={() => router.push("/report-issue")}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonText}>Copy logs & report</Text>
        </PressableScale>
      </View>
      </View>
      </FadeInView>

      <FadeInView delay={490}>
      <Text style={styles.sectionHeader}>About</Text>
      <View style={styles.sectionCard}>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App version</Text>
          <Text style={styles.aboutValue}>{Constants.expoConfig?.version ?? '—'}</Text>
        </View>
        <View style={[styles.aboutRow, { borderTopWidth: 1, borderTopColor: theme.colors.borderSoft, marginTop: 12, paddingTop: 12 }]}>
          <PressableScale
            accessibilityRole="link"
            onPress={() => Linking.openURL('mailto:support@uiucbus.app?subject=UIUC%20Bus%20App%20Feedback')}
          >
            <Text style={styles.aboutLink}>Send feedback</Text>
          </PressableScale>
        </View>
      </View>
      </FadeInView>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: theme.colors.surfaceAlt,
  },
  sectionHeader: { fontSize: 11, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.8, textTransform: "uppercase" as const, color: theme.colors.textMuted, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  sectionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, padding: 16, marginBottom: 4, ...theme.shadows.md },
  innerCard: { backgroundColor: theme.colors.surfaceRaised, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.borderSoft, padding: 14, marginTop: 12 },
  label: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
    color: theme.colors.navy,
    marginBottom: 8,
  },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  labelInRow: { marginBottom: 0 },
  valuePill: { backgroundColor: theme.colors.orangeSoft, borderRadius: theme.radius.pill, paddingVertical: 4, paddingHorizontal: 12 },
  valuePillText: { fontSize: 14, fontFamily: "DMSans_700Bold", color: theme.colors.orange },
  hint: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.textSecondary,
    marginBottom: 12,
  },
  input: {
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    borderRadius: theme.radius.lg,
    padding: 12,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.text,
    marginBottom: 16,
  },
  buttonRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  buttonSecondary: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.navy,
    paddingVertical: 13,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSecondaryText: { color: theme.colors.navy, fontSize: 16, fontFamily: "DMSans_600SemiBold" },
  buttonWrap: { borderRadius: theme.radius.lg, ...theme.shadows.glowOrange },
  buttonGradient: {
    borderRadius: theme.radius.lg,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: theme.colors.surface, fontSize: 16, fontFamily: "DMSans_600SemiBold" },
  toggleRow: { marginTop: 0 },
  dividerTop: { borderTopWidth: 1, borderTopColor: theme.colors.borderSoft, marginTop: 16, paddingTop: 16 },
  walkingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  walkingBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
  },
  walkingBtnOn: { backgroundColor: theme.colors.navy, borderColor: theme.colors.navy, ...theme.shadows.glowNavy },
  walkingBtnText: { fontSize: 14, fontFamily: "DMSans_500Medium", color: theme.colors.text },
  walkingBtnTextOn: { color: theme.colors.surface, fontFamily: "DMSans_600SemiBold" },
  sliderRow: { marginTop: 4 },
  slider: { width: "100%", height: 40 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  toggleLabel: { fontSize: 16, fontFamily: "DMSans_400Regular", color: theme.colors.text },
  testNotifBtn: {
    marginTop: 12,
    padding: 12,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.orangeSoft,
    alignItems: "center",
  },
  testNotifBtnText: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.orange },
  linkButton: {
    marginTop: 8,
    padding: 13,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.navy,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
  },
  linkButtonText: { fontSize: 16, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
  dangerBtn: {
    marginTop: 8,
    padding: 13,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.errorSoft,
    alignItems: "center",
  },
  dangerBtnText: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.error },
  widgetSteps: { marginBottom: 12 },
  widgetStepRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  stepCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.navy, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepCircleText: { fontSize: 12, fontFamily: "DMSans_700Bold", color: theme.colors.surface },
  widgetStep: { flex: 1, fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.text, lineHeight: 20 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  sliderMinMax: { fontSize: 11, fontFamily: 'DMSans_400Regular', color: theme.colors.textMuted },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aboutLabel: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.text },
  aboutValue: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary },
  aboutLink: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: theme.colors.navy },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  accountAvatar: {
    width: 46, height: 46, borderRadius: 23,
    justifyContent: "center", alignItems: "center",
    ...theme.shadows.glowOrange,
  },
  accountAvatarText: { color: "#fff", fontSize: 19, fontFamily: "DMSans_700Bold" },
  accountEmail: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.text },
  accountHint: { fontSize: 13, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 2 },
  signOutBtn: {
    padding: 13, borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5, borderColor: theme.colors.navy,
    alignItems: "center",
  },
  signOutBtnText: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
});
