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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AlertCircle, Flame, Footprints, MapPin, Pencil, PiggyBank, ShieldCheck, Sparkles, TrendingUp } from "lucide-react-native";
import { theme } from "@/src/constants/theme";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { AnimatedBar, AnimatedNumber, FadeInView, PressableScale, ProgressRing, PulseView, RouteProgress } from "@/src/components/ui/motion";

const CHART_DAYS = 7;
const BAR_MAX_H = 80;
/** Height of the day-label slot under each bar (label height 16 + marginTop 6). */
const LABEL_SLOT_H = 22;

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

// ── Render-only pieces ─────────────────────────────────────────────────────

/** One stat cell on the navy hero — rolling tabular digits over a quiet label. */
function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCell}>
      <AnimatedNumber value={value} style={styles.statValue} accessibilityLabel={`${value} ${label}`} />
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** Auto-detected walk prompt, styled as a proper banner with real buttons. */
function AutoWalkBanner({ distanceM, minutes, onConfirm, onDismiss }: {
  distanceM: number;
  minutes: number;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.bannerIconHalo}>
        <Footprints size={19} color={theme.colors.brandInk} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerTitle}>Looks like you walked</Text>
        <Text style={styles.bannerBody}>{formatDistance(distanceM)} · ~{minutes} min</Text>
        <View style={styles.bannerActions}>
          <Button label="Log it" size="sm" onPress={onConfirm} />
          <Button label="Not me" size="sm" variant="ghost" onPress={onDismiss} />
        </View>
      </View>
    </View>
  );
}

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

  // Visual-only chart geometry: the scale floor keeps small days honest by
  // never letting bars exaggerate below the daily goal line.
  const dailyGoal = Math.max(1, Math.round(weeklyGoal / CHART_DAYS));
  const chartMax = Math.max(maxSteps, dailyGoal);
  const goalLineH = Math.min(Math.round((dailyGoal / chartMax) * BAR_MAX_H), BAR_MAX_H);
  const weeklyPct = Math.round((weeklySteps / weeklyGoal) * 100);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.navy} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.navy} />}
    >
      {/* Auto-walk banner */}
      {pendingWalk != null && (
        <FadeInView delay={0}>
          <AutoWalkBanner
            distanceM={pendingWalk.distanceM}
            minutes={Math.round((pendingWalk.endEpochMs - pendingWalk.startEpochMs) / 60000)}
            onConfirm={onConfirmAutoWalk}
            onDismiss={onDismissAutoWalk}
          />
        </FadeInView>
      )}

      {/* Today hero — navy departure-board card */}
      <FadeInView delay={0}>
        <LinearGradient
          colors={[theme.gradients.hero[0], theme.gradients.hero[1], theme.gradients.hero[2]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.todayCard}
        >
          <Text style={styles.todayEyebrow}>Today</Text>
          <AnimatedNumber
            value={todaySteps.toLocaleString()}
            style={styles.todayHeroValue}
            accessibilityLabel={`${todaySteps.toLocaleString()} steps today`}
          />
          <Text style={styles.todayHeroLabel}>steps</Text>
          <RouteProgress
            points={[{ x: 0, y: 18 }, { x: 46, y: 4 }, { x: 102, y: 20 }, { x: 158, y: 8 }, { x: 214, y: 16 }, { x: 252, y: 2 }]}
            color={theme.colors.orange}
            dotColor={theme.colors.orangeBright}
            trackColor={theme.colors.navyLight}
            strokeWidth={2.5}
            dotRadius={4}
            duration={1800}
            style={styles.todayRoute}
          />
          <View style={styles.todayStats}>
            <HeroStat value={todayCalories.toFixed(0)} label="kcal" />
            <View style={styles.statDivider} />
            <HeroStat value={(todayDistanceM / 1609.344).toFixed(2)} label="mi" />
            <View style={styles.statDivider} />
            <HeroStat value={String(Math.floor(todayDurationSeconds / 60))} label="min" />
          </View>
        </LinearGradient>
      </FadeInView>

      {/* Streak + weekly goal */}
      <FadeInView delay={70} style={styles.streakRow}>
        <View style={styles.weeklyCard}>
          <View style={styles.weeklyHeader}>
            <Text style={styles.weeklyLabel}>Weekly goal</Text>
            <PressableScale
              haptic={false}
              hitSlop={8}
              style={styles.weeklyEditBtn}
              accessibilityRole="button"
              accessibilityLabel={`Edit weekly step goal, currently ${weeklySteps.toLocaleString()} of ${weeklyGoal.toLocaleString()} steps`}
              onPress={() => {
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
              <Pencil size={11} color={theme.colors.brandInk} strokeWidth={2.2} />
              <Text style={styles.weeklyFraction}>
                {weeklySteps.toLocaleString()} / {weeklyGoal.toLocaleString()}
              </Text>
            </PressableScale>
          </View>
          <View style={styles.weeklyRingWrap}>
            <ProgressRing progress={weeklyProgress} size={116} strokeWidth={11}>
              <AnimatedNumber
                value={`${weeklyPct}%`}
                style={styles.weeklyPctBig}
                accessibilityLabel={`${weeklyPct} percent of weekly step goal`}
              />
              <Text style={styles.weeklyPctSub}>of {weeklyGoal.toLocaleString()}</Text>
            </ProgressRing>
          </View>
        </View>
        <LinearGradient
          colors={[theme.gradients.ember[0], theme.gradients.ember[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.streakCard}
        >
          <PulseView minOpacity={0.75} maxScale={1.08} duration={1400} style={styles.streakFlame}>
            <Flame size={26} color={theme.colors.orangeBright} fill={theme.colors.orange} />
          </PulseView>
          <AnimatedNumber
            value={streak}
            style={styles.streakCount}
            accessibilityLabel={`${streak} ${streak === 1 ? "day" : "days"} streak`}
          />
          <Text style={styles.streakLabel}>{streak === 1 ? "day streak" : "days streak"}</Text>
          <Text style={styles.streakHint}>{streak === 0 ? 'Walk today to start' : streak < 7 ? `${7 - streak} days to a week streak!` : 'Week streak!'}</Text>
        </LinearGradient>
      </FadeInView>

      {/* Personalized goal suggestion */}
      {weeklySteps > weeklyGoal * 1.1 && (
        <FadeInView delay={110} style={styles.goalSuggestion}>
          <TrendingUp size={16} color={theme.colors.successDeep} />
          <Text style={styles.goalSuggestionText}>
            You're consistently exceeding your goal — consider raising it to {Math.ceil(weeklySteps * 1.1 / 1000) * 1000} steps/week
          </Text>
        </FadeInView>
      )}

      {/* 7-day bar chart (steps) */}
      <FadeInView delay={140} style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle} accessibilityRole="header">Steps · last 7 days</Text>
          <View style={styles.chartGoalKey}>
            <View style={styles.chartGoalSwatch} />
            <Text style={styles.chartGoalText}>goal {dailyGoal.toLocaleString()}/day</Text>
          </View>
        </View>
        <View style={styles.chartPlot}>
          <View pointerEvents="none" style={[styles.goalLine, { bottom: LABEL_SLOT_H + goalLineH }]} />
          <View style={styles.chartRow}>
            {weekSummaries.map((d, i) => {
              const barH = chartMax > 0 ? Math.round((d.steps / chartMax) * BAR_MAX_H) : 0;
              const isToday = d.label === "Today";
              return (
                <View
                  key={d.date}
                  style={styles.chartBar}
                  accessible
                  accessibilityLabel={`${d.label}: ${d.steps.toLocaleString()} steps`}
                >
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
        </View>
      </FadeInView>

      {/* Weekly commute summary */}
      {weeklyWalks > 0 && (
        <FadeInView delay={210} style={styles.commuteSummaryCard}>
          <Text style={styles.commuteSummaryTitle} accessibilityRole="header">7-day commute summary</Text>
          <View style={styles.commuteSummaryRow}>
            <View style={styles.commuteStat}>
              <AnimatedNumber value={weeklyWalks} style={styles.commuteStatValue} accessibilityLabel={`${weeklyWalks} walks`} />
              <Text style={styles.commuteStatLabel}>walks</Text>
            </View>
            <View style={styles.commuteStat}>
              <AnimatedNumber
                value={(weeklyDistanceM / 1609.344).toFixed(1)}
                style={styles.commuteStatValue}
                accessibilityLabel={`${(weeklyDistanceM / 1609.344).toFixed(1)} miles total`}
              />
              <Text style={styles.commuteStatLabel}>mi total</Text>
            </View>
            <View style={styles.commuteStat}>
              <AnimatedNumber
                value={(weeklyDistanceM / Math.max(weeklyWalks, 1) / 1609.344).toFixed(1)}
                style={styles.commuteStatValue}
                accessibilityLabel={`${(weeklyDistanceM / Math.max(weeklyWalks, 1) / 1609.344).toFixed(1)} miles average`}
              />
              <Text style={styles.commuteStatLabel}>mi avg</Text>
            </View>
          </View>
          {topDestination && (
            <View style={styles.commuteTopDest}>
              <MapPin size={12} color={theme.colors.textSecondary} />
              <Text style={styles.commuteTopDestText}>Most frequent: {topDestination}</Text>
            </View>
          )}
        </FadeInView>
      )}

      {/* Money saved */}
      {weeklyWalks > 0 && (
        <FadeInView delay={280} style={styles.moneySavedCard}>
          <View style={styles.moneySavedHeader}>
            <PiggyBank size={14} color={theme.colors.successDeep} strokeWidth={2} />
            <Text style={styles.moneySavedLabel}>This week you saved</Text>
          </View>
          <AnimatedNumber
            value={`$${(weeklyWalks * 8).toFixed(0)}`}
            style={styles.moneySavedAmount}
            accessibilityLabel={`Saved ${(weeklyWalks * 8).toFixed(0)} dollars this week`}
          />
          <Text style={styles.moneySavedSub}>vs. {weeklyWalks} Uber trips at ~$8 each</Text>
        </FadeInView>
      )}

      {/* Today's walks */}
      <FadeInView delay={350}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Today's walks</Text>
      </FadeInView>
      {todayEntries.length === 0 ? (
        <FadeInView delay={400} style={styles.emptyCard}>
          <EmptyState
            icon={Footprints}
            title="No walks yet today"
            subtitle="Use the Walk button on the Home screen to start tracking."
          />
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
          <View style={styles.disclosureHeader}>
            <ShieldCheck size={16} color={theme.colors.brandInk} strokeWidth={2} />
            <Text style={styles.disclosureTitle}>Before we continue</Text>
          </View>
          <Text style={styles.disclosureBody}>
            To generate your report, your step count, distance, and walk history for today will be sent to an AI service. No personal identifiers are included.
          </Text>
          <View style={styles.disclosureRow}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={() => setShowAiDisclosure(false)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                label="Allow & Generate"
                onPress={async () => {
                  await AsyncStorage.setItem(AI_DISCLOSURE_KEY, '1');
                  doGetReport();
                }}
              />
            </View>
          </View>
        </FadeInView>
      )}

      {/* AI Report button */}
      <FadeInView delay={490} style={styles.reportBtnWrap}>
        <Button
          label="Get AI Report"
          icon={Sparkles}
          onPress={onGetReport}
          loading={reportLoading}
          disabled={reportLoading}
        />
      </FadeInView>

      {reportError && (
        <FadeInView delay={0} style={styles.reportError}>
          <AlertCircle size={16} color={theme.colors.errorDeep} />
          <Text style={styles.reportErrorText}>{reportError}</Text>
        </FadeInView>
      )}

      {reportText && (
        <FadeInView delay={0} style={styles.reportCardWrap}>
          <LinearGradient
            colors={[theme.gradients.glowCard[0], theme.gradients.glowCard[1]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.reportCard}
          >
            <View style={styles.reportHeader}>
              <Sparkles size={14} color={theme.colors.brandInk} strokeWidth={2} />
              <Text style={styles.reportEyebrow}>Today's report</Text>
            </View>
            <Text style={styles.reportQuoteMark} accessible={false}>“</Text>
            <View style={styles.reportQuoteRow}>
              <View style={styles.reportQuoteRule} />
              <Text style={styles.reportBody}>{reportText}</Text>
            </View>
          </LinearGradient>
        </FadeInView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.surfaceAlt },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.surfaceAlt },
  container: { padding: theme.layout.gutter, paddingBottom: 40 },

  // Auto-walk banner
  banner: {
    flexDirection: "row",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.orangeSoft,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.orange,
    borderRadius: theme.radius.xl,
    padding: 14,
    marginBottom: theme.layout.cardGap,
    ...theme.elevation[1],
  },
  bannerIconHalo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  bannerTitle: { ...theme.text.subhead, color: theme.colors.navy },
  bannerBody: { ...theme.text.caption, fontVariant: ["tabular-nums" as const], color: theme.colors.textSecondary, marginTop: 1 },
  bannerActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: theme.spacing.sm },

  // Today hero
  todayCard: {
    borderRadius: theme.radius.xxl,
    padding: theme.spacing.lg,
    marginBottom: theme.layout.gutter,
    overflow: "hidden",
    ...theme.shadows.glowNavy,
  },
  todayEyebrow: { ...theme.text.eyebrow, color: theme.colors.textOnNavyMuted, marginBottom: theme.spacing.sm },
  todayHeroValue: { ...theme.text.display, fontSize: 48, lineHeight: 54, color: theme.colors.surface },
  todayHeroLabel: { ...theme.text.eyebrow, color: theme.colors.textOnNavyMuted, marginTop: 2, marginBottom: theme.spacing.md },
  todayRoute: { alignSelf: "center", marginBottom: theme.spacing.md, opacity: 0.9 },
  todayStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.14)",
    paddingTop: theme.spacing.md,
  },
  statCell: { alignItems: "center", flex: 1 },
  statDivider: { width: 1, height: 26, backgroundColor: "rgba(255,255,255,0.14)" },
  statValue: { ...theme.text.numeric, fontSize: 20, lineHeight: 26, color: theme.colors.surface },
  statLabel: { ...theme.text.caption, fontSize: 11, lineHeight: 14, color: theme.colors.textOnNavyMuted, marginTop: 2 },

  // Streak + weekly goal
  streakRow: { flexDirection: "row", gap: theme.layout.cardGap, marginBottom: theme.layout.gutter },
  weeklyCard: {
    flex: 1.25,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 14,
    justifyContent: "center",
    ...theme.elevation[2],
  },
  weeklyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.xs },
  weeklyLabel: { ...theme.text.eyebrow, color: theme.colors.textMuted },
  weeklyEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: theme.layout.tapMin,
    paddingLeft: theme.spacing.sm,
  },
  weeklyFraction: { ...theme.text.numeric, fontSize: 11, lineHeight: 14, color: theme.colors.brandInk },
  weeklyRingWrap: { alignItems: "center", paddingBottom: theme.spacing.xs },
  weeklyPctBig: { ...theme.text.numeric, fontSize: 24, lineHeight: 30, color: theme.colors.navy },
  weeklyPctSub: { ...theme.text.caption, fontSize: 11, lineHeight: 14, color: theme.colors.textMuted, marginTop: 1 },
  streakCard: {
    flex: 1,
    borderRadius: theme.radius.xl,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadows.glowNavy,
  },
  streakFlame: { marginBottom: 2 },
  streakCount: { ...theme.text.display, fontSize: 40, lineHeight: 46, color: theme.colors.gold, textAlign: "center" },
  streakLabel: { ...theme.text.badge, color: theme.colors.textOnNavy, marginTop: 2 },
  streakHint: { ...theme.text.caption, fontSize: 11, lineHeight: 15, color: theme.colors.textOnNavyMuted, marginTop: 4, textAlign: "center" },

  // Goal suggestion
  goalSuggestion: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.successSoft,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.layout.cardGap,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.successDeep,
  },
  goalSuggestionText: { flex: 1, ...theme.text.caption, color: theme.colors.successDeep },

  // 7-day chart
  chartCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: theme.layout.gutter,
    marginBottom: theme.spacing.lg,
    ...theme.elevation[2],
  },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.md },
  chartTitle: { ...theme.text.eyebrow, color: theme.colors.textMuted },
  chartGoalKey: { flexDirection: "row", alignItems: "center", gap: 5 },
  chartGoalSwatch: { width: 12, height: 2, borderRadius: 1, backgroundColor: theme.colors.brandInk, opacity: 0.5 },
  chartGoalText: { ...theme.text.caption, fontSize: 11, lineHeight: 14, color: theme.colors.brandInk, fontVariant: ["tabular-nums" as const] },
  chartPlot: { position: "relative" },
  goalLine: { position: "absolute", left: 0, right: 0, height: 2, borderRadius: 1, backgroundColor: theme.colors.brandInk, opacity: 0.3 },
  chartRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: BAR_MAX_H + 40 },
  chartBar: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  chartBarValue: { ...theme.text.numeric, fontSize: 9, lineHeight: 12, fontFamily: "DMSans_500Medium", color: theme.colors.textMuted, marginBottom: 4 },
  chartBarLabel: { ...theme.text.caption, fontSize: 10, lineHeight: 14, height: 16, color: theme.colors.textMuted, marginTop: 6, textAlign: "center" },
  chartBarLabelToday: { color: theme.colors.brandInk, fontFamily: "DMSans_700Bold" },

  // Section heading
  sectionTitle: { ...theme.text.title2, color: theme.colors.navy, marginBottom: 10 },

  // Walk list
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    marginBottom: theme.layout.gutter,
    ...theme.elevation[1],
  },
  walksCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    marginBottom: theme.layout.gutter,
    overflow: "hidden",
    ...theme.elevation[2],
  },
  entryRow: { paddingVertical: theme.spacing.md, paddingHorizontal: theme.layout.gutter },
  entryRowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.borderSoft },
  entryRoute: { ...theme.text.subhead, color: theme.colors.text },
  entryMeta: { ...theme.text.caption, fontSize: 12, color: theme.colors.textSecondary, marginTop: 3, fontVariant: ["tabular-nums" as const] },

  // Commute summary
  commuteSummaryCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: theme.layout.gutter,
    marginBottom: theme.layout.gutter,
    ...theme.elevation[2],
  },
  commuteSummaryTitle: { ...theme.text.eyebrow, color: theme.colors.textMuted, marginBottom: theme.spacing.md },
  commuteSummaryRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: theme.spacing.sm },
  commuteStat: { alignItems: "center" },
  commuteStatValue: { ...theme.text.numeric, fontSize: 22, lineHeight: 28, color: theme.colors.navy },
  commuteStatLabel: { ...theme.text.caption, fontSize: 11, lineHeight: 14, color: theme.colors.textMuted, marginTop: 2 },
  commuteTopDest: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSoft,
    paddingTop: theme.spacing.sm,
    marginTop: 4,
  },
  commuteTopDestText: { ...theme.text.caption, fontSize: 12, color: theme.colors.textSecondary },

  // Money saved
  moneySavedCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 18,
    marginBottom: theme.spacing.lg,
    alignItems: "center",
    ...theme.elevation[2],
  },
  moneySavedHeader: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  moneySavedLabel: { ...theme.text.eyebrow, color: theme.colors.successDeep },
  moneySavedAmount: { ...theme.text.display, fontSize: 44, lineHeight: 50, color: theme.colors.successDeep },
  moneySavedSub: { ...theme.text.caption, fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },

  // AI report
  reportBtnWrap: { marginTop: theme.layout.gutter, marginBottom: theme.layout.cardGap },
  reportError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.errorSoft,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.layout.cardGap,
  },
  reportErrorText: { flex: 1, ...theme.text.caption, fontSize: 14, lineHeight: 20, color: theme.colors.errorDeep },
  reportCardWrap: { borderRadius: theme.radius.xl, ...theme.elevation[2] },
  reportCard: {
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
  },
  reportHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: theme.spacing.sm },
  reportEyebrow: { ...theme.text.eyebrow, color: theme.colors.brandInk },
  reportQuoteMark: { fontFamily: "DMSerifDisplay_400Regular", fontSize: 44, lineHeight: 46, color: theme.colors.brandInk, marginBottom: -16 },
  reportQuoteRow: { flexDirection: "row", gap: theme.spacing.md },
  reportQuoteRule: { width: 3, borderRadius: 2, backgroundColor: theme.colors.orange },
  reportBody: { flex: 1, fontFamily: "DMSerifDisplay_400Regular", fontSize: 17, lineHeight: 26, color: theme.colors.text },

  // AI disclosure
  disclosureCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: theme.layout.gutter,
    marginTop: theme.layout.gutter,
    marginBottom: theme.spacing.sm,
    ...theme.elevation[2],
  },
  disclosureHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: theme.spacing.sm },
  disclosureTitle: { ...theme.text.heading, fontSize: 15, color: theme.colors.navy },
  disclosureBody: { ...theme.text.caption, lineHeight: 20, color: theme.colors.textSecondary, marginBottom: theme.spacing.md },
  disclosureRow: { flexDirection: "row", gap: 10 },
});
