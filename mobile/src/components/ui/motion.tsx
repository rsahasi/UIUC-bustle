/**
 * Motion primitives — the shared animation vocabulary for UIUC Bustle.
 *
 * - PressableScale: springy scale-down on press (+ optional haptic tick)
 * - FadeInView:     fade + slide entrance, staggerable via `delay`
 * - PulseView:      looping soft pulse for "live" indicators
 * - FloatingView:   slow vertical drift for decorative elements
 * - Skeleton:       shimmer loading placeholder
 * - ProgressRing:   animated SVG progress circle
 * - AnimatedBar:    grow-in bar for charts
 */
import { theme } from "@/src/constants/theme";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ── PressableScale ────────────────────────────────────────────────────────

interface PressableScaleProps extends PressableProps {
  /** How far to scale down while pressed. Default 0.96. */
  scaleTo?: number;
  /** Fire a light haptic tick on press-in. Default true. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Pressable that springs down on touch — makes every tap feel alive. */
export function PressableScale({ scaleTo = 0.96, haptic = true, style, children, onPressIn, onPressOut, ...rest }: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, theme.motion.spring);
        if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, theme.motion.springBouncy);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

// ── FadeInView ────────────────────────────────────────────────────────────

interface FadeInViewProps {
  /** Stagger offset in ms. */
  delay?: number;
  /** Slide-up distance in px. Default 14. */
  dy?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Fade + slide entrance. Stagger lists by passing `delay={index * 60}`. */
export function FadeInView({ delay = 0, dy = 14, duration = theme.motion.slow, style, children }: FadeInViewProps) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
  }, [progress, delay, duration]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * dy }],
  }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ── PulseView ─────────────────────────────────────────────────────────────

interface PulseViewProps {
  /** Pulse opacity floor. Default 0.45. */
  minOpacity?: number;
  /** Pulse scale ceiling. Default 1 (opacity-only). */
  maxScale?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Looping soft pulse — for Live badges, status dots, anything "breathing". */
export function PulseView({ minOpacity = 0.45, maxScale = 1, duration = 900, style, children }: PulseViewProps) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
  }, [t, duration]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - t.value * (1 - minOpacity),
    transform: [{ scale: 1 + t.value * (maxScale - 1) }],
  }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ── FloatingView ──────────────────────────────────────────────────────────

interface FloatingViewProps {
  /** Drift distance in px. Default 8. */
  distance?: number;
  duration?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/** Slow vertical drift — decorative blobs, icons, empty-state art. */
export function FloatingView({ distance = 8, duration = 2600, delay = 0, style, children }: FloatingViewProps) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })
        ),
        -1
      )
    );
  }, [t, duration, delay]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -t.value * distance }],
  }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

// ── Skeleton ──────────────────────────────────────────────────────────────

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Shimmering loading placeholder — use instead of spinners for content. */
export function Skeleton({ width = "100%", height = 16, radius = theme.radius.md, style }: SkeletonProps) {
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1);
  }, [t]);
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -measuredWidth + t.value * measuredWidth * 2 }],
  }));
  return (
    <View
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.colors.borderSoft, overflow: "hidden" }, style]}
      onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, shimmerStyle]}>
        <LinearGradient
          colors={["transparent", "rgba(255,255,255,0.75)", "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

// ── ProgressRing ──────────────────────────────────────────────────────────

interface ProgressRingProps {
  /** 0..1 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Two-stop gradient for the progress stroke. */
  colors?: readonly [string, string];
  trackColor?: string;
  children?: React.ReactNode;
}

/** Animated circular progress with gradient stroke. Center children overlay. */
export function ProgressRing({
  progress,
  size = 120,
  strokeWidth = 10,
  colors = [theme.colors.orangeBright, theme.colors.orange],
  trackColor = theme.colors.borderSoft,
  children,
}: ProgressRingProps) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(150, withTiming(Math.min(Math.max(progress, 0), 1), { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [p, progress]);
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - p.value),
  }));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgLinearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors[0]} />
            <Stop offset="100%" stopColor={colors[1]} />
          </SvgLinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>{children}</View>
    </View>
  );
}

// ── AnimatedBar ───────────────────────────────────────────────────────────

interface AnimatedBarProps {
  /** Final height in px. */
  height: number;
  delay?: number;
  width?: number;
  color?: string;
  /** Optional gradient overrides `color`. */
  gradient?: readonly [string, string];
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Chart bar that grows in from the baseline. Stagger with `delay`. */
export function AnimatedBar({ height, delay = 0, width = 18, color = theme.colors.navy, gradient, radius = 6, style }: AnimatedBarProps) {
  const h = useSharedValue(0);
  useEffect(() => {
    h.value = withDelay(delay, withSpring(Math.max(height, 0), { damping: 18, stiffness: 160 }));
  }, [h, height, delay]);
  const animatedStyle = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <Animated.View style={[{ width, borderRadius: radius, overflow: "hidden" }, !gradient && { backgroundColor: color }, animatedStyle, style]}>
      {gradient && (
        <LinearGradient colors={[gradient[0], gradient[1]]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
    </Animated.View>
  );
}
