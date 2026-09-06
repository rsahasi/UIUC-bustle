/**
 * CollapsingHeader — a scroll-driven header that animates TRANSFORMS ONLY.
 *
 * The header is absolutely positioned with a FIXED `maxHeight` and never
 * changes its `height`. Animating height (or top/left/width) re-lays-out every
 * child on every frame; a hero with a gradient, a title and three stat chips
 * turns into a per-frame layout pass and the whole screen judders. Instead the
 * box stays the same size forever and we move it with `translateY` and fade its
 * two layers with `opacity`.
 *
 * ── Anatomy ───────────────────────────────────────────────────────────────
 *
 *   ┌─ header box (absolute, top:0, height = maxHeight) ─────────┐
 *   │  background layer   (extends maxHeight px ABOVE the box)   │
 *   │  hero layer         (parallax + pull-down scale + fade)    │
 *   │  compact layer      (bottom:0, height = minHeight, fade)   │
 *   │  hairline border    (bottom:0, fades in once collapsed)    │
 *   └────────────────────────────────────────────────────────────┘
 *
 * `distance = maxHeight - minHeight` is the whole collapse budget. At
 * `y >= distance` the box has slid up by exactly `distance`, so the only strip
 * still on screen is its bottom `minHeight` — which is where the compact bar
 * lives.
 *
 * ── Why the background layer overhangs ────────────────────────────────────
 * On iOS the scroll view rubber-bands past the top: `y` goes negative and the
 * CONTENT slides down. If the header stayed nailed to `top: 0` a bare strip of
 * scroll-view background would open up between the header's bottom edge and
 * the content. So the box also *follows* the overscroll downward — which in
 * turn would open a strip ABOVE it. The background layer is anchored to the
 * box's bottom and extends `maxHeight` px past its top, so that strip is
 * already painted. That overhang is also the ceiling on how far the box
 * follows (`followRange`) — following further than there is paint would just
 * move the seam instead of closing it. The header therefore has
 * `overflow: "visible"`; anything that slides above the box is off-screen.
 *
 * ── Why every interpolate clamps BOTH ends ────────────────────────────────
 * `interpolate` extrapolates linearly by default. With rubber-band scrolling
 * `y` regularly runs to -180 at the top and past the content height at the
 * bottom, so an unclamped collapse ramp INVERTS: pull down and the header
 * slides *up* and off the screen, opacity goes negative, the compact bar
 * flickers. `Extrapolation.CLAMP` passed as the 4th arg clamps left and right,
 * which is why the pull-down effect is expressed as its own clamped ramp on
 * `[-pullRange, 0]` and summed, rather than by widening one range.
 *
 * ── Reduced motion ────────────────────────────────────────────────────────
 * Parallax and the pull-down zoom are exactly the vestibular triggers Reduce
 * Motion exists to suppress, so both collapse to identity when the live
 * `useReducedMotion` flag is set. The header still tracks the scroll — that is
 * direct manipulation, not decoration, and removing it would just leave a
 * broken layout.
 */
