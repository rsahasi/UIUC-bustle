import { theme } from "@/src/constants/theme";
import type { CrowdingInfo } from "@/src/api/types";
import { useCrowding } from "@/src/queries/crowding";
import { crowdingLabel, crowdingSourceLabel } from "@/src/utils/crowding";
import { CrowdingBadge } from "@/src/components/ui/CrowdingBadge";
import { PressableScale } from "@/src/components/ui/motion";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CrowdingSheet } from "./CrowdingSheet";

interface CrowdingBannerProps {
  vehicleId: string;
  routeId: string;
  tripId?: string;
}

/** AA crowding accent from theme tokens — same vocabulary as CrowdingBadge. */
function crowdThemeColor(info: CrowdingInfo | null | undefined): string {
  if (!info || info.source === "estimated") return theme.colors.crowd.estimated;
  return theme.colors.crowd[info.level] ?? theme.colors.crowd.estimated;
}

export function CrowdingBanner({ vehicleId, routeId, tripId }: CrowdingBannerProps) {
  const { data: crowding, isLoading } = useCrowding(vehicleId, routeId);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading) return null;

  const accentColor = crowdThemeColor(crowding);
  const label = crowdingLabel(crowding);
  const sourceLabel = crowding ? crowdingSourceLabel(crowding) : "No crowding data yet";

  return (
    <>
      <PressableScale
        scaleTo={0.98}
        style={[styles.banner, { borderLeftColor: accentColor }]}
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Crowding: ${label}. ${sourceLabel}. Report crowding`}
      >
        <View style={styles.left}>
          <CrowdingBadge info={crowding} size="md" />
          <Text style={styles.source} numberOfLines={1}>
            {sourceLabel}
          </Text>
        </View>
        <Text style={styles.reportBtn}>Report</Text>
      </PressableScale>

      <CrowdingSheet
        visible={sheetOpen}
        vehicleId={vehicleId}
        routeId={routeId}
        tripId={tripId}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: theme.layout.tapMin,
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: theme.colors.borderSoft,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginVertical: theme.spacing.xs,
    ...theme.elevation[1],
  },
  left: { flex: 1, gap: 3 },
  source: {
    ...theme.text.caption,
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  reportBtn: {
    ...theme.text.subhead,
    fontSize: 13,
    color: theme.colors.brandInk,
  },
});
