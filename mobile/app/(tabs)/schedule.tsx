import * as Haptics from 'expo-haptics';
import {
  createClass,
  deleteClass,
  fetchAutocomplete,
  fetchBuildings,
  fetchClasses,
  fetchPlaceDetails,
  fetchPlacesAutocomplete,
} from "@/src/api/client";
import { cancelClassReminder } from "@/src/notifications/classReminders";
import { disableClassNotif, enableClassNotif, getDisabledClassIds } from "@/src/storage/classNotifPrefs";
import { getClassRouteData, type ClassRouteData } from "@/src/storage/classSummaryCache";
import type { AutocompleteResult } from "@/src/api/client";
import type { Building, ScheduleClass } from "@/src/api/types";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { theme } from "@/src/constants/theme";
import { Bell, BellOff, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useFocusEffect } from "expo-router";
import { useAnalytics } from "@/src/hooks/useAnalytics";
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

function getLeaveByTime(startTime: string, departInMins: number): string {
  const [h, m] = startTime.split(':').map(Number);
  const totalMins = h * 60 + m - Math.round(departInMins);
  const lh = Math.floor(((totalMins % 1440) + 1440) % 1440 / 60);
  const lm = ((totalMins % 1440) + 1440) % 1440 % 60;
  const period = lh >= 12 ? 'PM' : 'AM';
  const displayH = lh % 12 || 12;
  return `${displayH}:${lm.toString().padStart(2, '0')} ${period}`;
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
}

function getTransitStatusColor(startTime: string, departInMins: number): string {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const [h, m] = startTime.split(':').map(Number);
  const classMins = h * 60 + m;
  const leaveByMins = classMins - Math.round(departInMins);
  const minsUntilLeave = leaveByMins - nowMins;
  if (minsUntilLeave > 15) return theme.colors.success;
  if (minsUntilLeave > 5) return theme.colors.warning;
  return theme.colors.error;
}