import { theme } from "@/src/constants/theme";
import { useReducedMotion, useScrollProgress, type ScrollProgress } from "@/src/components/ui/motion";
import React, { useMemo, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

/** Cross-fade window, px of collapse, over which the compact bar takes over. */
const FADE_WINDOW = 24;
/** Px of scroll past full collapse over which the hairline border fades in. */
const BORDER_FADE = 8;
/** Hero parallax factor. Negative: the hero drifts up faster than the box. */
const PARALLAX = -0.4;

// ── Types ─────────────────────────────────────────────────────────────────

export interface CollapsingHeaderRenderArgs {
  /** 0..1 across the collapse. Clamped; safe to read on the UI thread. */
  progress: SharedValue<number>;
  /** Raw scroll offset, px. Negative while rubber-banding at the top. */
  y: SharedValue<number>;
  /** JS-side flag, flipped at the cross-fade midpoint. Use for a11y/pointers. */
  collapsed: boolean;
  /** Px of travel between the expanded and collapsed states. */
  distance: number;
  maxHeight: number;
  minHeight: number;
}

/** Everything a caller needs to drive their own scrollable under the header. */
export interface CollapsingHeaderScroll {
  /** Spread onto an `Animated.ScrollView` / `Animated.FlatList`. */
  onScroll: ScrollProgress["onScroll"];
  y: SharedValue<number>;
  progress: SharedValue<number>;
  /** Top padding the scroll CONTENT needs so it starts below the header. */
  contentTopPadding: number;
  /** Pass through so the scrollbar does not run under the header. */
  scrollIndicatorInsets: { top: number };
  scrollEventThrottle: number;
}

export interface UseCollapsingHeaderOptions {
  /** Expanded header height, px. Fixed for the life of the component. */
  maxHeight: number;
  /** Collapsed header height, px. The strip the compact bar occupies. */
  minHeight: number;
  /** Cross-fade window, px of collapse. Default 24. */
  fadeWindow?: number;
  /**
   * Overscroll distance, px, over which the pull-down zoom reaches its max.
   * Default `maxHeight`. Shapes the ZOOM only — how far the box follows the
   * overscroll is fixed at `maxHeight` (the background overhang), so shrinking
   * this cannot open a seam.
   */
  pullRange?: number;
  /** Extra scale at full pull-down. Default 0.18 → a 1.18x hero. */
  pullScale?: number;
}

// ── useCollapsingHeader ───────────────────────────────────────────────────

/**
 * The math behind `CollapsingHeader`, exposed for screens that need to own
 * their own scroll container (a FlatList, a SectionList, two stacked headers).
 *
 * Returns the scroll bag plus four ready-made animated styles. Apply them to
 * the box, the hero layer, the compact layer and the hairline respectively;
 * none of them touch a layout property.
 */
export function useCollapsingHeader(opts: UseCollapsingHeaderOptions) {
  const { maxHeight, minHeight } = opts;

  // Guard the degenerate configs before they reach a worklet: an interpolate
  // with a zero-width input range returns NaN, and NaN in a transform silently
  // blanks the view on Fabric rather than throwing.
  const distance = Math.max(maxHeight - minHeight, 1);
  const fadeWindow = Math.min(Math.max(opts.fadeWindow ?? FADE_WINDOW, 1), distance);
  const pullRange = Math.max(opts.pullRange ?? maxHeight, 1);
  const pullScale = Math.max(opts.pullScale ?? 0.18, 0);
  // How far the box follows a rubber-band overscroll downward. Deliberately
  // NOT `pullRange`: that knob only shapes the zoom ramp, and a caller who
  // shortens it for a snappier zoom must not make the header freeze mid-pull
  // and tear a seam open above the content. The ceiling is the background
  // layer's overhang (exactly `maxHeight`, see `styles.background`) — past
  // that there is nothing left to paint the strip above the box with.
  const followRange = Math.max(maxHeight, 1);
  const fadeStart = distance - fadeWindow;

  const reduceMotion = useReducedMotion();
  const { onScroll, y, progress } = useScrollProgress(distance);

  // The only React state in the whole component, and it changes at most once
  // per cross-fade crossing — not once per frame. It exists so the invisible
  // layer stops swallowing taps and stops being read out by VoiceOver; opacity
  // alone hides a view from eyes but not from the accessibility tree.
  const [collapsed, setCollapsed] = useState(false);
  useAnimatedReaction(
    () => y.value >= fadeStart + fadeWindow / 2,
    (next, prev) => {
      // `prev` is null on the first run; comparing anyway means a list that
      // mounts already scrolled (a restored offset) starts in the right state.
      // React bails out of a setState to the identical value, so the redundant
      // first call costs nothing.
      if (next !== prev) runOnJS(setCollapsed)(next);
    },
    [fadeStart, fadeWindow],
  );

  /** The box: slides up by `distance`, then follows any overscroll downward. */
  const headerStyle = useAnimatedStyle(() => {
    const collapse = interpolate(y.value, [0, distance], [0, -distance], Extrapolation.CLAMP);
    const follow = interpolate(y.value, [-followRange, 0], [followRange, 0], Extrapolation.CLAMP);
    return { transform: [{ translateY: collapse + follow }] };
  });

  /** The hero: parallax up, zoom on pull-down, fade out into the compact bar. */
  const heroStyle = useAnimatedStyle(() => {
    const parallax = reduceMotion
      ? 0
      : interpolate(y.value, [0, distance], [0, distance * PARALLAX], Extrapolation.CLAMP);
    const scale = reduceMotion
      ? 1
      : interpolate(y.value, [-pullRange, 0], [1 + pullScale, 1], Extrapolation.CLAMP);
    // Scale is applied about the view's centre, which would push the hero's
    // bottom edge down over the content below. Cancel that so the zoom is
    // anchored to the bottom and only ever grows upward, into the overhang.
    const anchor = -((scale - 1) * maxHeight) / 2;
    return {
      opacity: interpolate(y.value, [fadeStart, distance], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: parallax + anchor }, { scale }],
    };
  });

  /** The compact bar: fades in over the last `fadeWindow` px of the collapse. */
  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [fadeStart, distance], [0, 1], Extrapolation.CLAMP),
  }));

  /** The hairline: stays at 0 until the header is fully collapsed. */
  const borderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [distance, distance + BORDER_FADE], [0, 1], Extrapolation.CLAMP),
  }));

  return {
    onScroll,
    y,
    progress,
    contentTopPadding: maxHeight,
    scrollIndicatorInsets: { top: maxHeight },
    scrollEventThrottle: 16,
    distance,
    collapsed,
    headerStyle,
    heroStyle,
    compactStyle,
    borderStyle,
  };
}

