/**
 * Motion primitives — the shared animation vocabulary for UIUC Bustle.
 *
 * - useReducedMotion:  live system reduce-motion flag (looping primitives obey it)
 * - PressableScale:    springy scale-down on press (+ optional haptic tick)
 * - FadeInView:        fade + slide entrance, staggerable via `delay`
 * - PulseView:         looping soft pulse for "live" indicators
 * - FloatingView:      slow vertical drift for decorative elements
 * - Skeleton:          shimmer loading placeholder
 * - ProgressRing:      animated SVG progress circle
 * - AnimatedBar:       grow-in bar for charts
 * - TickingCountdown:  live mm / m:ss countdown on a shared 1s ticker (tabular-nums)
 * - AnimatedNumber:    rolling digit swaps for in-place numeric updates
 * - RouteProgress:     SVG polyline that draws itself, with optional traveling dot
 * - CelebrationBurst:  one-shot radial particle burst for arrivals
 */
import { theme } from "@/src/constants/theme";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  FadeOutUp,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Polyline, Stop } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

// ── useReducedMotion ──────────────────────────────────────────────────────

/**
 * Live "Reduce Motion" system setting. Looping primitives in this file obey
 * it internally; use it yourself before starting any decorative loop.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

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
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration, easing: Easing.inOut(Easing.quad) })
      ),
      -1
    );
    return () => cancelAnimation(t);
  }, [t, duration, reduceMotion]);
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
  const reduceMotion = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
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
    return () => cancelAnimation(t);
  }, [t, duration, delay, reduceMotion]);
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
  const reduceMotion = useReducedMotion();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(t);
      t.value = 0.5; // static mid-sheen instead of looping shimmer
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1);
    return () => cancelAnimation(t);
  }, [t, reduceMotion]);
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

// ── TickingCountdown ──────────────────────────────────────────────────────

// One shared 1s heartbeat for every countdown on screen — a departure board
// ticks in unison, and N countdowns cost one interval, not N.
type TickListener = () => void;
const tickListeners = new Set<TickListener>();
let tickHandle: ReturnType<typeof setInterval> | null = null;

function subscribeToTick(listener: TickListener): () => void {
  tickListeners.add(listener);
  if (tickHandle == null) {
    tickHandle = setInterval(() => {
      tickListeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickHandle != null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  };
}

/** Format a remaining span (ms) as departure-board text. */
export function formatCountdown(remainingMs: number, nowLabel = "Now"): string {
  if (remainingMs <= 500) return nowLabel;
  const totalSeconds = Math.round(remainingMs / 1000);
  if (totalSeconds >= 90) return `${Math.round(totalSeconds / 60)} min`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TickingCountdownProps {
  /** Target time as epoch ms (or ISO-parsed). Live-ticks on the shared 1s heartbeat. */
  targetMs?: number | null;
  /** Static minutes fallback when no target time is known. */
  minutes?: number | null;
  /** Label when the countdown reaches zero. Default "Now". */
  nowLabel?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}

/**
 * Live countdown text. Below 90s it switches from "7 min" to "1:23" and ticks
 * every second on a single shared interval; cleans up on unmount. Digits are
 * tabular so the row never jitters.
 */
export function TickingCountdown({ targetMs, minutes, nowLabel = "Now", style, numberOfLines = 1 }: TickingCountdownProps) {
  const [, forceTick] = useState(0);
  const live = targetMs != null && Number.isFinite(targetMs);
  useEffect(() => {
    if (!live) return;
    return subscribeToTick(() => forceTick((n) => (n + 1) % 1_000_000));
  }, [live]);

  let text: string;
  if (live) {
    text = formatCountdown((targetMs as number) - Date.now(), nowLabel);
  } else if (minutes != null && Number.isFinite(minutes)) {
    text = minutes <= 0 ? nowLabel : `${Math.round(minutes)} min`;
  } else {
    text = "—";
  }

  return (
    <Text style={[{ fontVariant: ["tabular-nums"] }, style]} numberOfLines={numberOfLines}>
      {text}
    </Text>
  );
}

// ── AnimatedNumber ────────────────────────────────────────────────────────

interface AnimatedNumberProps {
  /** The value to display; each change rolls the old value out and the new one in. */
  value: number | string;
  style?: StyleProp<TextStyle>;
  duration?: number;
  accessibilityLabel?: string;
}

/**
 * Numeric text that rolls on change (old value slides up/out, new slides in).
 * Tabular-nums built in; static under reduced motion.
 */
export function AnimatedNumber({ value, style, duration = theme.motion.fast, accessibilityLabel }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const key = String(value);
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? key}>
      <Animated.Text
        key={key}
        entering={reduceMotion ? undefined : FadeInDown.duration(duration).easing(Easing.out(Easing.cubic))}
        exiting={reduceMotion ? undefined : FadeOutUp.duration(duration).easing(Easing.in(Easing.cubic))}
        style={[{ fontVariant: ["tabular-nums"] }, style]}
      >
        {key}
      </Animated.Text>
    </View>
  );
}

