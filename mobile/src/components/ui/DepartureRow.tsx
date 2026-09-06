import { theme } from "@/src/constants/theme";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { runOnJS, useAnimatedReaction, useDerivedValue } from "react-native-reanimated";
import { Badge } from "./Badge";
import { Odometer, Reveal, TickingCountdown, useCountdownSeconds } from "./motion";

interface DepartureRowProps {
  route: string;
  headsign: string;
  expectedMins: number;
  isRealtime?: boolean;
  /** ISO expected time — when present, the countdown ticks live every second. */
  expectedTimeIso?: string | null;
  /** Optional delay info — rendered as a text chip (never color-only). */
  delayStatus?: "delayed" | "early" | "on_time" | null;
  delayMins?: number | null;
}

/** Width of the pressure window, in seconds: the bar appears at 5 minutes out. */
const PRESSURE_WINDOW_S = 300;
/** Below this, the countdown stops being text and becomes rolling digits. */
const ROLL_UNDER_S = 60;
const BAR_HEIGHT = 2;
/** Explicit digit window so the Odometer never measures (no first-frame jump). */
const ROLL_DIGIT_H = 18;

// Render phases. Numbers, not strings, because the phase is computed inside a
// worklet on the UI thread and only crosses to JS when it actually changes.
const PHASE_STATIC = 0; // no live target — plain "N min"
const PHASE_IDLE = 1; // live, but more than 5 minutes out
const PHASE_BAR = 2; // inside 5 minutes — pressure bar, text countdown
const PHASE_ROLL = 3; // inside 60s — pressure bar, rolling digits
const PHASE_NOW = 4; // departing

function phaseForSeconds(seconds: number): number {
  "worklet";
  if (seconds <= 0) return PHASE_NOW;
  if (seconds < ROLL_UNDER_S) return PHASE_ROLL;
  if (seconds <= PRESSURE_WINDOW_S) return PHASE_BAR;
  return PHASE_IDLE;
}

/**
 * Departure-board row: route pill, headsign, live ticking countdown with
 * tabular numerals. LIVE state pairs a breathing dot with the word itself;
 * delay state is a labeled chip.
 *
 * ── The countdown pressure bar ────────────────────────────────────────────
 * Inside five minutes a hairline under the row shortens in real time, so a
 * glance down a departure board reads urgency before it reads any number.
 * It is a `Reveal` driven by `useCountdownSeconds`, which means:
 *   - the seconds live in a SharedValue on the app's single 1s heartbeat,
 *   - the bar is one transform per second on the UI thread, and
 *   - the DepartureRow function re-renders only when the PHASE changes
 *     (four times, ever), never once per second. The leaf `TickingCountdown`
 *     still re-paints its own text node each second in the non-rolling
 *     phases — that is one Text, not the row.
 * Under 60s the digits roll (`Odometer`) off that same shared value; between
 * 60s and 90s `TickingCountdown` has already flipped itself to m:ss.
 *
 * The row's accessibilityLabel deliberately stays in WHOLE MINUTES. A label
 * that changed every second would make VoiceOver interrupt itself forever,
 * and the per-second subtree is hidden from assistive tech for the same
 * reason — everything it shows is already spelled out in the row label.
 */