export type CollapsingHeaderController = ReturnType<typeof useCollapsingHeader>;

// ── CollapsingHeader ──────────────────────────────────────────────────────

export interface CollapsingHeaderProps extends UseCollapsingHeaderOptions {
  /** Expanded content. Laid out in a `maxHeight` box; parallaxes and fades. */
  renderHero: (args: CollapsingHeaderRenderArgs) => React.ReactNode;
  /** Collapsed content. Laid out in a `minHeight` strip; fades in over it. */
  renderCompact?: (args: CollapsingHeaderRenderArgs) => React.ReactNode;
  /**
   * Scroll content. Pass nodes to get a managed `Animated.ScrollView`, or a
   * function to receive the scroll bag and supply your own list.
   */
  children?: React.ReactNode | ((scroll: CollapsingHeaderScroll) => React.ReactNode);
  /** Painted behind the hero and through the pull-down overhang. */
  backgroundColor?: string;
  /** Hairline colour. Default `theme.colors.border`. */
  borderColor?: string;
  /** Hide the hairline entirely (e.g. the header sits on a dark hero). */
  showBorder?: boolean;
  /** Style for the header box. Do NOT set height here — it is fixed. */
  headerStyle?: StyleProp<ViewStyle>;
  /** Style for the outer container. */
  style?: StyleProp<ViewStyle>;
  /** Applied to the managed ScrollView's contentContainer. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Extra props for the managed ScrollView. Ignored when `children` is a fn. */
  scrollViewProps?: Omit<
    React.ComponentProps<typeof Animated.ScrollView>,
    "onScroll" | "scrollEventThrottle" | "scrollIndicatorInsets" | "contentContainerStyle" | "children"
  >;
  testID?: string;
}

/**
 * A collapsing header plus (optionally) the scroll view under it.
 *
 *   <CollapsingHeader
 *     maxHeight={220}
 *     minHeight={64 + insets.top}
 *     renderHero={() => <Hero />}
 *     renderCompact={() => <CompactBar />}
 *   >
 *     {rows}
 *   </CollapsingHeader>
 *
 * For a FlatList, pass a function child instead and wire the bag yourself:
 *
 *   <CollapsingHeader ... >
 *     {({ onScroll, contentTopPadding, scrollEventThrottle }) => (
 *       <Animated.FlatList
 *         onScroll={onScroll}
 *         scrollEventThrottle={scrollEventThrottle}
 *         contentContainerStyle={{ paddingTop: contentTopPadding }}
 *         ...
 *       />
 *     )}
 *   </CollapsingHeader>
 */