// ── RouteProgress ─────────────────────────────────────────────────────────

export interface RoutePoint {
  x: number;
  y: number;
}

interface RouteProgressProps {
  /** Polyline vertices in local SVG coordinates. */
  points: RoutePoint[];
  color?: string;
  strokeWidth?: number;
  /** Draw-on duration in ms. */
  duration?: number;
  /** Restart the draw-on (and dot travel) forever. */
  loop?: boolean;
  /** Render a dot that travels the path as it draws. */
  showDot?: boolean;
  dotColor?: string;
  dotRadius?: number;
  /** Faint full-length track behind the drawing line. */
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * An SVG polyline that draws itself (strokeDashoffset), with an optional dot
 * traveling the path — a bus gliding along its route. Under reduced motion the
 * line renders fully drawn with the dot resting at the end.
 */
export function RouteProgress({
  points,
  color = theme.colors.orange,
  strokeWidth = 3,
  duration = 1400,
  loop = false,
  showDot = true,
  dotColor = theme.colors.orange,
  dotRadius = 5,
  trackColor,
  style,
}: RouteProgressProps) {
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(0);

  const geometry = useMemo(() => {
    const xs = points.map((pt) => pt.x);
    const ys = points.map((pt) => pt.y);
    const pad = Math.max(strokeWidth, dotRadius) + 2;
    const minX = Math.min(...xs, 0);
    const minY = Math.min(...ys, 0);
    const width = Math.max(...xs, 1) - Math.min(minX, 0) + pad * 2;
    const height = Math.max(...ys, 1) - Math.min(minY, 0) + pad * 2;
    const shifted = points.map((pt) => ({ x: pt.x - minX + pad, y: pt.y - minY + pad }));
    const svgPoints = shifted.map((pt) => `${pt.x},${pt.y}`).join(" ");
    // Cumulative segment lengths for dot interpolation (plain arrays — worklet-safe).
    const cumulative: number[] = [0];
    let total = 0;
    for (let i = 1; i < shifted.length; i++) {
      total += Math.hypot(shifted[i].x - shifted[i - 1].x, shifted[i].y - shifted[i - 1].y);
      cumulative.push(total);
    }
    return {
      width,
      height,
      svgPoints,
      xsShifted: shifted.map((pt) => pt.x),
      ysShifted: shifted.map((pt) => pt.y),
      cumulative,
      total: Math.max(total, 1e-6),
    };
  }, [points, strokeWidth, dotRadius]);

  useEffect(() => {
    cancelAnimation(p);
    if (reduceMotion) {
      p.value = 1;
      return;
    }
    p.value = 0;
    const draw = withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) });
    p.value = loop ? withRepeat(withSequence(draw, withDelay(400, withTiming(0, { duration: 0 }))), -1) : draw;
    return () => cancelAnimation(p);
  }, [p, duration, loop, reduceMotion, geometry.total]);

  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: geometry.total * (1 - p.value),
  }));

  const dotProps = useAnimatedProps(() => {
    const dist = geometry.total * p.value;
    const cum = geometry.cumulative;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < dist) i++;
    const segLen = Math.max(cum[i] - cum[i - 1], 1e-6);
    const tt = Math.min(Math.max((dist - cum[i - 1]) / segLen, 0), 1);
    const cx = geometry.xsShifted[i - 1] + (geometry.xsShifted[i] - geometry.xsShifted[i - 1]) * tt;
    const cy = geometry.ysShifted[i - 1] + (geometry.ysShifted[i] - geometry.ysShifted[i - 1]) * tt;
    return { cx, cy, opacity: p.value > 0.01 ? 1 : 0 };
  });

  if (points.length < 2) return null;

  return (
    <View style={style}>
      <Svg width={geometry.width} height={geometry.height}>
        {trackColor && (
          <Polyline
            points={geometry.svgPoints}
            stroke={trackColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
        <AnimatedPolyline
          points={geometry.svgPoints}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={`${geometry.total} ${geometry.total}`}
          animatedProps={lineProps}
        />
        {showDot && <AnimatedCircle r={dotRadius} fill={dotColor} animatedProps={dotProps} />}
      </Svg>
    </View>
  );
}

// ── CelebrationBurst ──────────────────────────────────────────────────────

const BURST_COLORS = [theme.colors.orange, theme.colors.orangeBright, theme.colors.navy, theme.colors.sky, theme.colors.gold];

interface BurstParticleConfig {
  angle: number;
  distance: number;
  size: number;
  color: string;
  spin: number;
}

function BurstParticle({ progress, config }: { progress: SharedValue<number>; config: BurstParticleConfig }) {
  const animatedStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const eased = 1 - (1 - t) * (1 - t); // ease-out
    return {
      opacity: t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3,
      transform: [
        { translateX: Math.cos(config.angle) * config.distance * eased },
        { translateY: Math.sin(config.angle) * config.distance * eased - 10 * t },
        { rotate: `${config.spin * t}deg` },
        { scale: 1 - 0.4 * t },
      ],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: config.size,
          height: config.size,
          borderRadius: config.size / 3,
          backgroundColor: config.color,
        },
        animatedStyle,
      ]}
    />
  );
}

