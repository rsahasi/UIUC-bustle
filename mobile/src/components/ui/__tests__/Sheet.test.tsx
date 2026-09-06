/**
 * Sheet tests.
 *
 * RNGH's native module cannot be installed under Jest — `GestureHandlerRootView`
 * calls `RNGestureHandlerModule.install()`, which does not exist in this
 * environment — so the package is replaced with a double that renders its
 * children and RECORDS the gesture object it was handed. That recording is the
 * point: it lets us assert the two things about the gesture that unit tests can
 * actually prove (that it is memoized, and that it is wired to the external
 * gestures the caller passed) without pretending to simulate a native
 * recognizer. The release rule itself is tested directly through the exported
 * `projectSnapIndex`.
 */
let mockPanGestures: any[] = [];

jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const makePan = () => {
    const handlers: Record<string, (...args: any[]) => unknown> = {};
    const api: any = {
      handlers,
      externalGestures: [] as unknown[],
      activeOffsetY: jest.fn(() => api),
      failOffsetX: jest.fn(() => api),
      simultaneousWithExternalGesture: jest.fn((...g: unknown[]) => {
        api.externalGestures = g;
        return api;
      }),
      onBegin: (fn: any) => ((handlers.onBegin = fn), api),
      onUpdate: (fn: any) => ((handlers.onUpdate = fn), api),
      onEnd: (fn: any) => ((handlers.onEnd = fn), api),
    };
    return api;
  };
  return {
    Gesture: { Pan: makePan },
    GestureDetector: ({ gesture, children }: any) => {
      mockPanGestures.push(gesture);
      return children;
    },
    GestureHandlerRootView: View,
  };
});

import { fireEvent, render } from "@testing-library/react-native";
import fs from "fs";
import path from "path";
import React from "react";
import { Text } from "react-native";
import { Sheet, projectSnapIndex, VELOCITY_PROJECTION_S } from "../Sheet";

const SNAP = [0, 0.45, 0.82];

/**
 * RNTL queries skip anything hidden from assistive tech, and this component
 * hides things from assistive tech ON PURPOSE — a closed sheet, and (via
 * `accessibilityViewIsModal`) every sibling of an open one. Assertions ABOUT
 * those props therefore have to opt back in.
 */
const HIDDEN = { includeHiddenElements: true } as const;

beforeEach(() => {
  mockPanGestures = [];
  jest.clearAllMocks();
});

function renderSheet(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  const onIndexChange = jest.fn();
  const utils = render(
    <Sheet snapPoints={SNAP} index={1} onIndexChange={onIndexChange} testID="sheet" {...props}>
      <Text>Sheet body</Text>
    </Sheet>
  );
  return { ...utils, onIndexChange };
}

describe("projectSnapIndex", () => {
  // translateY offsets for [0, 0.45, 0.82] in an 800pt container — descending,
  // because a larger translateY means a more-closed sheet.
  const offsets = [800, 440, 144];

  it("snaps to the nearest detent when the finger is basically still", () => {
    expect(projectSnapIndex(offsets, 460, 0)).toBe(1);
    expect(projectSnapIndex(offsets, 170, 0)).toBe(2);
    expect(projectSnapIndex(offsets, 780, 0)).toBe(0);
  });

  it("lands a fling where it was thrown, not where the finger lifted", () => {
    // Released just below the mid detent but flung hard upward. Nearest to the
    // lift point is index 1; nearest to the PROJECTION is the top detent.
    const translateY = 430;
    const velocityY = -1600; // px/s upward
    expect(projectSnapIndex(offsets, translateY, 0)).toBe(1);
    expect(projectSnapIndex(offsets, translateY, velocityY)).toBe(2);
    // and the rule is exactly translationY + v * 0.2
    expect(translateY + velocityY * VELOCITY_PROJECTION_S).toBeCloseTo(110);
  });

  it("lets a hard downward fling from the top detent close the sheet", () => {
    expect(projectSnapIndex(offsets, 160, 4000)).toBe(0);
    // the same position released gently stays put
    expect(projectSnapIndex(offsets, 160, 0)).toBe(2);
  });

  it("is total — every projection resolves to a real detent", () => {
    for (const v of [-9000, -100, 0, 100, 9000]) {
      const i = projectSnapIndex(offsets, 400, v);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(offsets.length);
    }
  });
});

