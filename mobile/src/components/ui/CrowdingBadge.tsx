import { theme } from "@/src/constants/theme";
import type { CrowdingInfo } from "@/src/api/types";
import { StyleSheet, Text, View } from "react-native";
import { crowdingLabel, CROWDING_ICONS } from "@/src/utils/crowding";

interface CrowdingBadgeProps {
  info: CrowdingInfo | null | undefined;
  size?: "sm" | "md";
}

/** AA-safe crowding colors from the theme — glyph + label always accompany color. */
function crowdingThemeColor(info: CrowdingInfo | null | undefined): string {
  if (!info || info.source === "estimated") return theme.colors.crowd.estimated;
  return theme.colors.crowd[info.level] ?? theme.colors.crowd.estimated;
}

export function CrowdingBadge({ info, size = "sm" }: CrowdingBadgeProps) {
  const color = crowdingThemeColor(info);
  const label = info ? crowdingLabel(info) : "No data";
  const icon = info ? CROWDING_ICONS[info.level] : "⬜";
  const isDashed = !info || info.source === "estimated";

  return (
    <View
      style={[
        styles.badge,
        size === "md" && styles.badgeMd,
        { borderColor: color, borderStyle: isDashed ? "dashed" : "solid" },
      ]}
      accessible
      accessibilityLabel={`Crowding: ${label}${isDashed ? ", estimated" : ""}`}
    >
      <Text style={[styles.text, size === "md" && styles.textMd, { color }]}>
        {icon} {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeMd: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.md,
  },
  text: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
  },
  textMd: {
    fontSize: 13,
  },
});
