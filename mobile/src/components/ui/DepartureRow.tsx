import { theme } from "@/src/constants/theme";
import { StyleSheet, Text, View } from "react-native";
import { Badge } from "./Badge";

interface DepartureRowProps {
  route: string;
  headsign: string;
  expectedMins: number;
  isRealtime?: boolean;
}

export function DepartureRow({ route, headsign, expectedMins, isRealtime }: DepartureRowProps) {
  const minsText = expectedMins <= 0 ? "Now" : `${expectedMins} min`;
  return (
    <View style={styles.row}>
      <Badge label={route} variant="route" size="sm" />
      <Text style={styles.headsign} numberOfLines={1}>{headsign}</Text>
      <View style={styles.right}>
        {isRealtime && <Badge label="Live" variant="live" size="sm" />}
        <Text style={styles.countdown}>{minsText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing.sm,
  },
  headsign: {
    flex: 1,
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    color: theme.colors.text,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  countdown: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
    color: theme.colors.text,
    minWidth: 44,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});
