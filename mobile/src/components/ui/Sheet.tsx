/**
 * Sheet — a snap-point bottom sheet, hand-rolled on RNGH + Reanimated.
 *
 * ── Why not @gorhom/bottom-sheet ──────────────────────────────────────────
 * It was evaluated and rejected. Our sheet has three fixed detents, no text
 * input, no keyboard avoidance, and it has to arbitrate touches with a native
 * MapView underneath. Configuring that library for those constraints is more
 * code than the ~200 lines below, and it would hand the spring curve to a
 * third party when the whole point of the motion rebuild is that
 * `SPRING_D.sheet` decides how every detent feels.
 *
 * ── The parts that are easy to get wrong ──────────────────────────────────
 * 1. The `Gesture.Pan()` object is built inside `useMemo`. A fresh gesture
 *    object on every render re-attaches the native recognizer, which drops the
 *    in-flight touch — the sheet visibly "sticks" mid-drag. Everything the
 *    gesture needs that changes over time is therefore read through a
 *    SharedValue, not captured from props.
 * 2. `activeOffsetY([-10, 10])` + `failOffsetX` means a horizontal swipe on a
 *    carousel inside the sheet's content is not stolen by the sheet.
 * 3. The start offset is captured in `.onBegin()`. Reanimated 4 removed
 *    `useAnimatedGestureHandler`'s `ctx` argument, so there is nowhere else to
 *    put it.
 * 4. VELOCITY PROJECTION. The release detent is chosen by projecting
 *    `translationY + velocityY * VELOCITY_PROJECTION_S` and snapping to the
 *    nearest detent TO THAT PROJECTION. Snapping to the nearest detent to
 *    where the finger physically lifted makes a hard fling die on the spot,
 *    which reads as the sheet ignoring you.
 * 5. Backdrop opacity is interpolated from the sheet's live position, not run
 *    as its own timing. Dragging the sheet halfway therefore dims the map
 *    halfway, and an interrupted drag never desynchronises the two.
 * 6. The detent haptic fires from `runOnJS` on CHANGE ONLY. Firing it per
 *    frame would buzz continuously for the length of the drag.
 *
 * ── Accessibility, and one consequence worth knowing ──────────────────────
 * `accessibilityViewIsModal` makes iOS VoiceOver ignore every SIBLING of the
 * sheet while it is open — which includes the backdrop, so the backdrop's
 * "Close" button is a touch affordance only. That is why the drag handle
 * carries the `adjustable` role and increment/decrement actions instead of
 * being decorative: it sits INSIDE the modal subtree, so it is the detent
 * control assistive tech can still reach, and it is what makes a
 * pan-driven sheet operable without a pan.
 */
import { SPRING_D } from "@/src/constants/motion";
import { theme } from "@/src/constants/theme";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { fireHaptic, useReducedMotion } from "./motion";

/**
 * Seconds of travel used to project a fling forward before choosing a detent.
 * 0.2 is the value that makes a flick feel like it lands where it was thrown:
 * low enough that a slow drag still snaps to the nearest detent, high enough
 * that a fast flick clears a whole detent gap.
 */
export const VELOCITY_PROJECTION_S = 0.2;

/** How dark the backdrop gets at the topmost detent. */
const BACKDROP_MAX_OPACITY = 0.45;

/** Vertical travel (px) the pan must exceed before the sheet claims the touch. */
const PAN_ACTIVATE_Y = 10;
/** Horizontal travel (px) that hands the touch back to the sheet's content. */
const PAN_FAIL_X = 16;

/**
 * Anything RNGH accepts as an "external gesture" to run simultaneously with.
 * `GestureRef` itself is not re-exported from the package index, so the shape
 * is restated here (minus the `number` handler-tag form, which
 * `simultaneousWithExternalGesture` does not take).
 */
export type SheetExternalGesture =
  | GestureType
  | React.RefObject<GestureType | undefined>
  | React.RefObject<React.ComponentType | undefined>;

