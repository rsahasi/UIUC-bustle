import { SPRING } from "@/src/constants/motion";
import { theme } from "@/src/constants/theme";
import { PulseView } from "@/src/components/ui/motion";
import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

interface BadgeProps {
  label: string;
  variant?: "live" | "route" | "info" | "delayed" | "early";
  size?: "sm" | "md";
}

/** How far the chip compresses before springing back on a state change. */
const POP_FROM = 0.88;

/**
 * Status chip. Status is never color-only: every variant carries its label
 * text, and "live" pairs its breathing dot with the word itself.
 *
 * A change of variant or label springs the chip back to rest with
 * `SPRING.press` — the same physics a finger gets — so a row that flips from
 * "Scheduled" to "+3m late" reads as one object changing rather than two
 * chips swapping. `SPRING.press` carries `ReduceMotion.System`, so the pop is
 * absent (not merely faster) when the OS asks for reduced motion.
 */
export function Badge({ label, variant = "route", size = "md" }: BadgeProps) {
  const s = styles[variant];
  const fontSize = size === "sm" ? 10 : 12;
  const padH = size === "sm" ? 7 : 9;
  const padV = size === "sm" ? 2 : 3;

  const scale = useSharedValue(1);
  const mounted = useRef(false);

  useEffect(() => {
    // No entrance pop: the chip's first appearance is the list's entrance to
    // animate, not the chip's.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // Both writes land in the same frame, so the spring starts from POP_FROM
    // and 0.88 is never painted on its own.
    scale.value = POP_FROM;
    scale.value = withSpring(1, SPRING.press);
  }, [variant, label, scale]);

  useEffect(() => () => cancelAnimation(scale), [scale]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[s.container, { paddingHorizontal: padH, paddingVertical: padV }, popStyle]}
      accessible
      accessibilityLabel={variant === "live" ? `${label}, real-time` : label}
    >
      {variant === "live" && (
        <PulseView minOpacity={0.4} maxScale={1.25} style={baseStyles.liveDot} />
      )}
      <Text style={[s.label, { fontSize, fontFamily: "DMSans_600SemiBold", letterSpacing: 0.3, fontVariant: ["tabular-nums"] }]}>
        {label}
      </Text>
    </Animated.View>
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
    container: { ...row, backgroundColor: theme.colors.ctaEnd, borderRadius: theme.radius.pill, ...theme.shadows.glowOrange },
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
    container: { ...row, backgroundColor: theme.colors.errorDeep, borderRadius: theme.radius.pill },
    label: { color: "#fff" },
  }),
  early: StyleSheet.create({
    container: { ...row, backgroundColor: theme.colors.successDeep, borderRadius: theme.radius.pill },
    label: { color: "#fff" },
  }),
};
