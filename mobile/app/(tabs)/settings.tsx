import { fetchBuildings, fetchClasses, fetchHealth } from "@/src/api/client";
import { theme } from "@/src/constants/theme";
import { WALKING_MODES } from "@/src/constants/walkingMode";
import type { WalkingModeId } from "@/src/constants/walkingMode";
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
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

export default function SettingsScreen() {
  const router = useRouter();
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
        placeholderTextColor="#999"
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
        placeholderTextColor="#999"
        secureTextEntry
        style={styles.input}
        value={apiKeyInput}
      />
      <View style={styles.buttonRow}>
        <TouchableOpacity
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
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="Save API URL"
          accessibilityRole="button"
          disabled={saving || testingConnection}
          onPress={save}
          style={[styles.button, (saving || testingConnection) && styles.buttonDisabled]}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
      </View>

      <Text style={styles.sectionHeader}>Walking preferences</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Walking mode</Text>
        <Text style={styles.hint}>
          Affects route times and recommendation order. Faster = shorter walk estimates.
        </Text>
        <View style={styles.walkingRow}>
          {WALKING_MODES.map((mode) => (
            <Pressable
              key={mode.id}
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
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.label}>Buffer (minutes)</Text>
        <Text style={styles.hint}>
          Extra time before arrival (0–15 min). More buffer = earlier suggested departure.
        </Text>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderValue}>{Math.round(bufferSlider)} min</Text>
          <Slider
            accessibilityLabel="Buffer minutes before arrival"
            accessibilityValue={{ min: MIN_BUFFER, max: MAX_BUFFER, now: Math.round(bufferSlider) }}
            maximumTrackTintColor={theme.colors.border}
            maximumValue={MAX_BUFFER}
            minimumTrackTintColor={theme.colors.navy}
            minimumValue={MIN_BUFFER}
            onSlidingComplete={(v) => setBufferMinutes(v)}
            onValueChange={setBufferSlider}
            step={1}
            style={styles.slider}
            value={bufferSlider}
          />
        </View>
      </View>

      <View style={[styles.toggleRow, { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 16, paddingTop: 16 }]}>
        <Text style={styles.label}>Body weight (kg)</Text>
        <Text style={styles.hint}>
          Used to calculate calories burned during walks (40–150 kg).
        </Text>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderValue}>{Math.round(weightSlider)} kg</Text>
          <Slider
            accessibilityLabel="Body weight in kilograms"
            accessibilityValue={{ min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG, now: Math.round(weightSlider) }}
            maximumTrackTintColor={theme.colors.border}
            maximumValue={MAX_WEIGHT_KG}
            minimumTrackTintColor={theme.colors.navy}
            minimumValue={MIN_WEIGHT_KG}
            onSlidingComplete={(v) => setWeightKg(v)}
            onValueChange={setWeightSlider}
            step={1}
            style={styles.slider}
            value={weightSlider}
          />
        </View>
      </View>
      </View>

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
            trackColor={{ false: theme.colors.border, true: theme.colors.navy }}
            thumbColor="#fff"
          />
        </View>
        <Pressable
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
        </Pressable>
      </View>

      <View style={[styles.sectionCard, { marginTop: 8 }]}>
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
            trackColor={{ false: theme.colors.border, true: theme.colors.navy }}
            thumbColor="#fff"
          />
        </View>
      </View>

      </View>
      </View>

      <Text style={styles.sectionHeader}>Debug</Text>
      <View style={styles.sectionCard}>
      <View style={styles.toggleRow}>
        <Text style={styles.label}>Report issue</Text>
        <Text style={styles.hint}>Copy recent logs to paste when reporting a bug (no external service).</Text>
        <Pressable
          accessibilityLabel="Open Report issue screen"
          accessibilityRole="button"
          onPress={() => router.push("/report-issue")}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonText}>Copy logs & report</Text>
        </Pressable>
      </View>
      </View>
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
  sectionCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 16, marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  label: {
    fontSize: 16,
    fontFamily: "DMSans_600SemiBold",
    color: theme.colors.navy,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    fontFamily: "DMSans_400Regular",
    color: theme.colors.textSecondary,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 12,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
    marginBottom: 16,
  },
  buttonRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  buttonSecondary: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.navy,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  buttonSecondaryText: { color: theme.colors.navy, fontSize: 16, fontFamily: "DMSans_600SemiBold" },
  button: {
    flex: 1,
    backgroundColor: theme.colors.navy,
    padding: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: theme.colors.surface, fontSize: 16, fontFamily: "DMSans_600SemiBold" },
  toggleRow: { marginTop: 0 },
  walkingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  walkingBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  walkingBtnOn: { backgroundColor: theme.colors.orange },
  walkingBtnText: { fontSize: 14, fontFamily: "DMSans_500Medium", color: theme.colors.text },
  walkingBtnTextOn: { color: theme.colors.surface },
  sliderRow: { marginTop: 8 },
  sliderValue: { fontSize: 20, fontFamily: "DMSans_700Bold", color: theme.colors.orange, marginBottom: 4 },
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
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: "center",
  },
  testNotifBtnText: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
  linkButton: {
    marginTop: 8,
    padding: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.navy,
    alignItems: "center",
  },
  linkButtonText: { fontSize: 16, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy },
});
