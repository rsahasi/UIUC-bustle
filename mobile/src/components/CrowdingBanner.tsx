import { theme } from "@/src/constants/theme";
import { useCrowding } from "@/src/queries/crowding";
import { crowdingColor, crowdingSourceLabel, CROWDING_ICONS, CROWDING_LABELS } from "@/src/utils/crowding";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CrowdingSheet } from "./CrowdingSheet";

interface CrowdingBannerProps {
  vehicleId: string;
  routeId: string;
  tripId?: string;
}

export function CrowdingBanner({ vehicleId, routeId, tripId }: CrowdingBannerProps) {
  const { data: crowding, isLoading } = useCrowding(vehicleId, routeId);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isLoading) return null;

  const color = crowdingColor(crowding);
  const label = crowding ? CROWDING_LABELS[crowding.level] : "No data";
  const icon = crowding ? CROWDING_ICONS[crowding.level] : "⬜";
  const sourceLabel = crowding ? crowdingSourceLabel(crowding) : "No crowding data yet";

  return (
    <>
      <Pressable
        style={[styles.banner, { borderLeftColor: color }]}
        onPress={() => setSheetOpen(true)}
      >
        <View style={styles.left}>
          <Text style={styles.icon}>{icon}</Text>
          <View>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.source}>{sourceLabel}</Text>
          </View>
        </View>
        <Text style={[styles.reportBtn, { color }]}>Report</Text>
      </Pressable>

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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 4,
    borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginHorizontal: theme.spacing.lg,
    marginVertical: theme.spacing.xs,
  },
  left: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  icon: { fontSize: 20 },
  label: {
    fontFamily: "DMSans_600SemiBold", fontSize: 14, color: theme.colors.text,
  },
  source: {
    fontFamily: "DMSans_400Regular", fontSize: 11, color: theme.colors.textSecondary,
  },
  reportBtn: {
    fontFamily: "DMSans_600SemiBold", fontSize: 13,
  },
});