export interface SheetProps {
  /**
   * Detents as a fraction of the container's height, ASCENDING, where 0 is
   * fully closed and 1 is full height. `index` indexes into this array, so the
   * order is meaningful and is never sorted for you.
   */
  snapPoints: readonly number[];
  /** Controlled detent index into `snapPoints`. */
  index: number;
  /** Fired when a gesture, the backdrop, or the handle picks a new detent. */
  onIndexChange: (index: number) => void;
  /** Render the dimming backdrop. Default true. */
  backdrop?: boolean;
  /** Optional node rendered under the drag handle, above `children`. */
  header?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Gestures the sheet's pan must not fight with — pass the MapView's ref here
   * so panning the map still works while the sheet is mounted over it.
   */
  simultaneousWithExternalGesture?: SheetExternalGesture | SheetExternalGesture[];
  /** Announced as the sheet's own label. Default "Bottom sheet". */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Choose the detent a release should land on.
 *
 * `offsets` are translateY values in the same order as `snapPoints`, so they
 * run DESCENDING (index 0 is the closed detent and therefore the largest
 * translateY). Exported so the projection rule can be unit-tested without
 * driving a native recognizer.
 */
export function projectSnapIndex(
  offsets: readonly number[],
  translateY: number,
  velocityY: number
): number {
  "worklet";
  const projected = translateY + velocityY * VELOCITY_PROJECTION_S;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < offsets.length; i += 1) {
    const distance = Math.abs(offsets[i] - projected);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * Returns a reference-stable array as long as its contents are shallow-equal.
 * Callers pass `simultaneousWithExternalGesture={[mapRef]}` inline; without
 * this the array identity changes every render and takes the memoized gesture
 * down with it (see hazard 1 in the file header).
 */
function useShallowStableList<T>(next: readonly T[]): readonly T[] {
  const ref = useRef<readonly T[]>(next);
  const prev = ref.current;
  const same = prev.length === next.length && prev.every((v, i) => v === next[i]);
  if (!same) ref.current = next;
  return ref.current;
}

export function Sheet({
  snapPoints,
  index,
  onIndexChange,
  backdrop = true,
  header,
  children,
  simultaneousWithExternalGesture,
  accessibilityLabel = "Bottom sheet",
  style,
  contentStyle,
  testID,
}: SheetProps) {
  const window = useWindowDimensions();
  // The container measures itself, but a sheet must be positioned correctly on
  // its very first frame — before onLayout has ever fired — so the window
  // height seeds it.
  const [height, setHeight] = useState(window.height);
  const reduced = useReducedMotion();

  if (__DEV__) {
    for (let i = 1; i < snapPoints.length; i += 1) {
      if (snapPoints[i] < snapPoints[i - 1]) {
        console.warn(
          `[Sheet] snapPoints must be ascending; got ${JSON.stringify(snapPoints)}. ` +
            "`index` indexes this array directly, so it is never sorted for you."
        );
        break;
      }
    }
  }

  const clampedIndex = Math.min(Math.max(index, 0), Math.max(snapPoints.length - 1, 0));

  // translateY for each detent, same order as snapPoints (so: descending).
  // The surface is sized to the LARGEST detent and anchored to the bottom, so a
  // child's content box always equals the tallest visible sheet. Offsets are then
  // measured from that surface top, not from the container top. Sizing the
  // surface to the full container instead (top:0/bottom:0) lays flex:1 children
  // out against a box taller than the sheet ever shows, which pushes the end of
  // a list and any bottom-pinned row off-screen for good.
  const maxFraction = useMemo(
    () => snapPoints.reduce((m, f) => Math.max(m, f), 0),
    [snapPoints]
  );
  const surfaceHeight = height * maxFraction;
  const offsets = useMemo(
    () => snapPoints.map((fraction) => (maxFraction - fraction) * height),
    [snapPoints, height, maxFraction]
  );

  const y = useSharedValue(offsets[clampedIndex] ?? height);
  const startY = useSharedValue(0);
  // Worklet-readable mirrors. The gesture reads these instead of capturing
  // props, which is what lets its `useMemo` deps stay empty.
  const offsetsSV = useSharedValue<number[]>(offsets);
  const indexSV = useSharedValue(clampedIndex);
  const reducedSV = useSharedValue(reduced);

  // JS-thread twin of `offsetsSV`, so the runOnJS commit below can record where
  // the gesture sent the sheet without capturing `offsets` and thereby losing
  // `commitIndex`'s reference stability.
  const offsetsRef = useRef<number[]>(offsets);

  useEffect(() => {
    offsetsSV.value = offsets;
    offsetsRef.current = offsets;
  }, [offsets, offsetsSV]);
  useEffect(() => {
    reducedSV.value = reduced;
  }, [reduced, reducedSV]);

  // Last translateY we deliberately drove the sheet to, by prop OR by gesture.
  // Reconciling against this (rather than against the previous `index` prop)
  // means a gesture that the parent accepts does not re-trigger a second
  // spring to the place the sheet is already travelling to.
  const targetRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const heightRef = useRef(height);

  const onIndexChangeRef = useRef(onIndexChange);
  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  });

