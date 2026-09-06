/**
 * Charts — the data-display primitives for UIUC Bustle, built on
 * `src/lib/spline.ts` and the motion vocabulary in `src/constants/motion.ts`.
 *
 * - RingGauge:   circular gauge that LAPS past 100% instead of clamping
 *                (supersedes `ProgressRing`, re-exported here as an alias)
 * - BarRow:      bar chart of plain Views (never <Rect>) + optional goal line
 * - AreaSpark:   filled sparkline wiped in by an animated <Mask>
 * - RouteRibbon: walk / wait / ride ribbon, proportional by duration
 *
 * ── The SVG rules these all obey ──────────────────────────────────────────
 * On Fabric, `useAnimatedProps` writes straight past react-native-svg's JS
 * prop layer. Three consequences shape every component in this file:
 *
 *  1. Only a subset of props actually animate on an SVG node: `d`,
 *     `strokeDashoffset`, `strokeWidth`, `opacity`, `cx`/`cy`/`r`,
 *     `x`/`y`/`width`/`height`, `fill`, `stroke`, `matrix`. Anything in the
 *     transform family (translate / rotate / scale / origin / points) applies
 *     once and then silently freezes — so the ring here is a `d` that already
 *     starts at 12 o'clock rather than a circle with `rotate(-90)`.
 *  2. ANY prop write on ANY node invalidates the WHOLE enclosing `<Svg>`.
 *     Every independently-animating path therefore gets its own small `<Svg>`;
 *     `RingGauge` stacks three, `RouteRibbon` renders one per leg.
 *  3. Bars need no curves, so `BarRow` uses plain Views and never opens an
 *     `<Svg>` at all. A 7-bar week costs 7 transform writes and zero SVG
 *     invalidations.
 *
 * ── Web and reduced motion take the same door ─────────────────────────────
 * `react-native-web` is a real dependency here and animated SVG props do not
 * work there. Rather than two skip paths, every component computes one
 * `animate` flag (`Platform.OS !== 'web' && !reduceMotion`) and, when it is
 * false, renders the FINISHED state with plain static props — no shared value
 * is read, no `<Mask>` is even mounted. Reduced motion and web get the same
 * fully-drawn chart on the first frame.
 */
import { GLIDE, STAGGER, TIMING } from "@/src/constants/motion";
import { theme } from "@/src/constants/theme";
import { buildSpline, type Point } from "@/src/lib/spline";
import { Bus, Clock, Footprints } from "lucide-react-native";
import React, { useEffect, useId, useMemo } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Mask,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { AnimatedBar, useReducedMotion } from "./motion";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * `useId()` returns strings like ":r3:" — the colons are illegal in an SVG id
 * and break `url(#...)` lookups. Strip them, and keep the result stable so a
 * re-render never re-points a fill at a gradient that no longer exists.
 */
function useSvgId(prefix: string): string {
  const raw = useId();
  return useMemo(() => `${prefix}${raw.replace(/[^a-zA-Z0-9]/g, "")}`, [prefix, raw]);
}

/** Clamp to 0..1 without importing anything. */
function clamp01(v: number): number {
  return v < 0 || !Number.isFinite(v) ? 0 : v > 1 ? 1 : v;
}

/**
 * Coerce a datum to a non-negative finite number.
 *
 * Geometry already guards with `Number.isFinite`, so a NaN value draws a
 * zero-height bar / zero-width leg. The TEXT paths must use the SAME guard or
 * the chart shows a 0 while its label and its VoiceOver summary both read
 * "NaN".
 */
function nonNeg(v: number): number {
  return Number.isFinite(v) ? Math.max(v, 0) : 0;
}

// ── RingGauge ─────────────────────────────────────────────────────────────