export default function ScheduleScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const router = useRouter();
  const { capture } = useAnalytics();
  const [classes, setClasses] = useState<ScheduleClass[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [classRouteDatas, setClassRouteDatas] = useState<Record<string, ClassRouteData | null>>({});
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
  const [locationSuggestions, setLocationSuggestions] = useState<AutocompleteResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [disabledNotifIds, setDisabledNotifIds] = useState<string[]>([]);

  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationSessionRef = useRef<string>(Math.random().toString(36).slice(2));

  // "List" or "Week" view toggle
  const [viewMode, setViewMode] = useState<"list" | "week">("list");
  const [selectedWeekDay, setSelectedWeekDay] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      capture("schedule_viewed");
    }, [capture])
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [classesRes, buildingsRes] = await Promise.all([
        fetchClasses(apiBaseUrl, { apiKey: apiKey ?? undefined }),
        fetchBuildings(apiBaseUrl, { apiKey: apiKey ?? undefined }),
      ]);
      const loadedClasses = classesRes.classes ?? [];
      setClasses(loadedClasses);
      setBuildings(buildingsRes.buildings ?? []);
      setDisabledNotifIds(await getDisabledClassIds());
      // Load route data for each class
      const routeEntries = await Promise.all(
        loadedClasses.map(async (c) => [c.class_id, await getClassRouteData(c.class_id)] as [string, ClassRouteData | null])
      );
      setClassRouteDatas(Object.fromEntries(routeEntries));
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

  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
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
    {
      const [sh, sm] = time.trim().split(":").map(Number);
      const startMins = sh * 60 + sm;
      if (startMins < 7 * 60 || startMins > 22 * 60) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Unusual time",
            `${time.trim()} is outside the typical 07:00–22:00 range. Add anyway?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Add anyway", onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) return;
      }
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

    // Conflict detection: check if this class overlaps any existing on shared days
    const newStart = toMinutes(time.trim());
    const newEnd = endTrimmed ? toMinutes(endTrimmed) : newStart + 75; // assume 75min if no end
    const conflicts: ScheduleClass[] = [];
    for (const cls of classes) {
      if (!days.some((d) => cls.days_of_week.includes(d))) continue;
      const clsStart = toMinutes(cls.start_time_local);
      const clsEnd = cls.end_time_local ? toMinutes(cls.end_time_local) : clsStart + 75;
      if (newStart < clsEnd && newEnd > clsStart) conflicts.push(cls);
    }
    if (conflicts.length > 0) {
      const msg = conflicts.map((c) => `"${c.title}" (${c.start_time_local})`).join(", ");
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Schedule conflict",
          `This overlaps with ${msg}. Add anyway?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Add anyway", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) return;
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      capture("class_added", {
        has_building: false,  // schedule.tsx only uses custom destinations (destination_lat/lng)
        has_custom_dest: locationLat !== null && locationLng !== null,
      });
      setSuccessToast("Class added ✓");
      setTimeout(() => setSuccessToast(null), 2500);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to add class");
    } finally {
      setSubmitting(false);
    }
  };

  const onLocationQueryChange = useCallback((text: string) => {
    setLocationQuery(text);
    setLocationError(null);
    setLocationDisplay(null);
    setLocationLat(null);
    setLocationLng(null);
    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    const q = text.trim();
    if (q.length < 2) {
      setLocationSuggestions([]);
      return;
    }
    locationDebounceRef.current = setTimeout(async () => {
      try {
        const [buildingRes, placesRes] = await Promise.all([
          fetchAutocomplete(apiBaseUrl, q, { apiKey: apiKey ?? undefined }),
          fetchPlacesAutocomplete(apiBaseUrl, q, locationSessionRef.current, { apiKey: apiKey ?? undefined }),
        ]);
        const buildings = (buildingRes.results ?? []).slice(0, 4);
        const places = (placesRes.predictions ?? []).slice(0, Math.max(0, 6 - buildings.length)).map((p) => ({
          type: "google_place" as const,
          name: p.main_text,
          display_name: p.description,
          lat: 0,
          lng: 0,
          building_id: "",
          place_id: p.place_id,
          secondary_text: p.secondary_text,
        }));
        setLocationSuggestions([...buildings, ...places]);
      } catch {}
    }, 300);
  }, [apiBaseUrl, apiKey]);

  const onSelectLocationSuggestion = useCallback(async (item: AutocompleteResult) => {
    setLocationSuggestions([]);
    locationSessionRef.current = Math.random().toString(36).slice(2);
    setLocationSearching(true);
    try {
      if (item.type === "google_place" && item.place_id) {
        const details = await fetchPlaceDetails(apiBaseUrl, item.place_id, { apiKey: apiKey ?? undefined });
        setLocationDisplay(details.display_name || item.name);
        setLocationLat(details.lat);
        setLocationLng(details.lng);
        setLocationQuery(details.display_name || item.name);
      } else {
        setLocationDisplay(item.display_name || item.name);
        setLocationLat(item.lat);
        setLocationLng(item.lng);
        setLocationQuery(item.display_name || item.name);
      }
    } catch (e) {
      setLocationError(e instanceof Error ? e.message : "Failed to resolve location.");
    } finally {
      setLocationSearching(false);
    }
  }, [apiBaseUrl, apiKey]);

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

  const DAY_ORDER: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
  const filteredClasses = (
    viewMode === "week" && selectedWeekDay
      ? classes.filter((c) => c.days_of_week?.includes(selectedWeekDay))
      : classes
  ).slice().sort((a, b) => {
    const aDay = Math.min(...(a.days_of_week ?? []).map((d) => DAY_ORDER[d] ?? 99));
    const bDay = Math.min(...(b.days_of_week ?? []).map((d) => DAY_ORDER[d] ?? 99));
    if (aDay !== bDay) return aDay - bDay;
    return (a.start_time_local ?? "").localeCompare(b.start_time_local ?? "");
  });

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.navy} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.colors.navy} />
      }
    >
      {successToast && (
        <View style={styles.successToast}>
          <Text style={styles.successToastText}>{successToast}</Text>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.formCard}><View style={styles.form}>
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={(text) => setTitle(text.slice(0, 60))}
          maxLength={60}
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
          onChangeText={onLocationQueryChange}
          placeholder="e.g. Lincoln Hall, Illini Union, 934 Lundy Lane"
          autoCorrect={false}
        />
        {locationSearching && <ActivityIndicator size="small" color={theme.colors.navy} style={{ marginTop: 6 }} />}
        {locationSuggestions.length > 0 && (
          <View style={styles.suggestionList}>
            {locationSuggestions.map((item, i) => (
              <Pressable
                key={`${item.type}-${item.place_id ?? item.building_id}-${i}`}
                style={[styles.suggestionItem, i < locationSuggestions.length - 1 && styles.suggestionSep]}
                onPress={() => onSelectLocationSuggestion(item)}
              >
                <Text style={styles.suggestionName} numberOfLines={1}>
                  {item.name}
                </Text>
                {(item.secondary_text || item.display_name) ? (
                  <Text style={styles.suggestionSub} numberOfLines={1}>
                    {item.secondary_text ?? item.display_name}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
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
      </View></View>

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
              <View style={styles.cardActions}>
                <Pressable
                  style={styles.notifBtn}
                  accessibilityLabel={disabledNotifIds.includes(c.class_id) ? `Unmute notifications for ${c.title}` : `Mute notifications for ${c.title}`}
                  onPress={async () => {
                    if (disabledNotifIds.includes(c.class_id)) {
                      await enableClassNotif(c.class_id);
                    } else {
                      await disableClassNotif(c.class_id);
                      await cancelClassReminder(c.class_id);
                    }
                    setDisabledNotifIds(await getDisabledClassIds());
                  }}
                >
                  {disabledNotifIds.includes(c.class_id)
                    ? <BellOff size={18} color={theme.colors.textMuted} />
                    : <Bell size={18} color={theme.colors.navy} />}
                </Pressable>
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => onDeleteClass(c)}
                  accessibilityLabel={`Delete ${c.title}`}
                >
                  <Trash2 size={18} color={theme.colors.error} />
                </Pressable>
              </View>
            </View>
            <Text style={styles.classMeta}>
              {c.days_of_week.join(", ")} · {to12h(c.start_time_local)}
              {c.end_time_local ? `–${to12h(c.end_time_local)}` : ""} · {classLocationLabel(c)}
            </Text>
            {disabledNotifIds.includes(c.class_id) && (
              <Text style={styles.notifMutedLabel}>Notifications muted</Text>
            )}
            {classRouteDatas[c.class_id] != null && (
              <View style={styles.transitOverlay}>
                <Text style={styles.transitOverlayText}>
                  Leave by {getLeaveByTime(c.start_time_local, classRouteDatas[c.class_id]!.bestDepartInMinutes)}
                </Text>
                <View style={[styles.transitStatusDot, {
                  backgroundColor: getTransitStatusColor(c.start_time_local, classRouteDatas[c.class_id]!.bestDepartInMinutes)
                }]} />
              </View>
            )}
          </View>
        ))
      )}
      <Pressable style={styles.planWeekBtn} onPress={() => router.push('/after-class-planner')}>
        <Text style={styles.planWeekBtnText}>Plan my evening →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.surface },
  container: { padding: 16, paddingBottom: 32 },
  error: { color: theme.colors.error, fontFamily: "DMSans_400Regular", fontSize: 14, marginBottom: 12 },
  formCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, marginBottom: 16, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  form: { marginBottom: 0 },
  label: { fontSize: 14, fontFamily: "DMSans_600SemiBold", color: theme.colors.text, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: 12,
    fontSize: 16,
    fontFamily: "DMSans_400Regular",
  },
  dayRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  dayBtn: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    justifyContent: "center",
    alignItems: "center",
  },
  dayBtnOn: { backgroundColor: theme.colors.orange },
  dayText: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.text },
  dayTextOn: { color: theme.colors.surface },
  searchLocationBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.md,
    alignItems: "center",
  },
  searchLocationBtnDisabled: { opacity: 0.7 },
  searchLocationBtnText: { color: theme.colors.surface, fontSize: 15, fontFamily: "DMSans_600SemiBold" },
  locationError: { color: theme.colors.error, fontSize: 14, fontFamily: "DMSans_400Regular", marginTop: 6 },
  locationConfirmed: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.success, marginTop: 8 },
  suggestionList: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    marginTop: 4,
    backgroundColor: theme.colors.surface,
    overflow: "hidden",
  },
  suggestionItem: { paddingVertical: 10, paddingHorizontal: 12 },
  suggestionSep: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  suggestionName: { fontSize: 15, fontFamily: "DMSans_600SemiBold", color: theme.colors.text },
  suggestionSub: { fontSize: 13, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 2 },
  submitBtn: {
    backgroundColor: theme.colors.orange,
    padding: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: 16,
  },
  submitDisabled: { opacity: 0.7 },
  submitText: { color: theme.colors.surface, fontFamily: "DMSans_600SemiBold", fontSize: 16 },
  viewToggleRow: {
    flexDirection: "row",
    marginBottom: 12,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  viewToggleBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  viewToggleBtnActive: { backgroundColor: theme.colors.navy },
  viewToggleText: { fontSize: 14, fontFamily: "DMSans_600SemiBold", color: theme.colors.textSecondary },
  viewToggleTextActive: { color: theme.colors.surface },
  weekStrip: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  weekDayBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  weekDayBtnActive: { backgroundColor: theme.colors.orange },
  weekDayText: { fontSize: 13, fontFamily: "DMSans_500Medium", color: theme.colors.text },
  weekDayTextActive: { color: theme.colors.surface },
  listTitle: { fontSize: 18, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, marginBottom: 8 },
  empty: { fontFamily: "DMSans_400Regular", fontSize: 14, color: theme.colors.textSecondary },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 12, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: theme.colors.navy, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  classTitle: { fontSize: 16, fontFamily: "DMSans_600SemiBold", color: theme.colors.text, flex: 1 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  notifBtn: { padding: 4 },
  notifBtnText: { fontSize: 18 },
  deleteBtn: { padding: 4 },
  deleteBtnText: { fontSize: 18 },
  classMeta: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 4 },
  notifMutedLabel: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.orange, marginTop: 4, fontStyle: "italic" },
  transitOverlay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.colors.border },
  transitOverlayText: { fontSize: 12, fontFamily: 'DMSans_500Medium', color: theme.colors.textSecondary },
  transitStatusDot: { width: 8, height: 8, borderRadius: 4 },
  planWeekBtn: { marginTop: 20, padding: 14, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.orange, alignItems: 'center' },
  planWeekBtnText: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.colors.orange },
  successToast: { backgroundColor: theme.colors.success, borderRadius: theme.radius.md, padding: 12, marginBottom: 12, alignItems: 'center' },
  successToastText: { color: '#fff', fontSize: 14, fontFamily: 'DMSans_600SemiBold' },
});
