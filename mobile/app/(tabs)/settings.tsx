import { fetchBuildings, fetchClasses, fetchHealth } from "@/src/api/client";
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
import { MAX_BUFFER, MIN_BUFFER } from "@/src/storage/recommendationSettings";
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
    setWalkingModeId,
    setBufferMinutes,
  } = useRecommendationSettings();
  const [input, setInput] = useState(apiBaseUrl);
  const [apiKeyInput, setApiKeyInput] = useState(apiKey ?? "");
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [notificationsToggling, setNotificationsToggling] = useState(false);
  const [bufferSlider, setBufferSlider] = useState(bufferMinutes);

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
      style={styles.container}
    >
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
            <ActivityIndicator color="#13294b" size="small" />
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
            maximumTrackTintColor="#ccc"
            maximumValue={MAX_BUFFER}
            minimumTrackTintColor="#13294b"
            minimumValue={MIN_BUFFER}
            onSlidingComplete={(v) => setBufferMinutes(v)}
            onValueChange={setBufferSlider}
            step={1}
            style={styles.slider}
            value={bufferSlider}
          />
        </View>
      </View>

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
            trackColor={{ false: "#ccc", true: "#13294b" }}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#fff",
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#13294b",
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  buttonRow: { flexDirection: "row", gap: 12, marginTop: 8 },
  buttonSecondary: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#13294b",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonSecondaryText: { color: "#13294b", fontSize: 16, fontWeight: "600" },
  button: {
    flex: 1,
    backgroundColor: "#13294b",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  toggleRow: { marginTop: 24 },
  walkingRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  walkingBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#eee",
  },
  walkingBtnOn: { backgroundColor: "#13294b" },
  walkingBtnText: { fontSize: 14, color: "#333", fontWeight: "500" },
  walkingBtnTextOn: { color: "#fff" },
  sliderRow: { marginTop: 8 },
  sliderValue: { fontSize: 16, color: "#13294b", fontWeight: "600", marginBottom: 4 },
  slider: { width: "100%", height: 40 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  toggleLabel: { fontSize: 16, color: "#333" },
  testNotifBtn: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#E3F2FD",
    alignItems: "center",
  },
  testNotifBtnText: { fontSize: 15, color: "#0D47A1", fontWeight: "600" },
  linkButton: {
    marginTop: 8,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#13294b",
    alignItems: "center",
  },
  linkButtonText: { fontSize: 16, color: "#13294b", fontWeight: "600" },
});