export function CollapsingHeader({
  maxHeight,
  minHeight,
  fadeWindow,
  pullRange,
  pullScale,
  renderHero,
  renderCompact,
  children,
  backgroundColor = theme.colors.surface,
  borderColor = theme.colors.border,
  showBorder = true,
  headerStyle,
  style,
  contentContainerStyle,
  scrollViewProps,
  testID,
}: CollapsingHeaderProps) {
  const c = useCollapsingHeader({ maxHeight, minHeight, fadeWindow, pullRange, pullScale });

  const args: CollapsingHeaderRenderArgs = useMemo(
    () => ({
      progress: c.progress,
      y: c.y,
      collapsed: c.collapsed,
      distance: c.distance,
      maxHeight,
      minHeight,
    }),
    [c.progress, c.y, c.collapsed, c.distance, maxHeight, minHeight],
  );

  const scroll: CollapsingHeaderScroll = useMemo(
    () => ({
      onScroll: c.onScroll,
      y: c.y,
      progress: c.progress,
      contentTopPadding: c.contentTopPadding,
      scrollIndicatorInsets: c.scrollIndicatorInsets,
      scrollEventThrottle: c.scrollEventThrottle,
    }),
    [c.onScroll, c.y, c.progress, c.contentTopPadding, c.scrollIndicatorInsets, c.scrollEventThrottle],
  );

  // Scroll content is rendered FIRST so the absolutely-positioned header
  // paints over it. zIndex alone is not reliable across both platforms once
  // the children carry their own elevation.
  const content =
    typeof children === "function"
      ? (children as (s: CollapsingHeaderScroll) => React.ReactNode)(scroll)
      : children != null && (
          <Animated.ScrollView
            {...scrollViewProps}
            onScroll={c.onScroll}
            scrollEventThrottle={c.scrollEventThrottle}
            scrollIndicatorInsets={c.scrollIndicatorInsets}
            contentContainerStyle={[{ paddingTop: maxHeight }, contentContainerStyle]}
          >
            {children}
          </Animated.ScrollView>
        );

  return (
    <View style={[styles.root, style]} testID={testID}>
      {content}

      <Animated.View
        style={[styles.header, { height: maxHeight }, headerStyle, c.headerStyle]}
        pointerEvents="box-none"
      >
        {/* Overhang: painted above the box so the rubber-band never shows a seam. */}
        <View
          style={[styles.background, { top: -maxHeight, backgroundColor }]}
          pointerEvents="none"
        />

        <Animated.View
          style={[styles.hero, c.heroStyle]}
          pointerEvents={c.collapsed ? "none" : "box-none"}
          accessibilityElementsHidden={c.collapsed}
          importantForAccessibility={c.collapsed ? "no-hide-descendants" : "auto"}
        >
          {renderHero(args)}
        </Animated.View>

        {renderCompact && (
          <Animated.View
            style={[styles.compact, { height: minHeight }, c.compactStyle]}
            pointerEvents={c.collapsed ? "box-none" : "none"}
            accessibilityElementsHidden={!c.collapsed}
            importantForAccessibility={c.collapsed ? "auto" : "no-hide-descendants"}
          >
            {renderCompact(args)}
          </Animated.View>
        )}

        {showBorder && (
          <Animated.View
            style={[styles.hairline, { backgroundColor: borderColor }, c.borderStyle]}
            pointerEvents="none"
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // Visible, not hidden: the background layer deliberately paints above the
    // box during rubber-band overscroll. Anything else that escapes upward is
    // off-screen by definition.
    overflow: "visible",
  },
  background: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  hero: {
    ...StyleSheet.absoluteFillObject,
  },
  compact: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
  },
  hairline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