export interface RingGaugeProps {
  /**
   * Fraction of the goal, where 1 === 100%. Values above 1 are CLAMPED unless
   * `laps` is set, in which case the overflow draws a second lap.
   */
  progress: number;
  /** Outer diameter, px. */
  size?: number;
  strokeWidth?: number;
  /** Two-stop gradient for the first lap. */
  colors?: readonly [string, string];
  /** Two-stop gradient for the second lap. Must read as a different color. */
  lapColors?: readonly [string, string];
  trackColor?: string;
  /**
   * Keep going past 100% into a second lap instead of clamping. An over-goal
   * week should LOOK over-goal; a ring pinned at full reads identically to a
   * ring that just barely made it.
   */
  laps?: boolean;
  /** Centre content. Overrides `label` / `sublabel`. */
  children?: React.ReactNode;
  /** Convenience centre label when `children` is not given. */
  label?: string;
  sublabel?: string;
  /**
   * Text rendered under the centre content whenever the gauge is lapping.
   * The second lap's color is a status, and status is never color-only.
   * Pass `null` to suppress it (then say "over goal" yourself).
   */
  overLabel?: string | null;
  /** Draw-on duration, ms. */
  duration?: number;
  /** Delay before the draw-on, ms. */
  delay?: number;
  /** Defaults to "<n> percent of goal" (plus ", over goal" when lapping). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Geometry for one full circle starting at 12 o'clock and running clockwise,
 * as an explicit two-arc path.
 *
 * Why not `<Circle transform="rotate(-90 ...)">`: a transform on a node whose
 * `strokeDashoffset` is animated is exactly the combination that freezes on
 * Fabric. Baking the start angle into the path data means the only prop that
 * ever changes is the dash offset, which is on the safe list.
 */
function ringPath(cx: number, cy: number, r: number): string {
  return `M ${cx},${cy - r} A ${r},${r} 0 0 1 ${cx},${cy + r} A ${r},${r} 0 0 1 ${cx},${cy - r}`;
}

interface GaugeArcProps {
  size: number;
  d: string;
  circumference: number;
  /** 0..1 — how much of this lap is filled. */
  fraction: number;
  colors: readonly [string, string];
  strokeWidth: number;
  duration: number;
  delay: number;
  animate: boolean;
  gradientId: string;
}

/**
 * One lap of the gauge, in its OWN `<Svg>`.
 *
 * Two arcs in one `<Svg>` would mean every dash-offset write on the first lap
 * re-renders the second, so the laps are stacked as separate absolutely
 * positioned layers instead. They share geometry, so they line up exactly.
 */
function GaugeArc({
  size,
  d,
  circumference,
  fraction,
  colors,
  strokeWidth,
  duration,
  delay,
  animate,
  gradientId,
}: GaugeArcProps) {
  const p = useSharedValue(animate ? 0 : fraction);

  useEffect(() => {
    cancelAnimation(p);
    if (!animate) {
      p.value = fraction;
      return;
    }
    p.value = withDelay(delay, withTiming(fraction, { duration, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(p);
  }, [p, fraction, animate, delay, duration]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - p.value),
  }));

  const common = {
    d,
    stroke: `url(#${gradientId})`,
    strokeWidth,
    strokeLinecap: "round" as const,
    fill: "none",
    strokeDasharray: `${circumference} ${circumference}`,
  };

  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor={colors[0]} />
          <Stop offset="100%" stopColor={colors[1]} />
        </SvgLinearGradient>
      </Defs>
      {animate ? (
        <AnimatedPath {...common} animatedProps={animatedProps} />
      ) : (
        // Web / reduced motion: the finished frame, drawn with a plain prop.
        <Path {...common} strokeDashoffset={circumference * (1 - fraction)} />
      )}
    </Svg>
  );
}

/**
 * Circular progress gauge with a lap behavior.
 *
 * Supersedes `ProgressRing` (still exported from this module as an alias with
 * an identical prop shape, so existing call sites keep working). The addition
 * is `laps`: past 100% the stroke starts a second time around in a different
 * color instead of pinning at full, so 140% of a step goal reads as 140% at a
 * glance rather than as "done".
 *
 * Only `strokeDashoffset` is ever animated. Nothing here re-lays-out.
 */
