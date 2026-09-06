import { theme } from "@/src/constants/theme";
import { PressableScale } from "@/src/components/ui/motion";
import { StyleSheet, Text, View } from "react-native";

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}

/** The one eyebrow style — every section label in the app uses theme.text.eyebrow. */
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {action && (
        <PressableScale
          onPress={action.onPress}
          haptic={false}
          hitSlop={10}
          style={styles.actionHit}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.action}>{action.label}</Text>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    ...theme.text.eyebrow,
    color: theme.colors.textMuted,
  },
  actionHit: {
    minHeight: theme.layout.tapMin,
    justifyContent: "center",
  },
  action: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: theme.colors.brandInk,
  },
});