describe("Sheet rendering", () => {
  it("renders its content at the given index", () => {
    const { getByText, getByTestId } = renderSheet({ index: 1 });
    expect(getByText("Sheet body")).toBeTruthy();
    expect(getByTestId("sheet-handle", HIDDEN).props.accessibilityValue).toEqual({
      min: 0,
      max: 2,
      now: 1,
    });
    // Modality is topmost-detent only. At a mid detent the map behind the sheet
    // is the entire point, so it stays touchable and stays in the a11y tree.
    expect(getByTestId("sheet-surface", HIDDEN).props.accessibilityViewIsModal).toBe(false);
  });

  it("is modal only at the topmost detent", () => {
    const mid = renderSheet({ index: 1 });
    expect(mid.getByTestId("sheet-surface", HIDDEN).props.accessibilityViewIsModal).toBe(false);
    // A mid detent must not drop a touch-swallowing backdrop over the map.
    expect(mid.getByTestId("sheet-scrim", HIDDEN).props.pointerEvents).toBe("none");

    const top = renderSheet({ index: 2 });
    expect(top.getByTestId("sheet-surface", HIDDEN).props.accessibilityViewIsModal).toBe(true);
    expect(top.getByTestId("sheet-scrim", HIDDEN).props.pointerEvents).toBe("auto");
  });

  it("reports the closed detent as non-modal and hides itself from assistive tech", () => {
    const { getByTestId, queryByTestId } = renderSheet({ index: 0 });
    expect(getByTestId("sheet-handle", HIDDEN).props.accessibilityValue.now).toBe(0);
    expect(getByTestId("sheet-surface", HIDDEN).props.accessibilityViewIsModal).toBe(false);
    // A closed sheet is off-screen. Leaving its content in the accessibility
    // tree would let VoiceOver swipe into a sheet the user cannot see, so the
    // default (accessibility-only) query must not find any of it.
    expect(queryByTestId("sheet-surface")).toBeNull();
    expect(queryByTestId("sheet-backdrop")).toBeNull();
  });

  it("tracks a changed index prop", () => {
    const { getByTestId, rerender } = renderSheet({ index: 1 });
    rerender(
      <Sheet snapPoints={SNAP} index={2} onIndexChange={jest.fn()} testID="sheet">
        <Text>Sheet body</Text>
      </Sheet>
    );
    expect(getByTestId("sheet-handle", HIDDEN).props.accessibilityValue.now).toBe(2);
  });

  it("clamps an out-of-range index instead of rendering nowhere", () => {
    const { getByTestId } = renderSheet({ index: 99 });
    expect(getByTestId("sheet-handle", HIDDEN).props.accessibilityValue.now).toBe(2);
  });

  it("stays reachable by assistive tech when the FIRST detent is a visible peek", () => {
    // Regression guard. Hiding the sheet from VoiceOver is keyed on whether it
    // is ON SCREEN, not on `index > 0`: a `snapPoints[0]` of 0.25 is a peek
    // detent, fully visible and touchable, and hiding it from assistive tech
    // would make a sheet sighted users can read invisible to everyone else.
    const { getByText, getByTestId } = renderSheet({
      snapPoints: [0.25, 0.6, 0.9],
      index: 0,
    });
    expect(getByText("Sheet body")).toBeTruthy();
    expect(getByTestId("sheet-handle")).toBeTruthy();
    // ...but a peek detent is not modal: the map behind it stays usable.
    expect(getByTestId("sheet-surface").props.accessibilityViewIsModal).toBe(false);
  });

  it("omits the backdrop when asked", () => {
    const { queryByTestId } = renderSheet({ backdrop: false });
    expect(queryByTestId("sheet-backdrop")).toBeNull();
  });

  it("renders a header above the content", () => {
    const { getByText } = renderSheet({ header: <Text>Nearby stops</Text> });
    expect(getByText("Nearby stops")).toBeTruthy();
  });
});

