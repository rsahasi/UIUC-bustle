import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { fetchEodReport } from "@/src/api/client";
import { formatDistance } from "@/src/utils/distance";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { getPendingAutoWalk, clearPendingAutoWalk } from "@/src/utils/autoWalkDetect";
import { type ActivityEntry, addActivityEntry, calcStreak, dateStringForOffset, getActivityForDate, getActivityLog, todayDateString, WEEKLY_STEP_GOAL, getWeeklyStepGoal, setWeeklyStepGoal } from "@/src/storage/activityLog";
import { computeAllInsights, getDismissedInsights, dismissInsight, type PatternInsights } from "@/src/utils/patternEngine";
import PatternInsightCards from "@/src/components/PatternInsightCards";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const AI_DISCLOSURE_KEY = '@uiuc_bus_ai_report_consented';

export default function ActivityScreen() {
  const { apiBaseUrl, apiKey } = useApiBaseUrl();
  const [todayEntries, setTodayEntries] = useState<ActivityEntry[]>([]);
  const [weekSummaries, setWeekSummaries] = useState<DaySummary[]>([]);
  const [streak, setStreak] = useState(0);
  const [weeklySteps, setWeeklySteps] = useState(0);
  const [weeklyWalks, setWeeklyWalks] = useState(0);
  const [weeklyDistanceM, setWeeklyDistanceM] = useState(0);
  const [topDestination, setTopDestination] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [pendingWalk, setPendingWalk] = useState<any>(null);
  const [patternInsights, setPatternInsights] = useState<PatternInsights | null>(null);
  const [dismissedInsightKeys, setDismissedInsightKeys] = useState<string[]>([]);
  const [showAiDisclosure, setShowAiDisclosure] = useState(false);
  const [weeklyGoal, setWeeklyGoalState] = useState(WEEKLY_STEP_GOAL);

  const loadData = useCallback(async () => {
    const today = todayDateString();
    const todayData = await getActivityForDate(today);
    setTodayEntries(todayData);

    const log = await getActivityLog();
    const summaries: DaySummary[] = [];
    let totalWeekSteps = 0;
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const dateStr = dateStringForOffset(i);
      const dayEntries = log.filter((e) => e.date === dateStr);
      const daySteps = dayEntries.reduce((s, e) => s + e.stepCount, 0);
      totalWeekSteps += daySteps;
      summaries.push({
        date: dateStr,
        label: i === 0 ? "Today" : shortDayLabel(dateStr),
        steps: daySteps,
        calories: Math.round(dayEntries.reduce((s, e) => s + e.caloriesBurned, 0) * 10) / 10,
        distanceM: dayEntries.reduce((s, e) => s + e.distanceM, 0),
        durationSeconds: dayEntries.reduce((s, e) => s + e.durationSeconds, 0),
      });
    }
    setWeekSummaries(summaries);
    setStreak(calcStreak(log));
    setWeeklySteps(totalWeekSteps);

    // Commute stats: last 7 days entries
    const weekEntries = log.filter((e) => {
      const d = new Date(e.date + "T12:00:00");
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      return d >= cutoff;
    });
    setWeeklyWalks(weekEntries.length);
    setWeeklyDistanceM(weekEntries.reduce((s, e) => s + e.distanceM, 0));
    const destCounts: Record<string, number> = {};
    for (const e of weekEntries) {
      const dest = e.to.split(",")[0].trim();
      if (dest) destCounts[dest] = (destCounts[dest] ?? 0) + 1;
    }
    const topDest = Object.entries(destCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    setTopDestination(topDest);
    setLoading(false);
    setRefreshing(false);

    const goal = await getWeeklyStepGoal();
    setWeeklyGoalState(goal);

    const pending = await getPendingAutoWalk();
    setPendingWalk(pending);

    const [insights, dismissed] = await Promise.all([
      computeAllInsights(),
      getDismissedInsights(),
    ]);
    setPatternInsights(insights);
    setDismissedInsightKeys(dismissed);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const doGetReport = useCallback(async () => {
    setShowAiDisclosure(false);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Failed to get report.");
    } finally {
      setReportLoading(false);
    }
  }, [apiBaseUrl, apiKey, todayEntries]);

  const onGetReport = useCallback(async () => {
    const consented = await AsyncStorage.getItem(AI_DISCLOSURE_KEY);
    if (!consented) {
      setShowAiDisclosure(true);
    } else {
      doGetReport();
    }
  }, [doGetReport]);

  const onConfirmAutoWalk = useCallback(async () => {
    if (!pendingWalk) return;
    const durationS = (pendingWalk.endEpochMs - pendingWalk.startEpochMs) / 1000;
    await addActivityEntry({
      date: todayDateString(),
      walkingModeId: 'walk',
      distanceM: pendingWalk.distanceM,
      durationSeconds: durationS,
      stepCount: pendingWalk.stepCount,
      caloriesBurned: Math.round((durationS / 3600) * 3.5 * 70 * 10) / 10, // MET(3.5) × 70kg × hours
      from: 'Auto-detected',
      to: 'Auto-detected',
    });
    await clearPendingAutoWalk();
    setPendingWalk(null);
    loadData();
  }, [pendingWalk, loadData]);

  const onDismissAutoWalk = useCallback(async () => {
    await clearPendingAutoWalk();
    setPendingWalk(null);
  }, []);

  const handleDismissInsight = useCallback(async (key: string) => {
    await dismissInsight(key);
    loadData();
  }, [loadData]);

  const todaySteps = todayEntries.reduce((s, e) => s + e.stepCount, 0);
  const todayCalories = todayEntries.reduce((s, e) => s + e.caloriesBurned, 0);
  const todayDistanceM = todayEntries.reduce((s, e) => s + e.distanceM, 0);
  const todayDurationSeconds = todayEntries.reduce((s, e) => s + e.durationSeconds, 0);

  const maxSteps = Math.max(...weekSummaries.map((d) => d.steps), 1);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.navy} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.navy} />}
    >
      {/* Auto-walk prompt */}
      {pendingWalk != null && (
        <View style={styles.autoWalkPrompt}>
          <Text style={styles.autoWalkPromptTitle}>Looks like you walked</Text>
          <Text style={styles.autoWalkPromptBody}>
            {formatDistance(pendingWalk.distanceM)} · ~{Math.round((pendingWalk.endEpochMs - pendingWalk.startEpochMs) / 60000)} min
          </Text>
          <View style={styles.autoWalkPromptRow}>
            <Pressable style={styles.autoWalkConfirm} onPress={onConfirmAutoWalk}>
              <Text style={styles.autoWalkConfirmText}>Log it</Text>
            </Pressable>
            <Pressable style={styles.autoWalkDismiss} onPress={onDismissAutoWalk}>
              <Text style={styles.autoWalkDismissText}>Not me</Text>
            </Pressable>
          </View>
        </View>
      )}

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
            <Text style={styles.statValue}>{(todayDistanceM / 1609.344).toFixed(2)}</Text>
            <Text style={styles.statLabel}>mi</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{Math.floor(todayDurationSeconds / 60)}</Text>
            <Text style={styles.statLabel}>min</Text>
          </View>
        </View>
      </View>

      {/* Streak + weekly goal */}
      <View style={styles.streakRow}>
        <View style={styles.streakCard}>
          <Text style={styles.streakCount}>{streak}</Text>
          <Text style={styles.streakLabel}>{streak === 1 ? "day streak" : "days streak"}</Text>
          <Text style={styles.streakHint}>{streak === 0 ? 'Walk today to start' : streak < 7 ? `${7 - streak} days to a week streak!` : 'Week streak!'}</Text>
        </View>
        <View style={styles.weeklyCard}>
          <View style={styles.weeklyHeader}>
            <Text style={styles.weeklyLabel}>Weekly goal</Text>
            <Pressable onPress={() => {
              Alert.prompt(
                'Weekly step goal',
                'Enter your weekly step goal',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Save',
                    onPress: async (val) => {
                      const n = parseInt(val ?? '', 10);
                      if (!isNaN(n) && n >= 1000) {
                        await setWeeklyStepGoal(n);
                        setWeeklyGoalState(n);
                      }
                    },
                  },
                ],
                'plain-text',
                String(weeklyGoal)
              );
            }}>
              <Text style={styles.weeklyFraction}>
                {weeklySteps.toLocaleString()} / {weeklyGoal.toLocaleString()} ✎
              </Text>
            </Pressable>
          </View>
          <View style={styles.weeklyBarBg}>
            <View
              style={[
                styles.weeklyBarFill,
                { width: `${Math.min(100, (weeklySteps / weeklyGoal) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.weeklyPct}>
            {Math.round((weeklySteps / weeklyGoal) * 100)}% complete
          </Text>
        </View>
      </View>

      {/* Personalized goal suggestion */}
      {weeklySteps > weeklyGoal * 1.1 && (
        <View style={styles.goalSuggestion}>
          <Text style={styles.goalSuggestionText}>
            You're consistently exceeding your goal — consider raising it to {Math.ceil(weeklySteps * 1.1 / 1000) * 1000} steps/week
          </Text>
        </View>
      )}

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
                <View style={[styles.barFill, { height: Math.max(barH, 2), backgroundColor: isToday ? theme.colors.orange : theme.colors.navy }]} />
                <Text style={[styles.chartBarLabel, isToday && styles.chartBarLabelToday]}>{d.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Weekly commute summary */}
      {weeklyWalks > 0 && (
        <View style={styles.commuteSummaryCard}>
          <Text style={styles.commuteSummaryTitle}>7-day commute summary</Text>
          <View style={styles.commuteSummaryRow}>
            <View style={styles.commuteStat}>
              <Text style={styles.commuteStatValue}>{weeklyWalks}</Text>
              <Text style={styles.commuteStatLabel}>walks</Text>
            </View>
            <View style={styles.commuteStat}>
              <Text style={styles.commuteStatValue}>{(weeklyDistanceM / 1609.344).toFixed(1)}</Text>
              <Text style={styles.commuteStatLabel}>mi total</Text>
            </View>
            <View style={styles.commuteStat}>
              <Text style={styles.commuteStatValue}>{(weeklyDistanceM / Math.max(weeklyWalks, 1) / 1609.344).toFixed(1)}</Text>
              <Text style={styles.commuteStatLabel}>mi avg</Text>
            </View>
          </View>
          {topDestination && (
            <Text style={styles.commuteTopDest}>Most frequent: {topDestination}</Text>
          )}
        </View>
      )}

      {/* Money saved */}
      {weeklyWalks > 0 && (
        <View style={styles.moneySavedCard}>
          <Text style={styles.moneySavedLabel}>This week you saved</Text>
          <Text style={styles.moneySavedAmount}>${(weeklyWalks * 8).toFixed(0)}</Text>
          <Text style={styles.moneySavedSub}>vs. {weeklyWalks} Uber trips at ~$8 each</Text>
        </View>
      )}

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

      {/* Pattern insights */}
      {patternInsights !== null && (
        <PatternInsightCards
          insights={patternInsights}
          dismissedKeys={dismissedInsightKeys}
          onDismiss={handleDismissInsight}
        />
      )}

      {/* AI disclosure card */}
      {showAiDisclosure && (
        <View style={styles.disclosureCard}>
          <Text style={styles.disclosureTitle}>Before we continue</Text>
          <Text style={styles.disclosureBody}>
            To generate your report, your step count, distance, and walk history for today will be sent to an AI service. No personal identifiers are included.
          </Text>
          <View style={styles.disclosureRow}>
            <Pressable style={styles.disclosureDeny} onPress={() => setShowAiDisclosure(false)}>
              <Text style={styles.disclosureDenyText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.disclosureAllow}
              onPress={async () => {
                await AsyncStorage.setItem(AI_DISCLOSURE_KEY, '1');
                doGetReport();
              }}
            >
              <Text style={styles.disclosureAllowText}>Allow & Generate</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* AI Report button */}
      <Pressable
        style={({ pressed }) => [styles.reportBtn, reportLoading && styles.reportBtnDisabled, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}
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
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.lg,
    padding: 16,
    marginBottom: 16,
  },
  todayTitle: { fontSize: 20, fontFamily: "DMSerifDisplay_400Regular", color: "#fff", marginBottom: 12 },
  todayStats: { flexDirection: "row", justifyContent: "space-around" },
  statCell: { alignItems: "center" },
  statValue: { fontSize: 22, fontFamily: "DMSans_700Bold", color: "#fff" },
  statLabel: { fontSize: 11, fontFamily: "DMSans_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  streakRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  streakCard: {
    flex: 1,
    backgroundColor: theme.colors.navy,
    borderRadius: theme.radius.md,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  streakCount: { fontSize: 36, fontFamily: "DMSans_700Bold", color: theme.colors.orange, lineHeight: 40 },
  streakLabel: { fontSize: 12, fontFamily: "DMSans_500Medium", color: "rgba(255,255,255,0.75)", marginTop: 2 },
  streakHint: { fontSize: 11, fontFamily: "DMSans_400Regular", color: "rgba(255,255,255,0.5)", marginTop: 4, textAlign: "center" },
  weeklyCard: {
    flex: 2,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: "center",
  },
  weeklyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  weeklyLabel: { fontSize: 12, fontFamily: "DMSans_600SemiBold", color: theme.colors.textSecondary },
  weeklyFraction: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted },
  weeklyBarBg: {
    height: 8,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 6,
  },
  weeklyBarFill: {
    height: 8,
    backgroundColor: theme.colors.orange,
    borderRadius: 4,
  },
  weeklyPct: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted },

  chartCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chartTitle: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, marginBottom: 12 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: BAR_MAX_H + 40 },
  chartBar: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartBarValue: { fontSize: 9, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 2 },
  barFill: { width: "80%", borderRadius: 4 },
  chartBarLabel: { fontSize: 10, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 4, textAlign: "center" },
  chartBarLabelToday: { color: theme.colors.orange, fontFamily: "DMSans_700Bold" },
  sectionTitle: { fontSize: 16, fontFamily: "DMSans_700Bold", color: theme.colors.navy, marginBottom: 10 },
  empty: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 16 },
  entryCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  entryRoute: { fontSize: 14, fontFamily: "DMSans_600SemiBold", color: theme.colors.text },
  entryMeta: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 4 },
  commuteSummaryCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  commuteSummaryTitle: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, marginBottom: 12 },
  commuteSummaryRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  commuteStat: { alignItems: "center" },
  commuteStatValue: { fontSize: 22, fontFamily: "DMSans_700Bold", color: theme.colors.text },
  commuteStatLabel: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 2 },
  commuteTopDest: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 8, marginTop: 4 },

  reportBtn: {
    backgroundColor: theme.colors.orange,
    padding: 14,
    borderRadius: theme.radius.md,
    alignItems: "center",
    marginTop: 16,
    marginBottom: 12,
  },
  reportBtnDisabled: { opacity: 0.7 },
  reportBtnText: { color: "#fff", fontSize: 16, fontFamily: "DMSans_700Bold" },
  reportError: { backgroundColor: "#fff0f0", borderRadius: theme.radius.md, padding: 12, marginBottom: 12 },
  reportErrorText: { color: theme.colors.error, fontSize: 14, fontFamily: "DMSans_400Regular" },
  reportCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reportTitle: { fontSize: 15, fontFamily: "DMSans_700Bold", color: theme.colors.navy, marginBottom: 8 },
  reportBody: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.text, lineHeight: 22 },

  // Auto-walk prompt
  autoWalkPrompt: { backgroundColor: '#FFF8F6', borderLeftWidth: 4, borderLeftColor: theme.colors.orange, padding: 14, marginBottom: 12, borderRadius: theme.radius.md },
  autoWalkPromptTitle: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.colors.navy, marginBottom: 2 },
  autoWalkPromptBody: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary, marginBottom: 10 },
  autoWalkPromptRow: { flexDirection: 'row', gap: 10 },
  autoWalkConfirm: { backgroundColor: theme.colors.orange, paddingVertical: 8, paddingHorizontal: 16, borderRadius: theme.radius.md },
  autoWalkConfirmText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
  autoWalkDismiss: { paddingVertical: 8, paddingHorizontal: 16 },
  autoWalkDismissText: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary },

  // Money saved card
  moneySavedCard: { backgroundColor: theme.colors.navy, borderRadius: theme.radius.md, padding: 16, marginBottom: 16, alignItems: 'center' },
  moneySavedLabel: { fontSize: 12, fontFamily: 'DMSans_500Medium', color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  moneySavedAmount: { fontSize: 40, fontFamily: 'DMSerifDisplay_400Regular', color: theme.colors.orange, lineHeight: 46 },
  moneySavedSub: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: 'rgba(255,255,255,0.6)', marginTop: 4 },

  // Goal suggestion
  goalSuggestion: { backgroundColor: '#F0FFF4', borderRadius: theme.radius.md, padding: 12, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: theme.colors.success },
  goalSuggestionText: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.colors.success },

  // AI disclosure card
  disclosureCard: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: 16, marginTop: 16, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  disclosureTitle: { fontSize: 15, fontFamily: 'DMSans_700Bold', color: theme.colors.navy, marginBottom: 8 },
  disclosureBody: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  disclosureRow: { flexDirection: 'row', gap: 10 },
  disclosureDeny: { flex: 1, padding: 12, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  disclosureDenyText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: theme.colors.textSecondary },
  disclosureAllow: { flex: 2, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.navy, alignItems: 'center' },
  disclosureAllowText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
});
