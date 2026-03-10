import { theme } from "@/src/constants/theme";
import { StyleSheet, Text, View } from "react-native";

interface BadgeProps {
  label: string;
  variant?: "live" | "route" | "info";
  size?: "sm" | "md";
}

export function Badge({ label, variant = "route", size = "md" }: BadgeProps) {
  const s = styles[variant];
  const fontSize = size === "sm" ? 10 : 12;
  const padH = size === "sm" ? 5 : 7;
  const padV = size === "sm" ? 1 : 2;
  return (
    <View style={[s.container, { paddingHorizontal: padH, paddingVertical: padV }]}>
      <Text style={[s.label, { fontSize, fontFamily: "DMSans_600SemiBold" }]}>{label}</Text>
    </View>
  );
}

const styles = {
  live: StyleSheet.create({
    container: { backgroundColor: theme.colors.orange, borderRadius: theme.radius.sm },
    label: { color: "#fff" },
  }),
  route: StyleSheet.create({
    container: { backgroundColor: theme.colors.navy, borderRadius: theme.radius.sm },
    label: { color: "#fff" },
  }),
  info: StyleSheet.create({
    container: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border },
    label: { color: theme.colors.textSecondary },
  }),
};
