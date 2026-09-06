import { theme } from "@/src/constants/theme";
import { PressableScale } from "@/src/components/ui/motion";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Screen-reader label when the visible label lacks context (e.g. "Navigate to Wright & Green"). */
  accessibilityLabel?: string;
}

const SPINNER_COLOR: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "#FFFFFF",
  destructive: "#FFFFFF",
  secondary: theme.colors.navy,
  ghost: theme.colors.brandInk,
};

export function Button({ label, onPress, variant = "primary", size = "md", icon: Icon, loading, disabled, accessibilityLabel }: ButtonProps) {
  const isDisabled = disabled || loading;
  const s = styles[variant];
  const padV = size === "sm" ? 7 : 12;
  const padH = size === "sm" ? 14 : 18;
  const fontSize = size === "sm" ? 13 : 15;
  const isFilled = variant === "primary" || variant === "destructive";

  const content = loading ? (
    <ActivityIndicator size="small" color={SPINNER_COLOR[variant]} />
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
      style={[
        baseStyles.container,
        s.container,
        variant === "primary" && !isDisabled && theme.shadows.glowOrange,
        { opacity: isDisabled ? 0.5 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
    >
      {isFilled ? (
        variant === "primary" ? (
          <LinearGradient
            // Ends on ctaEnd so the white label holds AA contrast on the darker stop.
            colors={[theme.colors.orangeBright, theme.colors.ctaEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[baseStyles.fill, { paddingVertical: padV, paddingHorizontal: padH }]}
          >
            {content}
          </LinearGradient>
        ) : (
          <View style={[baseStyles.fill, { paddingVertical: padV, paddingHorizontal: padH, backgroundColor: theme.colors.errorDeep }]}>
            {content}
          </View>
        )
      ) : (
        <View style={[baseStyles.fill, { paddingVertical: padV, paddingHorizontal: padH }]}>{content}</View>
      )}
    </PressableScale>
  );
}

const baseStyles = StyleSheet.create({
  container: {
    minHeight: theme.layout.tapMin,
    minWidth: theme.layout.tapMin,
    justifyContent: "center",
  },
  fill: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

const styles = {
  primary: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, overflow: "hidden" as const },
    label: { color: "#fff" },
  }),
  destructive: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, overflow: "hidden" as const },
    label: { color: "#fff" },
  }),
  secondary: StyleSheet.create({
    container: { borderWidth: 1.5, borderColor: theme.colors.navy, borderRadius: theme.radius.lg, alignItems: "center" as const, backgroundColor: theme.colors.surface },
    label: { color: theme.colors.navy },
  }),
  ghost: StyleSheet.create({
    container: { borderRadius: theme.radius.lg, alignItems: "center" as const },
    label: { color: theme.colors.brandInk },
  }),
};
