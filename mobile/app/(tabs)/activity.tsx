import { fetchEodReport } from "@/src/api/client";
import { formatDistance } from "@/src/utils/distance";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { type ActivityEntry, dateStringForOffset, getActivityForDate, getActivityLog, todayDateString } from "@/src/storage/activityLog";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { theme } from "@/src/constants/theme";

const CHART_DAYS = 7;
const BAR_MAX_H = 80;

interface DaySummary {
  date: string;
  label: string;
  steps: number;
  calories: number;
  distanceM: number;
  durationSeconds: number;
}

function shortDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] ?? dateStr.slice(-2);
}

export default function ActivityScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const [todayEntries, setTodayEntries] = useState<ActivityEntry[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<DaySummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const today = todayDateString();
    const todayData = await getActivityForDate(today);
    setTodayEntries(todayData);

    const log = await getActivityLog();
    const summaries: DaySummary[] = [];
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const dateStr = dateStringForOffset(i);
      const dayEntries = log.filter((e) => e.date === dateStr);
      summaries.push({
        date: dateStr,
        label: i === 0 ? "Today" : shortDayLabel(dateStr),
        steps: dayEntries.reduce((s, e) => s + e.stepCount, 0),
        calories: Math.round(dayEntries.reduce((s, e) => s + e.caloriesBurned, 0) * 10) / 10,
        distanceM: dayEntries.reduce((s, e) => s + e.distanceM, 0),
        durationSeconds: dayEntries.reduce((s, e) => s + e.durationSeconds, 0),
      });
    }
    setWeekSummaries(summaries);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const onGetReport = useCallback(async () => {
    setReportLoading(true);
    setReportText(null);
    setReportError(null);
    try {
      const data = await fetchEodReport(
        apiBaseUrl,
        {
          entries: todayEntries,
          total_steps: todayEntries.reduce((s, e) => s + e.stepCount, 0),
          total_calories: todayEntries.reduce((s, e) => s + e.caloriesBurned, 0),
          total_distance_m: todayEntries.reduce((s, e) => s + e.distanceM, 0),
        },
        { apiKey: apiKey ?? undefined }
      );
      setReportText(data.report ?? "No report generated.");
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Failed to get report.");
    } finally {
      setReportLoading(false);
    }
  }, [apiBaseUrl, apiKey, todayEntries]);

  const todaySteps = todayEntries.reduce((s, e) => s + e.stepCount, 0);
  const todayCalories = todayEntries.reduce((s, e) => s + e.caloriesBurned, 0);
  const todayDistanceM = todayEntries.reduce((s, e) => s + e.distanceM, 0);
  const todayDurationSeconds = todayEntries.reduce((s, e) => s + e.durationSeconds, 0);

  const maxSteps = Math.max(...weekSummaries.map((d) => d.steps), 1);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
    >
      {/* Today summary */}
      <View style={styles.todayCard}>
        <Text style={styles.todayTitle}>Today</Text>
        <View style={styles.todayStats}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{todaySteps.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Steps</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{todayCalories.toFixed(0)}</Text>
            <Text style={styles.statLabel}>kcal</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{(todayDistanceM / 1000).toFixed(2)}</Text>
            <Text style={styles.statLabel}>km</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{Math.floor(todayDurationSeconds / 60)}</Text>
            <Text style={styles.statLabel}>min</Text>
          </View>
        </View>
      </View>

      {/* 7-day bar chart (steps) */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Steps — last 7 days</Text>
        <View style={styles.chartRow}>
          {weekSummaries.map((d) => {
            const barH = maxSteps > 0 ? Math.round((d.steps / maxSteps) * BAR_MAX_H) : 0;
            const isToday = d.label === "Today";
            return (
              <View key={d.date} style={styles.chartBar}>
                <Text style={styles.chartBarValue}>{d.steps > 0 ? d.steps.toLocaleString() : ""}</Text>
                <View style={[styles.barFill, { height: Math.max(barH, 2), backgroundColor: isToday ? theme.colors.secondary : theme.colors.primary }]} />
                <Text style={[styles.chartBarLabel, isToday && styles.chartBarLabelToday]}>{d.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Today's walks */}
      <Text style={styles.sectionTitle}>Today's walks</Text>
      {todayEntries.length === 0 ? (
        <Text style={styles.empty}>No walks recorded today. Use the Walk button on the Home screen to start tracking.</Text>
      ) : (
        todayEntries.map((e) => (
          <View key={e.id} style={styles.entryCard}>
            <Text style={styles.entryRoute}>{e.from} → {e.to}</Text>
            <Text style={styles.entryMeta}>
              {e.walkingModeId} · {formatDistance(e.distanceM)} · {Math.floor(e.durationSeconds / 60)} min · {e.caloriesBurned.toFixed(1)} kcal · {e.stepCount} steps
            </Text>
          </View>
        ))
      )}

      {/* AI Report button */}
      <Pressable
        style={[styles.reportBtn, reportLoading && styles.reportBtnDisabled]}
        onPress={onGetReport}
        disabled={reportLoading}
      >
        {reportLoading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.reportBtnText}>Get AI Report</Text>
        )}
      </Pressable>

      {reportError && (
        <View style={styles.reportError}>
          <Text style={styles.reportErrorText}>{reportError}</Text>
        </View>
      )}

      {reportText && (
        <View style={styles.reportCard}>
          <Text style={styles.reportTitle}>Today's Report</Text>
          <Text style={styles.reportBody}>{reportText}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { padding: 16, paddingBottom: 32 },
  todayCard: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    padding: 16,
    marginBottom: 16,
  },
  todayTitle: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: "600", marginBottom: 12 },
  todayStats: { flexDirection: "row", justifyContent: "space-around" },
  statCell: { alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "700", color: "#fff" },
  statLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  chartCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chartTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.primary, marginBottom: 12 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: BAR_MAX_H + 40 },
  chartBar: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartBarValue: { fontSize: 9, color: theme.colors.textSecondary, marginBottom: 2 },
  barFill: { width: "80%", borderRadius: 4 },
  chartBarLabel: { fontSize: 10, color: theme.colors.textMuted, marginTop: 4, textAlign: "center" },
  chartBarLabelToday: { color: theme.colors.secondary, fontWeight: "700" },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.primary, marginBottom: 10 },
  empty: { fontSize: 14, color: theme.colors.textSecondary, marginBottom: 16 },
  entryCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  entryRoute: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
  entryMeta: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 },
  reportBtn: {
    backgroundColor: theme.colors.secondary,
    padding: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: 16,
    marginBottom: 12,
  },
  reportBtnDisabled: { opacity: 0.7 },
  reportBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  reportError: { backgroundColor: "#fff0f0", borderRadius: 8, padding: 12, marginBottom: 12 },
  reportErrorText: { color: theme.colors.error, fontSize: 14 },
  reportCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  reportTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.primary, marginBottom: 8 },
  reportBody: { fontSize: 14, color: theme.colors.text, lineHeight: 22 },
});
