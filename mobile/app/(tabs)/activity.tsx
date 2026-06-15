import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { fetchEodReport } from "@/src/api/client";
import { formatDistance } from "@/src/utils/distance";
import { useApiBaseUrl } from "@/src/hooks/useApiBaseUrl";
import { getPendingAutoWalk, clearPendingAutoWalk } from "@/src/utils/autoWalkDetect";
import { type ActivityEntry, addActivityEntry, calcStreak, dateStringForOffset, getActivityForDate, getActivityLog, todayDateString, WEEKLY_STEP_GOAL, getWeeklyStepGoal, setWeeklyStepGoal } from "@/src/storage/activityLog";
import { computeAllInsights, getDismissedInsights, dismissInsight, type PatternInsights } from "@/src/utils/patternEngine";
import PatternInsightCards from "@/src/components/PatternInsightCards";
import { useMutation } from "@tanstack/react-query";
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
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "@/src/constants/theme";
import { AnimatedBar, FadeInView, PressableScale, ProgressRing, PulseView } from "@/src/components/ui/motion";

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
  const [reportError, setReportError] = useState<string | null>(null);
  const {
    mutate: generateReport,
    isPending: reportLoading,
    data: reportData,
  } = useMutation({
    mutationFn: (payload: Parameters<typeof fetchEodReport>[1]) =>
      fetchEodReport(apiBaseUrl, payload, { apiKey: apiKey ?? undefined }),
  });
  const reportText = reportData?.report ?? null;
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
      // Window of 7 calendar days (today + 6 prior), matching the 7-day chart above.
      cutoff.setDate(cutoff.getDate() - 6);
      cutoff.setHours(0, 0, 0, 0);
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

  const doGetReport = useCallback(() => {
    setShowAiDisclosure(false);
    setReportError(null);
    const payload = {
      entries: todayEntries,
      total_steps: todayEntries.reduce((s, e) => s + e.stepCount, 0),
      total_calories: todayEntries.reduce((s, e) => s + e.caloriesBurned, 0),
      total_distance_m: todayEntries.reduce((s, e) => s + e.distanceM, 0),
    };
    generateReport(payload, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      onError: (e) => {
        setReportError(e instanceof Error ? e.message : "Failed to get report.");
      },
    });
  }, [todayEntries, generateReport]);

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
  const weeklyProgress = Math.min(1, Math.max(0, weeklySteps / weeklyGoal));

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
        <FadeInView delay={0} style={styles.autoWalkPrompt}>
          <Text style={styles.autoWalkPromptTitle}>Looks like you walked</Text>
          <Text style={styles.autoWalkPromptBody}>
            {formatDistance(pendingWalk.distanceM)} · ~{Math.round((pendingWalk.endEpochMs - pendingWalk.startEpochMs) / 60000)} min
          </Text>
          <View style={styles.autoWalkPromptRow}>
            <PressableScale style={styles.autoWalkConfirm} onPress={onConfirmAutoWalk}>
              <LinearGradient
                colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.autoWalkConfirmInner}
              >
                <Text style={styles.autoWalkConfirmText}>Log it</Text>
              </LinearGradient>
            </PressableScale>
            <PressableScale haptic={false} style={styles.autoWalkDismiss} onPress={onDismissAutoWalk}>
              <Text style={styles.autoWalkDismissText}>Not me</Text>
            </PressableScale>
          </View>
        </FadeInView>
      )}

      {/* Today summary */}
      <FadeInView delay={0}>
        <LinearGradient
          colors={[theme.gradients.ember[0], theme.gradients.ember[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.todayCard}
        >
          <Text style={styles.todayTitle}>Today</Text>
          <Text style={styles.todayHeroValue}>{todaySteps.toLocaleString()}</Text>
          <Text style={styles.todayHeroLabel}>Steps</Text>
          <View style={styles.todayStats}>
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{todayCalories.toFixed(0)}</Text>
              <Text style={styles.statLabel}>kcal</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{(todayDistanceM / 1609.344).toFixed(2)}</Text>
              <Text style={styles.statLabel}>mi</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statValue}>{Math.floor(todayDurationSeconds / 60)}</Text>
              <Text style={styles.statLabel}>min</Text>
            </View>
          </View>
        </LinearGradient>
      </FadeInView>

      {/* Streak + weekly goal */}
      <FadeInView delay={70} style={styles.streakRow}>
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
                    onPress: async (val?: string) => {
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
          <View style={styles.weeklyRingWrap}>
            <ProgressRing
              progress={weeklyProgress}
              size={112}
              strokeWidth={11}
              colors={[theme.colors.mint, theme.colors.sky]}
            >
              <Text style={styles.weeklyPctBig}>
                {Math.round((weeklySteps / weeklyGoal) * 100)}%
              </Text>
              <Text style={styles.weeklyPctSub}>complete</Text>
            </ProgressRing>
          </View>
        </View>
        <LinearGradient
          colors={[theme.gradients.ember[0], theme.gradients.ember[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.streakCard}
        >
          <PulseView minOpacity={0.8} maxScale={1.05} duration={1400}>
            <Text style={styles.streakCount}>{streak}</Text>
          </PulseView>
          <Text style={styles.streakLabel}>{streak === 1 ? "day streak" : "days streak"}</Text>
          <Text style={styles.streakHint}>{streak === 0 ? 'Walk today to start' : streak < 7 ? `${7 - streak} days to a week streak!` : 'Week streak!'}</Text>
        </LinearGradient>
      </FadeInView>

      {/* Personalized goal suggestion */}
      {weeklySteps > weeklyGoal * 1.1 && (
        <FadeInView delay={110} style={styles.goalSuggestion}>
          <Text style={styles.goalSuggestionText}>
            You're consistently exceeding your goal — consider raising it to {Math.ceil(weeklySteps * 1.1 / 1000) * 1000} steps/week
          </Text>
        </FadeInView>
      )}

      {/* 7-day bar chart (steps) */}
      <FadeInView delay={140} style={styles.chartCard}>
        <Text style={styles.chartTitle}>Steps — last 7 days</Text>
        <View style={styles.chartRow}>
          {weekSummaries.map((d, i) => {
            const barH = maxSteps > 0 ? Math.round((d.steps / maxSteps) * BAR_MAX_H) : 0;
            const isToday = d.label === "Today";
            return (
              <View key={d.date} style={styles.chartBar}>
                <Text style={styles.chartBarValue}>{d.steps > 0 ? d.steps.toLocaleString() : ""}</Text>
                <AnimatedBar
                  height={Math.max(barH, 3)}
                  delay={i * 80}
                  width={22}
                  radius={7}
                  gradient={
                    isToday
                      ? [theme.colors.orangeBright, theme.colors.orange]
                      : [theme.colors.navyLight, theme.colors.navy]
                  }
                />
                <Text style={[styles.chartBarLabel, isToday && styles.chartBarLabelToday]}>{d.label}</Text>
              </View>
            );
          })}
        </View>
      </FadeInView>

      {/* Weekly commute summary */}
      {weeklyWalks > 0 && (
        <FadeInView delay={210} style={styles.commuteSummaryCard}>
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
        </FadeInView>
      )}

      {/* Money saved */}
      {weeklyWalks > 0 && (
        <FadeInView delay={280} style={styles.moneySavedCard}>
          <Text style={styles.moneySavedLabel}>This week you saved</Text>
          <Text style={styles.moneySavedAmount}>${(weeklyWalks * 8).toFixed(0)}</Text>
          <Text style={styles.moneySavedSub}>vs. {weeklyWalks} Uber trips at ~$8 each</Text>
        </FadeInView>
      )}

      {/* Today's walks */}
      <FadeInView delay={350}>
        <Text style={styles.sectionTitle}>Today's walks</Text>
      </FadeInView>
      {todayEntries.length === 0 ? (
        <FadeInView delay={400} style={styles.emptyCard}>
          <Text style={styles.empty}>No walks recorded today. Use the Walk button on the Home screen to start tracking.</Text>
        </FadeInView>
      ) : (
        <View style={styles.walksCard}>
          {todayEntries.map((e, i) => (
            <FadeInView key={e.id} delay={i * 60} style={[styles.entryRow, i > 0 && styles.entryRowBorder]}>
              <Text style={styles.entryRoute}>{e.from} → {e.to}</Text>
              <Text style={styles.entryMeta}>
                {e.walkingModeId} · {formatDistance(e.distanceM)} · {Math.floor(e.durationSeconds / 60)} min · {e.caloriesBurned.toFixed(1)} kcal · {e.stepCount} steps
              </Text>
            </FadeInView>
          ))}
        </View>
      )}

      {/* Pattern insights */}
      {patternInsights !== null && (
        <FadeInView delay={420}>
          <PatternInsightCards
            insights={patternInsights}
            dismissedKeys={dismissedInsightKeys}
            onDismiss={handleDismissInsight}
          />
        </FadeInView>
      )}

      {/* AI disclosure card */}
      {showAiDisclosure && (
        <FadeInView delay={0} style={styles.disclosureCard}>
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
        </FadeInView>
      )}

      {/* AI Report button */}
      <FadeInView delay={490}>
        <PressableScale
          style={[styles.reportBtn, reportLoading && styles.reportBtnDisabled]}
          onPress={onGetReport}
          disabled={reportLoading}
        >
          <LinearGradient
            colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.reportBtnInner}
          >
            {reportLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.reportBtnText}>Get AI Report</Text>
            )}
          </LinearGradient>
        </PressableScale>
      </FadeInView>

      {reportError && (
        <FadeInView delay={0} style={styles.reportError}>
          <Text style={styles.reportErrorText}>{reportError}</Text>
        </FadeInView>
      )}

      {reportText && (
        <FadeInView delay={0} style={styles.reportCard}>
          <Text style={styles.reportTitle}>Today's Report</Text>
          <Text style={styles.reportBody}>{reportText}</Text>
        </FadeInView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { padding: 16, paddingBottom: 32 },
  todayCard: {
    borderRadius: theme.radius.xl,
    padding: 20,
    marginBottom: 16,
    ...theme.shadows.glowNavy,
  },
  todayTitle: { ...theme.typography.screenTitle, color: theme.colors.textOnNavy, marginBottom: 10 },
  todayHeroValue: { fontSize: 42, lineHeight: 48, fontFamily: "DMSans_700Bold", color: "#fff" },
  todayHeroLabel: { fontSize: 12, fontFamily: "DMSans_500Medium", color: theme.colors.textOnNavyMuted, marginTop: 2, marginBottom: 14, letterSpacing: 1, textTransform: "uppercase" },
  todayStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.14)",
    paddingTop: 12,
  },
  statCell: { alignItems: "center", flex: 1 },
  statDivider: { width: 1, height: 26, backgroundColor: "rgba(255,255,255,0.14)" },
  statValue: { fontSize: 20, fontFamily: "DMSans_700Bold", color: "#fff" },
  statLabel: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textOnNavyMuted, marginTop: 2 },
  streakRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  weeklyCard: {
    flex: 1.25,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 14,
    justifyContent: "center",
    ...theme.shadows.md,
  },
  weeklyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 },
  weeklyLabel: { fontSize: 12, fontFamily: "DMSans_600SemiBold", color: theme.colors.textSecondary },
  weeklyFraction: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted },
  weeklyRingWrap: { alignItems: "center" },
  weeklyPctBig: { fontSize: 24, fontFamily: "DMSans_700Bold", color: theme.colors.navy },
  weeklyPctSub: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 1 },
  streakCard: {
    flex: 1,
    borderRadius: theme.radius.xl,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadows.glowNavy,
  },
  streakCount: { fontSize: 44, lineHeight: 50, fontFamily: "DMSans_700Bold", color: theme.colors.gold, textAlign: "center" },
  streakLabel: { fontSize: 12, fontFamily: "DMSans_500Medium", color: theme.colors.textOnNavy, marginTop: 2 },
  streakHint: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textOnNavyMuted, marginTop: 4, textAlign: "center" },

  chartCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 16,
    marginBottom: 20,
    ...theme.shadows.md,
  },
  chartTitle: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, marginBottom: 12 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: BAR_MAX_H + 40 },
  chartBar: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartBarValue: { fontSize: 9, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginBottom: 4 },
  chartBarLabel: { fontSize: 10, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 6, textAlign: "center" },
  chartBarLabelToday: { color: theme.colors.orange, fontFamily: "DMSans_700Bold" },
  sectionTitle: { ...theme.typography.screenTitle, color: theme.colors.navy, marginBottom: 10 },
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 16,
    marginBottom: 16,
    ...theme.shadows.md,
  },
  empty: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, lineHeight: 21 },
  walksCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    marginBottom: 16,
    overflow: "hidden",
    ...theme.shadows.md,
  },
  entryRow: { paddingVertical: 12, paddingHorizontal: 16 },
  entryRowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.borderSoft },
  entryRoute: { fontSize: 14, fontFamily: "DMSans_600SemiBold", color: theme.colors.text },
  entryMeta: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, marginTop: 4 },
  commuteSummaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 16,
    marginBottom: 16,
    ...theme.shadows.md,
  },
  commuteSummaryTitle: { fontSize: 13, fontFamily: "DMSans_600SemiBold", color: theme.colors.navy, marginBottom: 12 },
  commuteSummaryRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 8 },
  commuteStat: { alignItems: "center" },
  commuteStatValue: { fontSize: 22, fontFamily: "DMSans_700Bold", color: theme.colors.text },
  commuteStatLabel: { fontSize: 11, fontFamily: "DMSans_400Regular", color: theme.colors.textMuted, marginTop: 2 },
  commuteTopDest: { fontSize: 12, fontFamily: "DMSans_400Regular", color: theme.colors.textSecondary, borderTopWidth: 1, borderTopColor: theme.colors.borderSoft, paddingTop: 8, marginTop: 4 },

  reportBtn: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.orange,
    marginTop: 16,
    marginBottom: 12,
    ...theme.shadows.glowOrange,
  },
  reportBtnInner: {
    padding: 15,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    overflow: "hidden",
  },
  reportBtnDisabled: { opacity: 0.7 },
  reportBtnText: { color: "#fff", fontSize: 16, fontFamily: "DMSans_700Bold" },
  reportError: { backgroundColor: theme.colors.errorSoft, borderRadius: theme.radius.lg, padding: 12, marginBottom: 12 },
  reportErrorText: { color: theme.colors.error, fontSize: 14, fontFamily: "DMSans_400Regular" },
  reportCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 16,
    ...theme.shadows.md,
  },
  reportTitle: { fontSize: 15, fontFamily: "DMSans_700Bold", color: theme.colors.navy, marginBottom: 8 },
  reportBody: { fontSize: 14, fontFamily: "DMSans_400Regular", color: theme.colors.text, lineHeight: 22 },

  // Auto-walk prompt
  autoWalkPrompt: {
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.orange,
    padding: 14,
    marginBottom: 12,
    borderRadius: theme.radius.xl,
    ...theme.shadows.md,
  },
  autoWalkPromptTitle: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', color: theme.colors.navy, marginBottom: 2 },
  autoWalkPromptBody: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary, marginBottom: 10 },
  autoWalkPromptRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  autoWalkConfirm: { borderRadius: theme.radius.lg, backgroundColor: theme.colors.orange, ...theme.shadows.glowOrange },
  autoWalkConfirmInner: { paddingVertical: 9, paddingHorizontal: 18, borderRadius: theme.radius.lg, overflow: 'hidden' },
  autoWalkConfirmText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
  autoWalkDismiss: { paddingVertical: 9, paddingHorizontal: 16 },
  autoWalkDismissText: { fontSize: 14, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary },

  // Money saved card
  moneySavedCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 18,
    marginBottom: 20,
    alignItems: 'center',
    ...theme.shadows.md,
  },
  moneySavedLabel: { fontSize: 12, fontFamily: 'DMSans_500Medium', color: theme.colors.textSecondary, marginBottom: 4, letterSpacing: 0.5, textTransform: 'uppercase' },
  moneySavedAmount: { fontSize: 44, fontFamily: 'DMSans_700Bold', color: theme.colors.success, lineHeight: 50 },
  moneySavedSub: { fontSize: 12, fontFamily: 'DMSans_400Regular', color: theme.colors.textMuted, marginTop: 4 },

  // Goal suggestion
  goalSuggestion: { backgroundColor: theme.colors.successSoft, borderRadius: theme.radius.lg, padding: 12, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: theme.colors.success },
  goalSuggestionText: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.colors.success },

  // AI disclosure card
  disclosureCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 16,
    marginTop: 16,
    marginBottom: 8,
    ...theme.shadows.md,
  },
  disclosureTitle: { fontSize: 15, fontFamily: 'DMSans_700Bold', color: theme.colors.navy, marginBottom: 8 },
  disclosureBody: { fontSize: 13, fontFamily: 'DMSans_400Regular', color: theme.colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  disclosureRow: { flexDirection: 'row', gap: 10 },
  disclosureDeny: { flex: 1, padding: 12, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  disclosureDenyText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: theme.colors.textSecondary },
  disclosureAllow: { flex: 2, padding: 12, borderRadius: theme.radius.lg, backgroundColor: theme.colors.navy, alignItems: 'center', ...theme.shadows.glowNavy },
  disclosureAllowText: { fontSize: 14, fontFamily: 'DMSans_600SemiBold', color: '#fff' },
});
