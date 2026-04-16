import { theme } from "@/src/constants/theme";
import type { RecommendationOption } from "@/src/api/types";
import { Bus, Footprints } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { CrowdingBadge } from "./CrowdingBadge";
import type { CrowdingInfo } from "@/src/api/types";

export interface RouteCardProps {
  option: RecommendationOption;
  onStartWalk?: () => void;
  onStartBus?: () => void;
  isHighlighted?: boolean;
  crowding?: CrowdingInfo | null;
}

export function RouteCard({ option, onStartWalk, onStartBus, isHighlighted, crowding }: RouteCardProps) {
  const isBus = option.type === "BUS";
  const etaText = `${option.eta_minutes ?? "?"}m ETA`;
  const departText = option.depart_in_minutes != null
    ? option.depart_in_minutes <= 0 ? "Leave now" : `Depart in ${option.depart_in_minutes}m`
    : null;

  return (
    <View style={[styles.card, isHighlighted && styles.highlighted]}>
      {isHighlighted && <View style={styles.accentBar} />}
      <View style={styles.header}>
        <Badge label={isBus ? "Bus" : "Walk"} variant={isBus ? "route" : "info"} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          {isBus && crowding && <CrowdingBadge info={crowding} size="sm" />}
          <Text style={styles.eta}>{etaText}</Text>
        </View>
      </View>
      {departText && <Text style={styles.depart}>{departText}</Text>}
      {option.summary ? <Text style={styles.summary} numberOfLines={2}>{option.summary}</Text> : null}
      <View style={styles.actions}>
        {onStartWalk && (
          <Button label="Walk" onPress={onStartWalk} variant="secondary" size="sm" icon={Footprints} />
        )}
        {onStartBus && isBus && (
          <Button label="Take Bus" onPress={onStartBus} variant="primary" size="sm" icon={Bus} />
        )}
        {onStartWalk && !isBus && (
          <Button label="Start Walk" onPress={onStartWalk} variant="primary" size="sm" icon={Footprints} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginHorizontal: theme.spacing.lg,
    marginVertical: theme.spacing.xs,
    overflow: "hidden",
  },
  highlighted: {
    borderColor: theme.colors.orange,
    paddingLeft: theme.spacing.md + 3,
  },
  accentBar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: theme.colors.orange,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  eta: {
    fontFamily: "DMSans_600SemiBold",
    fontSize: 14,
    color: theme.colors.text,
  },
  depart: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  summary: {
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
});