export function RingGauge({
  progress,
  size = 120,
  strokeWidth = 10,
  colors = [theme.colors.orangeBright, theme.colors.orange],
  lapColors = [theme.colors.mint, theme.colors.sky],
  trackColor = theme.colors.borderSoft,
  laps = false,
  children,
  label,
  sublabel,
  overLabel = "over goal",
  duration = 900,
  delay = 150,
  accessibilityLabel,
  style,
}: RingGaugeProps) {
  const reduceMotion = useReducedMotion();
  const animate = Platform.OS !== "web" && !reduceMotion;

  const baseId = useSvgId("ring");
  const lapId = `${baseId}lap`;

  const r = Math.max((size - strokeWidth) / 2, 0.01);
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const d = useMemo(() => ringPath(cx, cy, r), [cx, cy, r]);

  const raw = Number.isFinite(progress) ? Math.max(progress, 0) : 0;
  // Two laps is the readable maximum: a third revolution just overdraws the
  // second and the number in the middle stops agreeing with the picture.
  const value = laps ? Math.min(raw, 2) : clamp01(raw);
  const firstLap = Math.min(value, 1);
  const secondLap = laps ? clamp01(value - 1) : 0;
  const lapping = secondLap > 0;

  const pct = Math.round(raw * 100);
  const a11y = accessibilityLabel ?? `${pct} percent of goal${lapping ? ", over goal" : ""}`;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={a11y}
      // `now` must stay inside [min, max]: a lapping gauge reports up to 200,
      // so the range widens with `laps` rather than reporting 140 out of 100.
      accessibilityValue={{ min: 0, max: laps ? 200 : 100, now: Math.min(pct, laps ? 200 : 100), text: `${pct}%` }}
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
    >
      {/* Track: static, so it lives in its own <Svg> and is never re-rendered
          by a dash-offset write on either lap. */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle cx={cx} cy={cy} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      </Svg>

      <GaugeArc
        size={size}
        d={d}
        circumference={circumference}
        fraction={firstLap}
        colors={colors}
        strokeWidth={strokeWidth}
        duration={duration}
        delay={delay}
        animate={animate}
        gradientId={baseId}
      />

      {lapping && (
        <GaugeArc
          size={size}
          d={d}
          circumference={circumference}
          fraction={secondLap}
          colors={lapColors}
          strokeWidth={strokeWidth}
          // The second lap starts only once the first has finished, so the two
          // strokes read as one continuous run rather than two racing rings.
          duration={duration}
          delay={delay + duration}
          animate={animate}
          gradientId={lapId}
        />
      )}

      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {children ?? (
          <>
            {label != null && <Text style={ringStyles.label}>{label}</Text>}
            {sublabel != null && <Text style={ringStyles.sublabel}>{sublabel}</Text>}
          </>
        )}
        {lapping && overLabel != null && <Text style={ringStyles.over}>{overLabel}</Text>}
      </View>
    </View>
  );
}

const ringStyles = StyleSheet.create({
  label: {
    ...theme.text.display,
    fontSize: 26,
    lineHeight: 32,
    color: theme.colors.text,
  },
  sublabel: {
    ...theme.text.caption,
    color: theme.colors.textMuted,
  },
  over: {
    ...theme.text.eyebrow,
    fontSize: 9,
    letterSpacing: 0.8,
    color: theme.colors.successDeep,
    marginTop: 2,
  },
});

/**
 * @deprecated Use `RingGauge`. Kept as a drop-in alias — the prop shape is a
 * superset of the old `ProgressRing`, so existing call sites need no change.
 */
export const ProgressRing = RingGauge;
export type ProgressRingProps = RingGaugeProps;

// ── BarRow ────────────────────────────────────────────────────────────────

export interface BarDatum {
  /** Non-negative. Negative values are treated as 0. */
  value: number;
  /** Axis label under the bar — "Mon", "6a", "22N". */
  label: string;
  /** Overrides `color` for this bar only. */
  color?: string;
  /** Emphasized bar (today, the selected route) — uses `highlightColor`. */
  highlight?: boolean;
  /** Overrides the generated "<label>, <value>" for VoiceOver. */
  accessibilityLabel?: string;
}

