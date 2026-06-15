import { theme } from "@/src/constants/theme";
import { StyleSheet, Text, View } from "react-native";

interface BadgeProps {
  label: string;
  variant?: "live" | "route" | "info" | "delayed" | "early";
  size?: "sm" | "md";
}

export function Badge({ label, variant = "route", size = "md" }: BadgeProps) {
  const s = styles[variant];
  const fontSize = size === "sm" ? 10 : 12;
  const padH = size === "sm" ? 7 : 9;
  const padV = size === "sm" ? 2 : 3;
  return (
    <View style={[s.container, { paddingHorizontal: padH, paddingVertical: padV }]}>
      {variant === "live" && <View style={baseStyles.liveDot} />}
      <Text style={[s.label, { fontSize, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.3 }]}>{label}</Text>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#fff",
    marginRight: 4,
  },
});

const row = { flexDirection: "row" as const, alignItems: "center" as const };

const styles = {
  live: StyleSheet.create({
    container: { ...row, backgroundColor: theme.colors.orange, borderRadius: theme.radius.pill, ...theme.shadows.glowOrange },
    label: { color: "#fff" },
  }),
  route: StyleSheet.create({
    container: { ...row, backgroundColor: theme.colors.navy, borderRadius: theme.radius.pill },
    label: { color: "#fff" },
  }),
  info: StyleSheet.create({
    container: { ...row, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border },
    label: { color: theme.colors.textSecondary },
  }),
  delayed: StyleSheet.create({
    container: { ...row, backgroundColor: theme.colors.error, borderRadius: theme.radius.pill },
    label: { color: "#fff" },
  }),
  early: StyleSheet.create({
    container: { ...row, backgroundColor: theme.colors.success, borderRadius: theme.radius.pill },
    label: { color: "#fff" },
  }),
};