interface CelebrationBurstProps {
  /** Particle count. Default 16. */
  count?: number;
  /** Max travel radius in px. Default 96. */
  radius?: number;
  duration?: number;
  /** Called after the burst finishes and unmounts its particles. */
  onDone?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * One-shot radial burst of orange/navy/sky confetti for walk-arrival moments.
 * Fires on mount, cleans itself up when done, and no-ops under reduced motion.
 * Position it absolutely over the celebrating element.
 */
export function CelebrationBurst({ count = 16, radius = 96, duration = 750, onDone, style }: CelebrationBurstProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [alive, setAlive] = useState(true);

  const particles = useMemo<BurstParticleConfig[]>(
    () =>
      Array.from({ length: count }, (_, i) => {
        const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1; // deterministic per index
        return {
          angle: (i / count) * Math.PI * 2 + jitter * 0.5,
          distance: radius * (0.55 + Math.abs(jitter) * 0.45),
          size: 5 + Math.abs(jitter) * 5,
          color: BURST_COLORS[i % BURST_COLORS.length],
          spin: 120 + Math.abs(jitter) * 240,
        };
      }),
    [count, radius]
  );

  useEffect(() => {
    if (reduceMotion) {
      setAlive(false);
      onDone?.();
      return;
    }
    const finish = () => {
      setAlive(false);
      onDone?.();
    };
    progress.value = withTiming(1, { duration, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(finish)();
    });
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!alive) return null;

  return (
    <View pointerEvents="none" style={[{ alignItems: "center", justifyContent: "center" }, style]}>
      {particles.map((config, i) => (
        <BurstParticle key={i} progress={progress} config={config} />
      ))}
    </View>
  );
}