export interface BarRowProps {
  data: BarDatum[];
  /** Plot height in px (the label row sits below it). Default 120. */
  height?: number;
  barWidth?: number;
  /** Horizontal space between bars. Default `theme.spacing.sm`. */
  gap?: number;
  color?: string;
  highlightColor?: string;
  /** Two-stop vertical gradient; overrides `color` for every bar. */
  gradient?: readonly [string, string];
  radius?: number;
  /** Draws a reference line, and floors the scale so the line is always inside the frame. */
  goal?: number;
  goalLabel?: string;
  goalColor?: string;
  /**
   * Floor for the y-axis maximum. Without a floor a week of 40-step days
   * renders identically to a week of 12,000-step days: the tallest bar always
   * fills the frame, so the chart silently lies about magnitude. Pass the goal
   * (which also floors the scale on its own) or a known unit maximum.
   */
  minScale?: number;
  /** Show each value under its label. */
  showValues?: boolean;
  /** Format values for the label row and for VoiceOver. */
  formatValue?: (v: number) => string;
  /** Summary read as ONE VoiceOver element. Defaults to a generated series read-out. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Smallest visible bar for a non-zero value, px. Zero stays zero. */
const MIN_BAR_PX = 3;

/**
 * Bar chart of PLAIN VIEWS. There is no `<Svg>` in this component at all.
 *
 * Bars need no curves, and every SVG prop write invalidates the whole enclosing
 * `<Svg>` — so `<Rect>` bars would make a 7-bar week cost 7 full-document
 * invalidations per frame. Views cost one transform each.
 *
 * Each bar grows with `scaleY` + `transformOrigin: 'bottom'` (via `AnimatedBar`),
 * staggered by `min(index, STAGGER.cap) * STAGGER.step` so bar 30 of a long
 * series does not wait a second and a half. The optional goal line draws in
 * afterwards, so it reads as an annotation on a finished chart rather than a
 * fifth racing element.
 */
export function BarRow({
  data,
  height = 120,
  barWidth = 18,
  gap = theme.spacing.sm,
  color = theme.colors.navy,
  highlightColor = theme.colors.orange,
  gradient,
  radius = 6,
  goal,
  goalLabel,
  goalColor = theme.colors.brandInk,
  minScale = 0,
  showValues = false,
  formatValue,
  accessibilityLabel,
  style,
}: BarRowProps) {
  const reduceMotion = useReducedMotion();
  const fmt = formatValue ?? ((v: number) => v.toLocaleString());

  const hasGoal = goal != null && Number.isFinite(goal) && goal > 0;

  const axisMax = useMemo(() => {
    let max = 0;
    for (const d of data) {
      const v = nonNeg(d.value);
      if (v > max) max = v;
    }
    // The floor is the whole point: the tallest bar only touches the top of
    // the frame when it genuinely is the largest value the chart can show.
    return Math.max(max, minScale, hasGoal ? (goal as number) : 0, 1e-6);
  }, [data, minScale, hasGoal, goal]);

  const barsSettled = Math.min(data.length - 1, STAGGER.cap) * STAGGER.step + TIMING.base.duration;

  const a11y = useMemo(() => {
    if (accessibilityLabel) return accessibilityLabel;
    const series = data.map((d) => d.accessibilityLabel ?? `${d.label}, ${fmt(nonNeg(d.value))}`).join("; ");
    return hasGoal ? `${series}. Goal ${fmt(goal as number)}.` : series;
    // `fmt` is intentionally not a dep: an inline formatter would rebuild this
    // string on every render for no change in output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibilityLabel, data, hasGoal, goal]);

  const goalY = hasGoal ? Math.min(((goal as number) / axisMax) * height, height) : 0;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={style}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[barRowStyles.plot, { height, gap }]}>
          {data.map((d, i) => {
            const v = nonNeg(d.value);
            const px = v <= 0 ? 0 : Math.max((v / axisMax) * height, MIN_BAR_PX);
            return (
              <AnimatedBar
                key={`${d.label}-${i}`}
                height={px}
                width={barWidth}
                delay={Math.min(i, STAGGER.cap) * STAGGER.step}
                color={d.color ?? (d.highlight ? highlightColor : color)}
                gradient={d.color || d.highlight ? undefined : gradient}
                radius={radius}
              />
            );
          })}

          {hasGoal && (
            <GoalLine
              bottom={goalY}
              color={goalColor}
              label={goalLabel ?? `Goal ${fmt(goal as number)}`}
              delay={barsSettled}
              animate={!reduceMotion}
            />
          )}
        </View>

        <View style={[barRowStyles.labels, { gap }]}>
          {data.map((d, i) => (
            <View key={`${d.label}-${i}-label`} style={{ width: barWidth, alignItems: "center" }}>
              <Text numberOfLines={1} style={[barRowStyles.tick, d.highlight && barRowStyles.tickOn]}>
                {d.label}
              </Text>
              {showValues && (
                <Text numberOfLines={1} style={barRowStyles.value}>
                  {fmt(nonNeg(d.value))}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

interface GoalLineProps {
  bottom: number;
  color: string;
  label: string;
  delay: number;
  animate: boolean;
}

/**
 * The goal reference line: a plain View that draws in with `scaleX` from the
 * left after the bars have landed. Width/left are never animated — that would
 * re-lay-out the whole plot every frame.
 */
function GoalLine({ bottom, color, label, delay, animate }: GoalLineProps) {
  const t = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    cancelAnimation(t);
    if (!animate) {
      t.value = 1;
      return;
    }
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, TIMING.base));
    return () => cancelAnimation(t);
  }, [t, delay, animate]);

  const lineStyle = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [{ scaleX: Math.max(t.value, 0.0001) }],
  }));

  const labelStyle = useAnimatedStyle(() => ({ opacity: t.value }));

  return (
    <View pointerEvents="none" style={[barRowStyles.goalWrap, { bottom }]}>
      <Animated.View style={[barRowStyles.goalLine, { backgroundColor: color }, lineStyle]} />
      <Animated.Text numberOfLines={1} style={[barRowStyles.goalLabel, { color }, labelStyle]}>
        {label}
      </Animated.Text>
    </View>
  );
}

const barRowStyles = StyleSheet.create({
  plot: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  labels: {
    flexDirection: "row",
    marginTop: theme.spacing.sm,
  },
  tick: {
    ...theme.text.caption,
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textMuted,
  },
  tickOn: {
    ...theme.text.badge,
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.brandInk,
  },
  value: {
    ...theme.text.numeric,
    fontSize: 10,
    lineHeight: 13,
    color: theme.colors.textSecondary,
  },
  goalWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  goalLine: {
    height: StyleSheet.hairlineWidth * 2,
    borderRadius: 1,
    opacity: 0.9,
    transformOrigin: "left",
  },
  goalLabel: {
    ...theme.text.eyebrow,
    fontSize: 9,
    letterSpacing: 0.6,
    textAlign: "right",
    marginTop: 1,
  },
});

// ── AreaSpark ─────────────────────────────────────────────────────────────

export interface AreaSparkProps {
  /** The series, left to right. Fewer than 2 points renders nothing. */
  values: number[];
  width: number;
  height: number;
  /** Stroke color for the curve. */
  color?: string;
  /** Fill gradient, top stop to bottom stop. The bottom stop fades to nothing. */
  fill?: readonly [string, string];
  strokeWidth?: number;
  /** Wipe-in duration, ms. Default `GLIDE.chart`. */
  duration?: number;
  delay?: number;
  /** Dot resting on the final sample. */
  showEndDot?: boolean;
  dotColor?: string;
  /** Force the y-domain. Defaults to the data's own min/max. */
  min?: number;
  max?: number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Filled sparkline from `buildSpline`, wiped in left-to-right by an animated
 * `<Mask>` rect.
 *
 * The gradient and both paths are built ONCE and never touched again. Two
 * tempting alternatives are pathological on this stack and are deliberately
 * not used:
 *
 *   - Animating `<Stop>` props re-resolves the gradient (and therefore every
 *     shape painted with it) on every frame.
 *   - Animating the area's `d` rebuilds and re-parses a multi-kilobyte path
 *     string 60 times a second, on the UI thread, for a shape whose outline is
 *     not actually changing.
 *
 * A mask rect's `width` is on the safe animated-prop list and moves one number.
 * `buildSpline` runs on the JS thread inside `useMemo`, per its contract.
 */
export function AreaSpark({
  values,
  width,
  height,
  color = theme.colors.orange,
  fill = [theme.colors.orangeBright, theme.colors.orangeSoft],
  strokeWidth = 2,
  duration = GLIDE.chart,
  delay = 0,
  showEndDot = true,
  dotColor,
  min,
  max,
  accessibilityLabel,
  style,
}: AreaSparkProps) {
  const reduceMotion = useReducedMotion();
  const animate = Platform.OS !== "web" && !reduceMotion;

  const fillId = useSvgId("spark");
  const maskId = `${fillId}mask`;

  const geometry = useMemo(() => {
    const n = values.length;
    if (n < 2 || !(width > 0) || !(height > 0)) return null;

    const pad = strokeWidth / 2 + 1;
    const innerW = Math.max(width - pad * 2, 1);
    const innerH = Math.max(height - pad * 2, 1);

    let lo = min;
    let hi = max;
    if (lo == null || hi == null) {
      let dataLo = Infinity;
      let dataHi = -Infinity;
      for (const v of values) {
        if (!Number.isFinite(v)) continue;
        if (v < dataLo) dataLo = v;
        if (v > dataHi) dataHi = v;
      }
      if (!Number.isFinite(dataLo)) return null;
      lo = lo ?? dataLo;
      hi = hi ?? dataHi;
    }
    // A flat series has zero span; centre it instead of dividing by zero.
    const span = hi - lo;
    const usableSpan = span > 1e-9 ? span : 1;
    const flat = span <= 1e-9;

    const pts: Point[] = values.map((v, i) => {
      const safe = Number.isFinite(v) ? v : (lo as number);
      const t = flat ? 0.5 : (safe - (lo as number)) / usableSpan;
      return { x: pad + (i / (n - 1)) * innerW, y: pad + (1 - t) * innerH };
    });

    // Close the fill to the bottom edge of the box, not to y=0.
    const spline = buildSpline(pts, { baseline: height });
    const last = pts[n - 1];
    return { spline, last };
  }, [values, width, height, strokeWidth, min, max]);

  const t = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    cancelAnimation(t);
    if (!animate || !geometry) {
      t.value = 1;
      return;
    }
    t.value = 0;
    t.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(t);
  }, [t, animate, geometry, delay, duration]);

