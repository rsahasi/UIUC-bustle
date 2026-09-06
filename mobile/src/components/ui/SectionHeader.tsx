import { theme } from "@/src/constants/theme";
import { PressableScale } from "@/src/components/ui/motion";
import { useEffect } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

export interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
  /**
   * Pin the eyebrow at `stickyOffset` while its section scrolls past it.
   * Requires `scrollY`; without it the header renders exactly as it always has.
   */
  sticky?: boolean;
  /**
   * Live scroll offset of the enclosing scrollable — `useScrollProgress(...).y`
   * or any `useAnimatedScrollHandler`-fed SharedValue.
   */
  scrollY?: SharedValue<number>;
  /**
   * How far the eyebrow stays pinned, px. Pass the height of the section body
   * BELOW this header; the pin releases as the section's bottom arrives, so
   * the eyebrow never floats over the next section's content.
   */
  sectionHeight?: number;
  /**
   * Viewport y at which the eyebrow pins — a collapsed header height, a safe
   * area inset, or 0. Default 0.
   */
  stickyOffset?: number;
  /**
   * This header's y within the scroll CONTENT. Measured with `onLayout` by
   * default, which is correct only when the header is a direct child of the
   * content container; pass it explicitly when the header is nested deeper.
   */
  sectionTop?: number;
  /**
   * Opaque fill painted behind the pinned row so section content cannot show
   * through it. Default `theme.colors.surfaceAlt` (the screen ground).
   */
  stickyBackground?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The one eyebrow style — every section label in the app uses theme.text.eyebrow. */
export function SectionHeader({
  title,
  action,
  sticky = false,
  scrollY,
  sectionHeight,
  stickyOffset = 0,
  sectionTop,
  stickyBackground = theme.colors.surfaceAlt,
  style,
  testID,
}: SectionHeaderProps) {
  // Measured lazily and written straight to a SharedValue: a layout pass must
  // not cost a React render, and the pin has to read this on the UI thread.
  const measuredTop = useSharedValue(sectionTop ?? 0);
  useEffect(() => {
    if (sectionTop != null) measuredTop.value = sectionTop;
  }, [sectionTop, measuredTop]);

  const pinned = sticky && scrollY != null;
  // Degenerate ranges make `interpolate` return NaN, which blanks a transform
  // on Fabric rather than throwing. Floor the span at 1px.
  const span = Math.max(sectionHeight ?? 0, 1);

  const onLayout =
    pinned && sectionTop == null
      ? (e: LayoutChangeEvent) => {
          measuredTop.value = e.nativeEvent.layout.y;
        }
      : undefined;

  // translateY only — the row floats over its own section without re-laying
  // out a single sibling. Clamped at BOTH ends: rubber-band scrolling drives
  // `scrolled` negative at the top of the list, and an unclamped ramp would
  // lift the eyebrow up out of its own section.
  const pinStyle = useAnimatedStyle(() => {
    if (!scrollY) return { transform: [{ translateY: 0 }] };
    const scrolled = scrollY.value - (measuredTop.value - stickyOffset);
    return { transform: [{ translateY: interpolate(scrolled, [0, span], [0, span], Extrapolation.CLAMP) }] };
  }, [span, stickyOffset]);

  const body = (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {action && (
        <PressableScale
          onPress={action.onPress}
          haptic={false}
          hitSlop={10}
          style={styles.actionHit}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.action}>{action.label}</Text>
        </PressableScale>
      )}
    </>
  );

  if (!pinned) {
    return (
      <View style={[styles.row, style]} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.row, styles.sticky, { backgroundColor: stickyBackground }, style, pinStyle]}
      onLayout={onLayout}
      testID={testID}
    >
      {body}
    </Animated.View>
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
  sticky: {
    // Lifts the pinned row above the section content it is translating over.
    zIndex: 2,
  },
  title: {
    ...theme.text.eyebrow,
    color: theme.colors.textMuted,
  },
  actionHit: {
    minHeight: theme.layout.tapMin,
    justifyContent: "center",
  },
  action: {
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    color: theme.colors.brandInk,
  },
});