  // Stable across renders, so the memoized gesture can close over it and
  // `runOnJS` it without ever needing to be rebuilt.
  const commitIndex = useCallback((next: number) => {
    // Record the destination BEFORE telling the parent. `onEnd` runs on the UI
    // thread and cannot touch `targetRef`, so without this the reconcile effect
    // below sees the accepted index as a brand-new target and starts a SECOND
    // `withSpring` to the place the release spring is already flying to —
    // restarting it from zero velocity and visibly flattening the fling.
    const target = offsetsRef.current[next];
    if (target != null) targetRef.current = target;
    fireHaptic("detent");
    onIndexChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    const target = offsets[clampedIndex];
    if (target == null) return;
    const heightChanged = heightRef.current !== height;
    const first = !mountedRef.current;
    heightRef.current = height;
    mountedRef.current = true;

    // First frame and rotation are re-positions, not transitions: animating
    // them would show the sheet sliding in from nowhere on mount.
    if (first || heightChanged) {
      targetRef.current = target;
      y.value = target;
      indexSV.value = clampedIndex;
      return;
    }
    if (targetRef.current === target) {
      indexSV.value = clampedIndex;
      return;
    }
    targetRef.current = target;
    indexSV.value = clampedIndex;
    y.value = reduced ? target : withSpring(target, SPRING_D.sheet);
  }, [clampedIndex, offsets, height, reduced, y, indexSV]);

  const settleAt = useCallback(
    (next: number) => {
      const target = offsets[next];
      if (target == null) return;
      targetRef.current = target;
      indexSV.value = next;
      y.value = reduced ? target : withSpring(target, SPRING_D.sheet);
      commitIndex(next);
    },
    [offsets, reduced, y, indexSV, commitIndex]
  );

  const externalGestures = useShallowStableList(
    useMemo(() => {
      if (!simultaneousWithExternalGesture) return [];
      return Array.isArray(simultaneousWithExternalGesture)
        ? simultaneousWithExternalGesture
        : [simultaneousWithExternalGesture];
    }, [simultaneousWithExternalGesture])
  );

  const pan = useMemo(() => {
    const gesture = Gesture.Pan()
      // Claim the touch only after real vertical travel, and hand it back the
      // moment the finger goes sideways.
      .activeOffsetY([-PAN_ACTIVATE_Y, PAN_ACTIVATE_Y])
      .failOffsetX([-PAN_FAIL_X, PAN_FAIL_X])
      .onBegin(() => {
        "worklet";
        // v4 has no `ctx` argument — the start offset lives in a SharedValue.
        startY.value = y.value;
      })
      .onUpdate((event) => {
        "worklet";
        const offs = offsetsSV.value;
        if (offs.length === 0) return;
        const top = offs[offs.length - 1];
        const bottom = offs[0];
        const next = startY.value + event.translationY;
        y.value = next < top ? top : next > bottom ? bottom : next;
      })
      .onEnd((event) => {
        "worklet";
        const offs = offsetsSV.value;
        if (offs.length === 0) return;
        const next = projectSnapIndex(offs, y.value, event.velocityY);
        const target = offs[next];
        y.value = reducedSV.value ? target : withSpring(target, SPRING_D.sheet);
        if (next !== indexSV.value) {
          indexSV.value = next;
          runOnJS(commitIndex)(next);
        }
      });

    if (externalGestures.length > 0) {
      // RNGH's published `GestureRef` does not model a ref to a native
      // component instance (a MapView ref is `RefObject<MapView | null>`,
      // not `RefObject<ComponentType | undefined>`), which is exactly the
      // thing this prop exists to accept. The cast is that gap, and nothing
      // more: the values are passed straight through.
      gesture.simultaneousWithExternalGesture(
        ...(externalGestures as Parameters<typeof gesture.simultaneousWithExternalGesture>)
      );
    }
    return gesture;
  }, [externalGestures, startY, y, offsetsSV, indexSV, reducedSV, commitIndex]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => {
    const offs = offsetsSV.value;
    if (offs.length < 2) return { opacity: 0 };
    return {
      opacity: interpolate(
        y.value,
        [offs[0], offs[offs.length - 1]],
        [0, BACKDROP_MAX_OPACITY],
        Extrapolation.CLAMP
      ),
    };
  });