  const wipeProps = useAnimatedProps(() => ({ width: width * t.value }));

  if (!geometry) return null;

  const { spline, last } = geometry;

  const paths = (
    <>
      <Path d={spline.area} fill={`url(#${fillId})`} />
      <Path
        d={spline.d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {showEndDot && (
        <Circle cx={last.x} cy={last.y} r={strokeWidth + 1.5} fill={dotColor ?? color} />
      )}
    </>
  );

  return (
    <View
      accessible={accessibilityLabel != null}
      accessibilityRole={accessibilityLabel != null ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <Svg width={width} height={height} pointerEvents="none">
        <Defs>
          <SvgLinearGradient
            id={fillId}
            x1="0"
            y1="0"
            x2="0"
            y2={height}
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={fill[0]} stopOpacity={0.55} />
            <Stop offset="1" stopColor={fill[1]} stopOpacity={0} />
          </SvgLinearGradient>
          {animate && (
            <Mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
              <AnimatedRect x={0} y={0} height={height} fill="#ffffff" animatedProps={wipeProps} />
            </Mask>
          )}
        </Defs>
        {/* Web and reduced motion never mount the mask at all: the finished
            chart is simply the paths, unmasked, on the first frame. */}
        {animate ? <G mask={`url(#${maskId})`}>{paths}</G> : <G>{paths}</G>}
      </Svg>
    </View>
  );
}

// ── RouteRibbon ───────────────────────────────────────────────────────────

export type RibbonLegKind = "walk" | "wait" | "ride";

export interface RibbonLeg {
  kind: RibbonLegKind;
  /** Duration in minutes. Legs are sized by their share of the total. */
  minutes: number;
  /** Defaults to "<n> min <kind>" — "6 min walk". */
  label?: string;
  /** Defaults to the icon for `kind`. */
  icon?: React.ReactNode;
  /** Overrides the kind's theme color. */
  color?: string;
}

export interface RouteRibbonProps {
  legs: RibbonLeg[];
  /** Total ribbon width in px. Required: leg widths are computed, not measured. */
  width: number;
  /** Resting stroke width. The current leg breathes to 1.15x this. */
  strokeWidth?: number;
  /** Index of the leg happening right now. It breathes; -1 or omitted = none. */
  currentIndex?: number;
  /** Total draw-on time across ALL legs, ms. Default `GLIDE.route`. */
  duration?: number;
  /** Space between legs, px. */
  gap?: number;
  /** Render the icon + label row under the ribbon. */
  showLabels?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Leg colors come from theme tokens — never a literal hex at a call site. */
const RIBBON_COLORS: Record<RibbonLegKind, string> = {
  walk: theme.colors.navyLight,
  wait: theme.colors.gold,
  ride: theme.colors.orange,
};

const RIBBON_NOUN: Record<RibbonLegKind, string> = {
  walk: "walk",
  wait: "wait",
  ride: "ride",
};

/** How wide a leg cell must be before its text label is worth rendering. */
const LABEL_MIN_WIDTH = 56;
const BREATHE_SCALE = 1.15;
const BREATHE_MS = 1100;

function legIcon(kind: RibbonLegKind, color: string, size: number): React.ReactNode {
  const props = { size, color, strokeWidth: 2.2 };
  switch (kind) {
    case "walk":
      return <Footprints {...props} />;
    case "wait":
      return <Clock {...props} />;
    case "ride":
      return <Bus {...props} />;
  }
}

interface RibbonSegmentProps {
  width: number;
  color: string;
  strokeWidth: number;
  /** Draw-on duration for this leg, ms. */
  duration: number;
  /** Delay before this leg starts drawing, ms. */
  delay: number;
  /** This is the leg happening now — it breathes once the ribbon is drawn. */
  current: boolean;
  /** Time after mount at which the whole ribbon has finished drawing, ms. */
  drawnAt: number;
  animate: boolean;
}

/**
 * One leg, in its OWN `<Svg>`.
 *
 * This is the rule that shapes the component: four legs in one `<Svg>` would
 * mean the breathing leg's `strokeWidth` write re-renders the other three,
 * every frame, forever. Four small documents means the breath touches one.
 */
function RibbonSegment({
  width,
  color,
  strokeWidth,
  duration,
  delay,
  current,
  drawnAt,
  animate,
}: RibbonSegmentProps) {
  // Reserve room for the breathing stroke's round caps so a widening leg is
  // never clipped by its own viewport.
  const maxStroke = strokeWidth * BREATHE_SCALE;
  const cap = maxStroke / 2;
  const svgH = maxStroke + 2;
  const cy = svgH / 2;
  const len = Math.max(width - cap * 2, 0.01);
  const d = `M ${cap},${cy} L ${cap + len},${cy}`;

  const draw = useSharedValue(animate ? 0 : 1);
  const breath = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(draw);
    if (!animate) {
      draw.value = 1;
      return;
    }
    draw.value = 0;
    draw.value = withDelay(delay, withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) }));
    return () => cancelAnimation(draw);
  }, [draw, animate, delay, duration]);

  useEffect(() => {
    cancelAnimation(breath);
    // A looping animation must never START under reduced motion, and it must
    // always be cancelled on unmount — an uncancelled withRepeat(-1) runs
    // against a detached view for the life of the app.
    if (!animate || !current) {
      breath.value = 1;
      return;
    }
    breath.value = withDelay(
      drawnAt,
      withRepeat(
        withSequence(
          withTiming(BREATHE_SCALE, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: BREATHE_MS, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      )
    );
    return () => cancelAnimation(breath);
  }, [breath, animate, current, drawnAt]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: len * (1 - draw.value),
    strokeWidth: strokeWidth * breath.value,
  }));

  const common = {
    d,
    stroke: color,
    strokeLinecap: "round" as const,
    fill: "none",
    strokeDasharray: `${len} ${len}`,
  };

  return (
    <Svg width={width} height={svgH} pointerEvents="none">
      {animate ? (
        <AnimatedPath {...common} animatedProps={animatedProps} />
      ) : (
        <Path {...common} strokeWidth={strokeWidth} strokeDashoffset={0} />
      )}
    </Svg>
  );
}

