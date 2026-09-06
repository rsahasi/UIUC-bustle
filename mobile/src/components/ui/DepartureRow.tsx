import { theme } from "@/src/constants/theme";
import { StyleSheet, Text, View } from "react-native";
import { Badge } from "./Badge";
import { TickingCountdown } from "./motion";

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

/**
 * Departure-board row: route pill, headsign, live ticking countdown with
 * tabular numerals. LIVE state pairs a breathing dot with the word itself;
 * delay state is a labeled chip.
 */
export function DepartureRow({ route, headsign, expectedMins, isRealtime, expectedTimeIso, delayStatus, delayMins }: DepartureRowProps) {
  const isNow = expectedMins <= 0;
  const isSoon = expectedMins > 0 && expectedMins <= 5;

  let targetMs: number | null = null;
  if (expectedTimeIso) {
    const parsed = Date.parse(expectedTimeIso);
    if (Number.isFinite(parsed)) targetMs = parsed;
  }

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
      <View style={styles.right}>
        {showDelayed && <Badge label={`+${delayMins}m late`} variant="delayed" size="sm" />}
        {showEarly && <Badge label={`${Math.abs(delayMins!)}m early`} variant="early" size="sm" />}
        {isRealtime ? (
          <Badge label="LIVE" variant="live" size="sm" />
        ) : (
          <Badge label="Scheduled" variant="info" size="sm" />
        )}
        <TickingCountdown
          targetMs={targetMs}
          minutes={expectedMins}
          style={[styles.countdown, (isNow || isSoon) && styles.countdownUrgent]}
        />
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
});