describe("Sheet index changes", () => {
  it("closes when the backdrop is pressed", () => {
    const { getByTestId, onIndexChange } = renderSheet({ index: 2 });
    fireEvent.press(getByTestId("sheet-backdrop", HIDDEN));
    expect(onIndexChange).toHaveBeenCalledTimes(1);
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("keeps an assistive-tech route to closing, since modality shadows the backdrop", () => {
    // `accessibilityViewIsModal` on the sheet makes every host SIBLING of the
    // sheet inaccessible on iOS — the backdrop included. That is why the drag
    // handle is `adjustable` rather than decorative: it lives INSIDE the modal
    // subtree, so it is the one collapse affordance VoiceOver can still reach.
    // Modality applies at the TOPMOST detent only, so that is where the
    // backdrop is shadowed and the handle becomes the sole a11y collapse route.
    const { queryByTestId, getByTestId, onIndexChange } = renderSheet({ index: 2 });
    expect(queryByTestId("sheet-backdrop")).toBeNull();
    fireEvent(getByTestId("sheet-handle"), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it("moves one detent per accessibility action on the handle", () => {
    const { getByTestId, onIndexChange } = renderSheet({ index: 1 });
    fireEvent(getByTestId("sheet-handle"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onIndexChange).toHaveBeenCalledWith(2);

    onIndexChange.mockClear();
    fireEvent(getByTestId("sheet-handle"), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("does not expand past the last snap point", () => {
    const { getByTestId, onIndexChange } = renderSheet({ index: 2 });
    fireEvent(getByTestId("sheet-handle"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it("does not collapse past the first snap point", () => {
    const { getByTestId, onIndexChange } = renderSheet({ index: 0 });
    fireEvent(getByTestId("sheet-handle", HIDDEN), "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it("ignores an accessibility action it does not implement", () => {
    const { getByTestId, onIndexChange } = renderSheet({ index: 1 });
    fireEvent(getByTestId("sheet-handle"), "accessibilityAction", {
      nativeEvent: { actionName: "activate" },
    });
    expect(onIndexChange).not.toHaveBeenCalled();
  });
});

describe("Sheet gesture wiring", () => {
  it("keeps ONE gesture object across re-renders", () => {
    const { rerender } = renderSheet({ index: 1 });
    rerender(
      <Sheet snapPoints={SNAP} index={1} onIndexChange={jest.fn()} testID="sheet">
        <Text>Sheet body v2</Text>
      </Sheet>
    );
    expect(mockPanGestures.length).toBeGreaterThan(1);
    // A fresh gesture object per render re-attaches the native recognizer and
    // drops the in-flight touch.
    expect(new Set(mockPanGestures).size).toBe(1);
  });

  it("constrains activation to the vertical axis", () => {
    renderSheet();
    const gesture = mockPanGestures[0];
    expect(gesture.activeOffsetY).toHaveBeenCalledWith([-10, 10]);
    expect(gesture.failOffsetX).toHaveBeenCalledWith([-16, 16]);
  });

  it("captures the start offset in onBegin, not in a v3-style ctx", () => {
    renderSheet();
    const gesture = mockPanGestures[0];
    expect(typeof gesture.handlers.onBegin).toBe("function");
    expect(gesture.handlers.onBegin.length).toBe(0);
  });

  it("forwards external gestures so the map keeps panning", () => {
    const mapRef = React.createRef<any>();
    renderSheet({ simultaneousWithExternalGesture: mapRef });
    expect(mockPanGestures[0].externalGestures).toEqual([mapRef]);
  });

  it("does not call simultaneousWithExternalGesture when none is given", () => {
    renderSheet();
    expect(mockPanGestures[0].simultaneousWithExternalGesture).not.toHaveBeenCalled();
  });

  it("survives an inline external-gesture array without rebuilding the gesture", () => {
    const mapRef = React.createRef<any>();
    const { rerender } = render(
      <Sheet
        snapPoints={SNAP}
        index={1}
        onIndexChange={jest.fn()}
        simultaneousWithExternalGesture={[mapRef]}
      >
        <Text>Sheet body</Text>
      </Sheet>
    );
    rerender(
      <Sheet
        snapPoints={SNAP}
        index={1}
        onIndexChange={jest.fn()}
        simultaneousWithExternalGesture={[mapRef]}
      >
        <Text>Sheet body</Text>
      </Sheet>
    );
    expect(new Set(mockPanGestures).size).toBe(1);
  });
});

describe("app root invariant", () => {
  // The Sheet is inert without it: RNGH throws "GestureDetector must be used as
  // a descendant of GestureHandlerRootView". Nothing else in the suite guards
  // this, and it is a one-line deletion away at all times.
  it("mounts GestureHandlerRootView at the app root", () => {
    const layout = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "app", "_layout.tsx"),
      "utf8"
    );
    expect(layout).toMatch(
      /import\s*\{[^}]*GestureHandlerRootView[^}]*\}\s*from\s*["']react-native-gesture-handler["']/
    );
    expect(layout).toContain("<GestureHandlerRootView");
    expect(layout).toContain("</GestureHandlerRootView>");
  });
});