/**
 * A walk / wait / ride ribbon, proportional by duration.
 *
 * The legs draw in sequence at a CONSTANT speed: each leg's draw time is its
 * share of the total, so the ribbon fills like a progress bar rather than four
 * segments that each take the same time regardless of length. The current leg
 * then breathes (strokeWidth 1.0 -> 1.15) once the whole ribbon is drawn.
 *
 * Colors come from theme tokens, and every leg carries an icon and a text
 * label — the color alone never encodes which leg is which, or which is now.
 */
export function RouteRibbon({
  legs,
  width,
  strokeWidth = 10,
  currentIndex = -1,
  duration = GLIDE.route,
  gap = 4,
  showLabels = true,
  accessibilityLabel,
  style,
}: RouteRibbonProps) {
  const reduceMotion = useReducedMotion();
  const animate = Platform.OS !== "web" && !reduceMotion;

  const layout = useMemo(() => {
    const n = legs.length;
    if (n === 0 || !(width > 0)) return null;
    const usable = Math.max(width - gap * (n - 1), 1);
    let total = 0;
    for (const l of legs) total += nonNeg(l.minutes);
    // All-zero durations still deserve a ribbon: fall back to equal shares.
    const shares = legs.map((l) => {
      const m = nonNeg(l.minutes);
      return total > 0 ? m / total : 1 / n;
    });
    return { widths: shares.map((s) => s * usable), shares };
  }, [legs, width, gap]);

  const a11y = useMemo(() => {
    if (accessibilityLabel) return accessibilityLabel;
    const parts = legs.map((l, i) => {
      const base = l.label ?? `${Math.round(nonNeg(l.minutes))} minute ${RIBBON_NOUN[l.kind]}`;
      return i === currentIndex ? `${base}, now` : base;
    });
    return `Trip: ${parts.join(", then ")}`;
  }, [accessibilityLabel, legs, currentIndex]);

  if (!layout) return null;

  const { widths, shares } = layout;
  // Cumulative share === when this leg starts, in a constant-speed draw.
  let cumulative = 0;
  const delays = shares.map((s) => {
    const start = cumulative * duration;
    cumulative += s;
    return start;
  });

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11y}
      style={style}
    >
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[ribbonStyles.track, { gap }]}>
          {legs.map((leg, i) => (
            <RibbonSegment
              key={`${leg.kind}-${i}`}
              width={widths[i]}
              color={leg.color ?? RIBBON_COLORS[leg.kind]}
              strokeWidth={strokeWidth}
              duration={Math.max(shares[i] * duration, TIMING.fast.duration)}
              delay={delays[i]}
              current={i === currentIndex}
              drawnAt={duration}
              animate={animate}
            />
          ))}
        </View>

        {showLabels && (
          <View style={[ribbonStyles.legend, { gap }]}>
            {legs.map((leg, i) => {
              const tint = leg.color ?? RIBBON_COLORS[leg.kind];
              const wide = widths[i] >= LABEL_MIN_WIDTH;
              const isNow = i === currentIndex;
              const text = leg.label ?? `${Math.round(nonNeg(leg.minutes))} min ${RIBBON_NOUN[leg.kind]}`;
              // A narrow leg normally drops to icon-only, but the CURRENT leg
              // must always keep a text marker. The breath is the only other
              // "now" signal and it is off under reduced motion and on web —
              // and the current leg is usually the SHORT one (a 3 min wait in
              // a 20 min trip is ~47px wide), so the common case is exactly
              // the one that would render with nothing marking it at all.
              const legendText = wide ? (isNow ? `${text} · now` : text) : isNow ? "now" : null;
              return (
                <View key={`${leg.kind}-${i}-legend`} style={[ribbonStyles.legendCell, { width: widths[i] }]}>
                  {leg.icon ?? legIcon(leg.kind, tint, 12)}
                  {legendText != null && (
                    <Text numberOfLines={1} style={[ribbonStyles.legendText, isNow && ribbonStyles.legendNow]}>
                      {legendText}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

const ribbonStyles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
  },
  legend: {
    flexDirection: "row",
    marginTop: theme.spacing.xs,
  },
  legendCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  legendText: {
    ...theme.text.caption,
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textMuted,
    flexShrink: 1,
  } as TextStyle,
  legendNow: {
    ...theme.text.badge,
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.text,
  } as TextStyle,
});
