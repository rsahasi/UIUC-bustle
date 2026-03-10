import { theme } from "@/src/constants/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}

export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title.toUpperCase()}</Text>
      {action && (
        <Pressable onPress={action.onPress}>
          <Text style={styles.action}>{action.label}</Text>
        </Pressable>
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
    fontFamily: "DMSans_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
    color: theme.colors.textMuted,
  },
  action: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: theme.colors.orange,
  },
});
