import { theme } from "@/src/constants/theme";
import type { CrowdingInfo } from "@/src/api/types";
import { StyleSheet, Text, View } from "react-native";
import { crowdingColor, crowdingLabel, CROWDING_ICONS } from "@/src/utils/crowding";

interface CrowdingBadgeProps {
  info: CrowdingInfo | null | undefined;
  size?: "sm" | "md";
}

export function CrowdingBadge({ info, size = "sm" }: CrowdingBadgeProps) {
  const color = crowdingColor(info);
  const label = info ? crowdingLabel(info) : "No data";
  const icon = info ? CROWDING_ICONS[info.level] : "⬜";
  const isDashed = !info || info.source === "estimated";

  return (
    <View style={[
      styles.badge,
      size === "md" && styles.badgeMd,
      { borderColor: color, borderStyle: isDashed ? "dashed" : "solid" },
    ]}>
      <Text style={[styles.text, size === "md" && styles.textMd, { color }]}>
        {icon} {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeMd: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  text: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
  },
  textMd: {
    fontSize: 13,
  },
});
