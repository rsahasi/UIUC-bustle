import {
  createClass,
  deleteClass,
  fetchBuildingSearch,
  fetchBuildings,
  fetchClasses,
  fetchGeocode,
} from "@/src/api/client";
import type { Building, ScheduleClass } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS: Record<string, string> = {
  MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun",
};

export default function ScheduleScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const [classes, setClasses] = useState<ScheduleClass[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [time, setTime] = useState("09:00");
  const [endTime, setEndTime] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSearching, setLocationSearching] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationDisplay, setLocationDisplay] = useState<string | null>(null);
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // "List" or "Week" view toggle
  const [viewMode, setViewMode] = useState<"list" | "week">("list");
  const [selectedWeekDay, setSelectedWeekDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [classesRes, buildingsRes] = await Promise.all([
        fetchClasses(apiBaseUrl, { apiKey: apiKey ?? undefined }),
        fetchBuildings(apiBaseUrl, { apiKey: apiKey ?? undefined }),
      ]);
      setClasses(classesRes.classes ?? []);
      setBuildings(buildingsRes.buildings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setClasses([]);
      setBuildings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDay = (d: string) => {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert("Error", "Enter a title.");
      return;
    }
    if (days.length === 0) {
      Alert.alert("Error", "Select at least one day.");
      return;
    }
    const match = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time.trim());
    if (!match) {
      Alert.alert("Error", "Time must be HH:MM (e.g. 09:30).");
      return;
    }
    const endTrimmed = endTime.trim();
    if (endTrimmed && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(endTrimmed)) {
      Alert.alert("Error", "End time must be HH:MM (e.g. 10:30) or left blank.");
      return;
    }
    if (endTrimmed) {
      const [sh, sm] = time.trim().split(":").map(Number);
      const [eh, em] = endTrimmed.split(":").map(Number);
      if (eh * 60 + em <= sh * 60 + sm) {
        Alert.alert("Error", "End time must be after start time.");
        return;
      }
    }
    if (locationLat == null || locationLng == null) {
      Alert.alert("Error", "Search for a class location (address or place name) first.");
      return;
    }
    setSubmitting(true);
    try {
      await createClass(apiBaseUrl, {
        title: t,
        days_of_week: days,
        start_time_local: time.trim(),
        destination_lat: locationLat,
        destination_lng: locationLng,
        destination_name: locationDisplay ?? (locationQuery.trim() || undefined),
        end_time_local: endTrimmed || undefined,
      }, { apiKey: apiKey ?? undefined });
      setTitle("");
      setDays([]);
      setTime("09:00");
      setEndTime("");
      setLocationQuery("");
      setLocationDisplay(null);
      setLocationLat(null);
      setLocationLng(null);
      setLocationError(null);
      await load();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to add class");
    } finally {
      setSubmitting(false);
    }
  };

  const searchLocation = useCallback(async () => {
    const q = locationQuery.trim();
    if (!q) {
      setLocationError("Enter an address or place name.");
      return;
    }
    setLocationError(null);
    setLocationSearching(true);
    try {
      // Try local buildings DB first — reliable for UIUC campus locations
      const bRes = await fetchBuildingSearch(apiBaseUrl, q, { apiKey: apiKey ?? undefined });
      if (bRes.buildings.length > 0) {
        const b = bRes.buildings[0];
        setLocationDisplay(b.name);
        setLocationLat(b.lat);
        setLocationLng(b.lng);
      } else {
        // Fall back to Nominatim geocode (UIUC-biased)
        const geo = await fetchGeocode(apiBaseUrl, q, { apiKey: apiKey ?? undefined });
        setLocationDisplay(geo.display_name);
        setLocationLat(geo.lat);
        setLocationLng(geo.lng);
      }
    } catch (e) {
      setLocationError(e instanceof Error ? e.message : "Address search failed.");
      setLocationDisplay(null);
      setLocationLat(null);
      setLocationLng(null);
    } finally {
      setLocationSearching(false);
    }
  }, [apiBaseUrl, apiKey, locationQuery]);

  const onDeleteClass = useCallback(async (c: ScheduleClass) => {
    Alert.alert("Delete class", `Remove "${c.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteClass(apiBaseUrl, c.class_id, { apiKey: apiKey ?? undefined });
            await load();
          } catch (e) {
            Alert.alert("Error", e instanceof Error ? e.message : "Failed to delete");
          }
        },
      },
    ]);
  }, [apiBaseUrl, apiKey, load]);

  function classLocationLabel(c: ScheduleClass): string {
    if (c.destination_name) return c.destination_name;
    return buildings.find((b) => b.building_id === c.building_id)?.name ?? c.building_id;
  }

  const filteredClasses =
    viewMode === "week" && selectedWeekDay
      ? classes.filter((c) => c.days_of_week?.includes(selectedWeekDay))
      : classes;

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#13294b" />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#13294b" />
      }
    >
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.form}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. CS 101"
        />
        <Text style={styles.label}>Days</Text>
        <View style={styles.dayRow}>
          {DAYS.map((d) => (
            <Pressable
              key={d}
              style={[styles.dayBtn, days.includes(d) && styles.dayBtnOn]}
              onPress={() => toggleDay(d)}
            >
              <Text style={[styles.dayText, days.includes(d) && styles.dayTextOn]}>{d.slice(0, 1)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>Start time (HH:MM)</Text>
        <TextInput
          style={styles.input}
          value={time}
          onChangeText={setTime}
          placeholder="09:00"
          keyboardType="numbers-and-punctuation"
        />
        <Text style={styles.label}>End time (HH:MM, optional)</Text>
        <TextInput
          style={styles.input}
          value={endTime}
          onChangeText={setEndTime}
          placeholder="10:15"
          keyboardType="numbers-and-punctuation"
        />
        <Text style={styles.label}>Class location (address or place)</Text>
        <TextInput
          style={styles.input}
          value={locationQuery}
          onChangeText={(t) => { setLocationQuery(t); setLocationError(null); }}
          placeholder="e.g. 934 Lundy Lane, Lincoln Hall, or Illini Union"
          onSubmitEditing={searchLocation}
        />
        <Pressable
          style={[styles.searchLocationBtn, locationSearching && styles.searchLocationBtnDisabled]}
          onPress={searchLocation}
          disabled={locationSearching || !locationQuery.trim()}
        >
          {locationSearching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchLocationBtnText}>Search address</Text>
          )}
        </Pressable>
        {locationError && <Text style={styles.locationError}>{locationError}</Text>}
        {locationDisplay != null && (
          <Text style={styles.locationConfirmed}>✓ {locationDisplay}</Text>
        )}
        <Pressable
          style={[styles.submitBtn, submitting && styles.submitDisabled]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Add class</Text>}
        </Pressable>
      </View>

      {/* List / Week toggle */}
      <View style={styles.viewToggleRow}>
        <Pressable
          style={[styles.viewToggleBtn, viewMode === "list" && styles.viewToggleBtnActive]}
          onPress={() => setViewMode("list")}
        >
          <Text style={[styles.viewToggleText, viewMode === "list" && styles.viewToggleTextActive]}>List</Text>
        </Pressable>
        <Pressable
          style={[styles.viewToggleBtn, viewMode === "week" && styles.viewToggleBtnActive]}
          onPress={() => setViewMode("week")}
        >
          <Text style={[styles.viewToggleText, viewMode === "week" && styles.viewToggleTextActive]}>Week</Text>
        </Pressable>
      </View>

      {viewMode === "week" && (
        <View style={styles.weekStrip}>
          {DAYS.map((d) => (
            <Pressable
              key={d}
              style={[styles.weekDayBtn, selectedWeekDay === d && styles.weekDayBtnActive]}
              onPress={() => setSelectedWeekDay(selectedWeekDay === d ? null : d)}
            >
              <Text style={[styles.weekDayText, selectedWeekDay === d && styles.weekDayTextActive]}>
                {DAY_LABELS[d]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.listTitle}>Your classes</Text>
      {filteredClasses.length === 0 ? (
        <Text style={styles.empty}>
          {viewMode === "week" && selectedWeekDay
            ? `No classes on ${DAY_LABELS[selectedWeekDay]}.`
            : "No classes yet. Fill in the form above to add your first class."}
        </Text>
      ) : (
        filteredClasses.map((c) => (
          <View key={c.class_id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.classTitle}>{c.title}</Text>
              <Pressable
                style={styles.deleteBtn}
                onPress={() => onDeleteClass(c)}
                accessibilityLabel={`Delete ${c.title}`}
              >
                <Text style={styles.deleteBtnText}>🗑</Text>
              </Pressable>
            </View>
            <Text style={styles.classMeta}>
              {c.days_of_week.join(", ")} · {c.start_time_local}
              {c.end_time_local ? `–${c.end_time_local}` : ""} · {classLocationLabel(c)}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  container: { padding: 16, paddingBottom: 32 },
  error: { color: "#c41e3a", marginBottom: 12 },
  form: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  dayRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  dayBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#eee",
    justifyContent: "center",
    alignItems: "center",
  },
  dayBtnOn: { backgroundColor: "#13294b" },
  dayText: { fontSize: 12, color: "#333" },
  dayTextOn: { color: "#fff" },
  searchLocationBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: "#13294b",
    borderRadius: 8,
    alignItems: "center",
  },
  searchLocationBtnDisabled: { opacity: 0.7 },
  searchLocationBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  locationError: { color: "#c41e3a", fontSize: 14, marginTop: 6 },
  locationConfirmed: { fontSize: 14, color: "#2e7d32", marginTop: 8 },
  submitBtn: {
    backgroundColor: "#13294b",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: "#fff", fontWeight: "600" },
  viewToggleRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  viewToggleBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: "#eee",
  },
  viewToggleBtnActive: { backgroundColor: "#13294b" },
  viewToggleText: { fontSize: 14, fontWeight: "600", color: "#666" },
  viewToggleTextActive: { color: "#fff" },
  weekStrip: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  weekDayBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#eee",
  },
  weekDayBtnActive: { backgroundColor: "#e35205" },
  weekDayText: { fontSize: 13, color: "#333", fontWeight: "500" },
  weekDayTextActive: { color: "#fff" },
  listTitle: { fontSize: 18, fontWeight: "600", color: "#13294b", marginBottom: 8 },
  empty: { color: "#666" },
  card: { backgroundColor: "#f5f5f5", borderRadius: 12, padding: 12, marginBottom: 8 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  classTitle: { fontSize: 16, fontWeight: "600", flex: 1 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 18 },
  classMeta: { fontSize: 14, color: "#666", marginTop: 4 },
});