export function DepartureRow({ route, headsign, expectedMins, isRealtime, expectedTimeIso, delayStatus, delayMins }: DepartureRowProps) {
  const isNow = expectedMins <= 0;
  const isSoon = expectedMins > 0 && expectedMins <= 5;

  let targetMs: number | null = null;
  if (expectedTimeIso) {
    const parsed = Date.parse(expectedTimeIso);
    if (Number.isFinite(parsed)) targetMs = parsed;
  }
  const hasTarget = targetMs != null;

  const seconds = useCountdownSeconds(targetMs);
  const [phase, setPhase] = useState<number>(() =>
    targetMs == null ? PHASE_STATIC : phaseForSeconds(Math.round((targetMs - Date.now()) / 1000))
  );

  // The only JS-thread work per tick: a comparison. setPhase fires on the
  // boundary crossings alone, so a board of 30 rows re-renders these rows only
  // when a row crosses 5:00 / 1:00 / 0:00.
  useAnimatedReaction(
    () => (hasTarget ? phaseForSeconds(seconds.value) : PHASE_STATIC),
    (next, prev) => {
      if (next !== prev) runOnJS(setPhase)(next);
    },
    [hasTarget]
  );

  const barProgress = useDerivedValue(() => {
    const s = seconds.value / PRESSURE_WINDOW_S;
    return s < 0 ? 0 : s > 1 ? 1 : s;
  });

  // The bar is a fixed-size clip window, so its extent must be a number.
  // One layout pass per width change — never per frame.
  const [barWidth, setBarWidth] = useState(0);
  const onBarLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setBarWidth((prev) => (prev === w ? prev : w));
  }, []);

  const showBar = phase === PHASE_BAR || phase === PHASE_ROLL;
  const isRolling = phase === PHASE_ROLL;

  const showDelayed = delayStatus === "delayed" && delayMins != null && delayMins > 0;
  const showEarly = delayStatus === "early" && delayMins != null;

  const a11yParts = [
    `Route ${route} to ${headsign}`,
    isNow ? "departing now" : `departs in ${expectedMins} minutes`,
    isRealtime ? "live tracking" : "scheduled time",
  ];
  if (showDelayed) a11yParts.push(`running ${delayMins} minutes late`);
  if (showEarly) a11yParts.push(`running ${Math.abs(delayMins!)} minutes early`);

  return (
    <View style={styles.row} accessible accessibilityLabel={a11yParts.join(", ")}>
      <Badge label={route} variant="route" size="sm" />
      <Text style={styles.headsign} numberOfLines={1}>{headsign}</Text>
      <View
        style={styles.right}
        // Everything in here is already in the row label above, and it is the
        // only part that changes every second.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {showDelayed && <Badge label={`+${delayMins}m late`} variant="delayed" size="sm" />}
        {showEarly && <Badge label={`${Math.abs(delayMins!)}m early`} variant="early" size="sm" />}
        {isRealtime ? (
          <Badge label="LIVE" variant="live" size="sm" />
        ) : (
          <Badge label="Scheduled" variant="info" size="sm" />
        )}
        {isRolling ? (
          <View style={styles.rollWrap}>
            <Text style={styles.rollPrefix}>0:</Text>
            <Odometer
              value={seconds}
              places={2}
              digitHeight={ROLL_DIGIT_H}
              style={styles.rollDigits}
              // Stable, in whole minutes — never the live number.
              accessibilityLabel={`Route ${route} departs in under a minute`}
            />
          </View>
        ) : (
          <TickingCountdown
            targetMs={targetMs}
            minutes={expectedMins}
            style={[styles.countdown, (isNow || isSoon) && styles.countdownUrgent]}
          />
        )}
      </View>
      <View style={styles.barTrack} pointerEvents="none" onLayout={onBarLayout}>
        {showBar && barWidth > 0 && (
          <Reveal progress={barProgress} direction="right" size={barWidth}>
            <View style={[styles.barFill, { width: barWidth }]} />
          </Reveal>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: theme.layout.tapMin,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  headsign: {
    flex: 1,
    ...theme.text.caption,
    fontSize: 14,
    color: theme.colors.text,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  countdown: {
    ...theme.text.numeric,
    fontSize: 14,
    color: theme.colors.text,
    minWidth: 44,
    textAlign: "right",
  },
  countdownUrgent: {
    color: theme.colors.brandInk,
  },
  rollWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 44,
  },
  rollPrefix: {
    ...theme.text.numeric,
    fontSize: 14,
    lineHeight: ROLL_DIGIT_H,
    color: theme.colors.brandInk,
  },
  rollDigits: {
    ...theme.text.numeric,
    fontSize: 14,
    lineHeight: ROLL_DIGIT_H,
    color: theme.colors.brandInk,
  },
  barTrack: {
    position: "absolute",
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: 0,
    height: BAR_HEIGHT,
  },
  barFill: {
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: theme.colors.brandInk,
  },
});
