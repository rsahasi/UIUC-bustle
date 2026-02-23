import { fetchRecommendation } from "@/src/api/client";
import type { RecommendationOption } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useRecommendationSettings } from "@/src/hooks/useRecommendationSettings";
import { getFavoritePlaces, type SavedPlace } from "@/src/storage/favorites";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { theme } from "@/src/constants/theme";

const PRESET_CHIPS = ["Home", "Gym", "Library", "Groceries"];

export default function AfterClassPlannerScreen() {
  const router = useRouter();
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const { walkingSpeedMps, bufferMinutes } = useRecommendationSettings();
  const [freeText, setFreeText] = useState("");
  const [favorites, setFavorites] = useState<SavedPlace[]>([]);
  const [selectedDest, setSelectedDest] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ dest: string; options: RecommendationOption[] }[]>([]);
  const [narrative, setNarrative] = useState<string | null>(null);

  useEffect(() => {
    getFavoritePlaces().then((places) => setFavorites(places));
  }, []);

  const onGetPlan = useCallback(async () => {
    const dest = freeText.trim() || selectedDest;
    if (!dest) return;
    setLoading(true);
    setError(null);
    setResults([]);
    setNarrative(null);
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== "granted") {
        setError("Location permission required.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;
      const base = apiBaseUrl.replace(/\/$/, "");
      // Call the backend planner
      const res = await fetch(`${base}/ai/after-class-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "X-API-Key": apiKey } : {}),
        },
        body: JSON.stringify({
          freetext_plan: dest,
          lat: latitude,
          lng: longitude,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || `Planner: ${res.status}`);
      }
      const data = await res.json();
      setNarrative(data.narrative ?? null);
      const chain: { dest: string; options: RecommendationOption[] }[] = data.destination_sequence ?? [];
      setResults(chain);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to get plan.");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, apiKey, freeText, selectedDest, walkingSpeedMps, bufferMinutes]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.intro}>What are your plans after class?</Text>
      <TextInput
        style={styles.input}
        value={freeText}
        onChangeText={setFreeText}
        placeholder="e.g. Go to gym then grab dinner"
        multiline
        numberOfLines={3}
        placeholderTextColor={theme.colors.textMuted}
      />

      <Text style={styles.orLabel}>— or pick a destination —</Text>

      {/* Preset chips */}
      <View style={styles.chipsRow}>
        {PRESET_CHIPS.map((chip) => (
          <Pressable
            key={chip}
            style={[styles.chip, selectedDest === chip && styles.chipActive]}
            onPress={() => {
              setSelectedDest(selectedDest === chip ? null : chip);
              setFreeText("");
            }}
          >
            <Text style={[styles.chipText, selectedDest === chip && styles.chipTextActive]}>{chip}</Text>
          </Pressable>
        ))}
      </View>

      {/* Saved favorites */}
      {favorites.length > 0 && (
        <View style={styles.favRow}>
          {favorites.map((f) => (
            <Pressable
              key={f.id}
              style={[styles.chip, selectedDest === f.name && styles.chipActive]}
              onPress={() => {
                setSelectedDest(selectedDest === f.name ? null : f.name);
                setFreeText("");
              }}
            >
              <Text style={[styles.chipText, selectedDest === f.name && styles.chipTextActive]}>♥ {f.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        style={[styles.planBtn, (loading || (!freeText.trim() && !selectedDest)) && styles.planBtnDisabled]}
        onPress={onGetPlan}
        disabled={loading || (!freeText.trim() && !selectedDest)}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.planBtnText}>Get Plan</Text>
        )}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      {narrative && (
        <View style={styles.narrativeCard}>
          <Text style={styles.narrativeText}>{narrative}</Text>
        </View>
      )}

      {results.map((item, idx) => (
        <View key={idx} style={styles.destBlock}>
          <Text style={styles.destTitle}>{idx + 1}. {item.dest}</Text>
          {item.options.map((opt, oidx) => (
            <View key={oidx} style={styles.optCard}>
              <Text style={styles.optType}>{opt.type === "WALK" ? "Walk" : "Bus"}</Text>
              <Text style={styles.optMeta}>Leave in {opt.depart_in_minutes} min · {opt.eta_minutes} min total</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 16, fontWeight: "600", color: theme.colors.primary, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.radius.sm,
    padding: 12,
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: 12,
    minHeight: 72,
    textAlignVertical: "top",
  },
  orLabel: { textAlign: "center", color: theme.colors.textMuted, fontSize: 13, marginBottom: 10 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  favRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 14, color: theme.colors.text },
  chipTextActive: { color: "#fff" },
  planBtn: {
    backgroundColor: theme.colors.secondary,
    padding: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  planBtnDisabled: { opacity: 0.6 },
  planBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  error: { color: theme.colors.error, fontSize: 14, marginBottom: 12 },
  narrativeCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.secondary,
  },
  narrativeText: { fontSize: 14, color: theme.colors.text, lineHeight: 22, fontStyle: "italic" },
  destBlock: { marginBottom: 16 },
  destTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.primary, marginBottom: 6 },
  optCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.sm,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  optType: { fontSize: 13, fontWeight: "600", color: theme.colors.text },
  optMeta: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 },
});