  // These are two different questions and were one variable, which is a bug
  // when `snapPoints[0]` is a peek detent (0.25, say) rather than 0:
  //   `open`    — does the sheet OWN the screen? Drives modality and whether
  //               the backdrop swallows touches.
  //   `visible` — is the sheet ON SCREEN at all? Drives whether it exists for
  //               assistive tech. A peek detent is visible but not modal, and
  //               hiding a sheet sighted users can read is never right.
  const open = clampedIndex > 0;
  const visible = (snapPoints[clampedIndex] ?? 0) > 0;
  // Only the topmost detent covers the screen enough to justify taking over.
  // At a peek or mid detent the map behind is the point, so it stays touchable
  // and stays in the accessibility tree.
  const isModal = clampedIndex === snapPoints.length - 1 && (snapPoints[clampedIndex] ?? 0) > 0;

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    if (measured > 0) setHeight((prev) => (Math.abs(prev - measured) < 1 ? prev : measured));
  }, []);

  const onHandleAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const action = event.nativeEvent.actionName;
      if (action === "increment") settleAt(Math.min(clampedIndex + 1, snapPoints.length - 1));
      else if (action === "decrement") settleAt(Math.max(clampedIndex - 1, 0));
    },
    [clampedIndex, snapPoints.length, settleAt]
  );

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={handleLayout}
      testID={testID}
    >
      {backdrop ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
          pointerEvents={isModal ? "auto" : "none"}
          testID={testID ? `${testID}-scrim` : "sheet-scrim"}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityElementsHidden={!open}
            importantForAccessibility={open ? "auto" : "no-hide-descendants"}
            testID={testID ? `${testID}-backdrop` : "sheet-backdrop"}
            onPress={() => settleAt(0)}
          />
        </Animated.View>
      ) : null}

      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.sheet, { height: surfaceHeight }, style, sheetStyle]}
          // Open sheet takes VoiceOver focus away from the map behind it. Note
          // this also shadows the backdrop button (see the file header).
          accessibilityViewIsModal={isModal}
          accessibilityLabel={accessibilityLabel}
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
          testID={testID ? `${testID}-surface` : "sheet-surface"}
        >
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Sheet position"
            accessibilityHint="Swipe up or down to resize the sheet"
            accessibilityValue={{ min: 0, max: Math.max(snapPoints.length - 1, 0), now: clampedIndex }}
            accessibilityActions={ACCESSIBILITY_ACTIONS}
            onAccessibilityAction={onHandleAction}
            style={styles.handleArea}
            testID={testID ? `${testID}-handle` : "sheet-handle"}
          >
            <View style={styles.handleBar} />
          </View>
          {header}
          <View style={[styles.content, contentStyle]}>{children}</View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const ACCESSIBILITY_ACTIONS = [
  { name: "increment" as const, label: "Expand sheet" },
  { name: "decrement" as const, label: "Collapse sheet" },
];

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: theme.colors.navyDeep,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    // Bottom-anchored with an explicit height (the largest detent), set inline.
    bottom: 0,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xxl,
    borderTopRightRadius: theme.radius.xxl,
    shadowColor: theme.colors.navy,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  // The 44pt floor here is the grab target, not the visual: the bar itself is
  // 5pt tall and would be unmissable-by-thumb without it.
  handleArea: {
    height: theme.layout.tapMin,
    alignItems: "center",
    justifyContent: "center",
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.border,
  },
  content: {
    flex: 1,
  },
});
