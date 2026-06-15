import { theme } from "@/src/constants/theme";
import { PressableScale } from "@/src/components/ui/motion";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
}

export function Button({ label, onPress, variant = "primary", size = "md", icon: Icon, loading, disabled }: ButtonProps) {
  const isDisabled = disabled || loading;
  const s = styles[variant];
  const padV = size === "sm" ? 7 : 12;
  const padH = size === "sm" ? 14 : 18;
  const fontSize = size === "sm" ? 13 : 15;

  const content = loading ? (
    <ActivityIndicator size="small" color={variant === "primary" ? "#fff" : theme.colors.orange} />
  ) : (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} color={s.label.color} strokeWidth={2.2} />}
      <Text style={[s.label, { fontSize, fontFamily: "DMSans_600SemiBold" }]}>{label}</Text>
    </View>
  );

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      scaleTo={0.95}
      style={[s.container, variant === "primary" && !isDisabled && theme.shadows.glowOrange, { opacity: isDisabled ? 0.5 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {variant === "primary" ? (
        <LinearGradient
          colors={[theme.gradients.sunset[0], theme.gradients.sunset[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.gradientFill, { paddingVertical: padV, paddingHorizontal: padH }]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={{ paddingVertical: padV, paddingHorizontal: padH, alignItems: "center" }}>{content}</View>
      )}
    </PressableScale>
  );
}

const styles = {
  gradientFill: StyleSheet.create({
    fill: { alignItems: "center" as const, justifyContent: "center" as const },
  }).fill,
  primary: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, overflow: "hidden" as const },
    label: { color: "#fff" },
  }),
  secondary: StyleSheet.create({
    container: { borderWidth: 1.5, borderColor: theme.colors.navy, borderRadius: theme.radius.lg, alignItems: "center" as const, backgroundColor: theme.colors.surface },
    label: { color: theme.colors.navy },
  }),
  ghost: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, alignItems: "center" as const },
    label: { color: theme.colors.orange },
  }),
};
