/**
 * Reduced-motion QA harness.
 *
 * The motion system makes one promise that a human cannot reliably re-check by
 * hand on every PR: when "Reduce Motion" is on, nothing in the app loops. A
 * loop is the one animation shape with no honest degraded form — a spring or a
 * fade has an end state to snap to, but a pulse that runs forever has nowhere
 * to land, so the only correct behaviour is not to start it. This file asserts
 * that for EVERY looping primitive, and it asserts it two ways:
 *
 *   1. the loop is never STARTED — `withRepeat` is spied on, so a regression
 *      that starts a loop and then hides it (opacity 0, zero distance) still
 *      fails here. This is the assertion that carries the promise;
 *   2. the rendered frame is the STATIC one — the resting values a reduce-motion
 *      user should actually see. Note what this can and cannot do: jest never
 *      advances an animation clock, so a running loop's shared value sits at
 *      its start value all suite long and this assertion CANNOT see it. Its job
 *      is narrower — pinning the value each primitive parks at, so nobody
 *      "fixes" reduced motion by freezing a live dot at its dimmed 0.25 floor.
 *      Loop detection is (1)'s alone.
 *
 * Every test also carries its positive control: the same primitive with motion
 * allowed must start the loop. Without that pair, a primitive accidentally
 * rewritten to animate nothing at all would pass the suite while shipping a
 * dead UI.
 *
 * The last block covers `useReducedMotion` itself. Reanimated's own
 * `useReducedMotion()` snapshots the OS setting at MODULE IMPORT and never
 * updates, so a user who flips the switch mid-session keeps the old behaviour
 * until the app is killed. The local hook exists purely to fix that, so the
 * change-event test below is the regression guard for the bug it was written
 * for — deleting it would let someone "simplify" the hook back into the bug.
 */

// Must precede the import of anything that imports Reanimated. `withRepeat` is
// the single choke point every loop in motion.tsx goes through, and
// `cancelAnimation` is how a loop is retracted, so spying on the real functions
// (rather than replacing them) proves start/stop without changing behaviour.
jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated");
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    withRepeat: jest.fn((...args: unknown[]) => (actual.withRepeat as (...a: unknown[]) => unknown)(...args)),
    cancelAnimation: jest.fn((...args: unknown[]) =>
      (actual.cancelAnimation as (...a: unknown[]) => unknown)(...args)
    ),
  };
});

import { act, render, type RenderResult } from "@testing-library/react-native";
import React from "react";
import { AccessibilityInfo, Text } from "react-native";
import { cancelAnimation, withRepeat } from "react-native-reanimated";
import { Beacon, FloatingView, PulseView, RouteProgress, Skeleton, Stagger, useReducedMotion } from "../motion";

const loopStarts = withRepeat as unknown as jest.Mock;
const loopCancels = cancelAnimation as unknown as jest.Mock;

/** What the OS would answer right now. Mutated per test, read by the mock. */
let systemReduceMotion = false;
/** Handlers motion.tsx registered for "reduceMotionChanged". */
let changeHandlers: Array<(enabled: boolean) => void> = [];
/** How many native subscriptions have been torn down. */
let removedSubscriptions = 0;

beforeEach(() => {
  systemReduceMotion = false;
  changeHandlers = [];
  removedSubscriptions = 0;
  jest.clearAllMocks();

  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockImplementation(() => Promise.resolve(systemReduceMotion));

  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    event: string,
    handler: (enabled: boolean) => void
  ) => {
    if (event === "reduceMotionChanged") changeHandlers.push(handler);
    return {
      remove: () => {
        removedSubscriptions += 1;
        changeHandlers = changeHandlers.filter((h) => h !== handler);
      },
    };
  }) as never);
});

/** Let the `isReduceMotionEnabled()` promise (and the re-render it causes) land. */
async function flush() {
  await act(async () => {});
}

function ReduceMotionProbe() {
  return <Text>{useReducedMotion() ? "reduced" : "full"}</Text>;
}

/**
 * Put the module-level reduce-motion cache into a known state BEFORE the
 * component under test mounts.
 *
 * This matters because the flag is answered by an async
 * `AccessibilityInfo.isReduceMotionEnabled()`: a component mounted in the same
 * tick as the very first subscriber renders one frame against the default
 * (`false`) no matter what the OS says. That cold-start frame is real, and it
 * has its own test below — but it is not what "the app runs with Reduce Motion
 * on" looks like, which is what the rest of this file is about.
 */
async function settleReducedMotion(enabled: boolean) {
  systemReduceMotion = enabled;
  const primer = render(<ReduceMotionProbe />);
  await flush();
  expect(primer.getByText(enabled ? "reduced" : "full")).toBeTruthy();
  primer.unmount();
  // The primer's own subscribe/unsubscribe and any warm-up animation are
  // bookkeeping, not evidence about the component under test.
  loopStarts.mockClear();
  loopCancels.mockClear();
  removedSubscriptions = 0;
}

/** Every host node's props, in render order. */
function hostProps(tree: RenderResult): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    if (n.props) out.push(n.props);
    (n.children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out;
}

/**
 * The resolved value of every `useAnimatedStyle` in the tree.
 *
 * `-0` is normalised to `0`. A resting `translateY: -0` (from `-t.value * dy`
 * with `t` at zero) is the same pixel as `0`, but `toEqual` distinguishes them,
 * and pinning the sign would fail the suite over a harmless refactor of the
 * worklet's arithmetic rather than over a real animation.
 */
function animatedStyles(tree: RenderResult): unknown[] {
  const normalise = (value: unknown): unknown => {
    if (Object.is(value, -0)) return 0;
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, normalise(v)])
      );
    }
    return value;
  };
  return hostProps(tree)
    .filter((p) => p.jestAnimatedStyle)
    .map((p) => normalise((p.jestAnimatedStyle as { value: unknown }).value));
}

/**
 * The flattened inline style of every animated node — this is where
 * Reanimated's CSS-animation props (`animationName`, `animationIterationCount`)
 * surface, which is how `Skeleton` loops.
 */
function inlineStyles(tree: RenderResult): Array<Record<string, unknown>> {
  return hostProps(tree)
    .filter((p) => p.jestInlineStyle)
    .map((p) => p.jestInlineStyle as Record<string, unknown>);
}

// ── Looping primitives ────────────────────────────────────────────────────

/**
 * Every primitive in motion.tsx that calls `withRepeat`, with the frame it must
 * render when it declines to loop. The resting values are the assertion that
 * "static" means VISIBLE-and-still, not blank: a PulseView frozen at its pulse
 * floor (opacity 0.45) would be a silently dimmed live dot, and Beacon's halo
 * rests invisible on purpose because a halo is an event, not a state.
 */
const LOOPING_PRIMITIVES: ReadonlyArray<{
  name: string;
  element: React.ReactElement;
  restingStyles: unknown[];
}> = [
  {
    name: "PulseView",
    element: <PulseView minOpacity={0.25} maxScale={1.7} style={{ width: 16, height: 16 }} />,
    restingStyles: [{ opacity: 1, transform: [{ scale: 1 }] }],
  },
  {
    name: "FloatingView",
    element: <FloatingView distance={8} style={{ width: 16, height: 16 }} />,
    restingStyles: [{ transform: [{ translateY: 0 }] }],
  },
  {
    name: "Beacon",
    element: <Beacon size={24} />,
    restingStyles: [{ opacity: 0, transform: [{ scale: 0.5 }] }],
  },
  {
    // The fourth withRepeat(-1) site in motion.tsx, and the one route-tracker
    // draws its rail with. Under reduced motion it must snap fully drawn
    // rather than sit at zero, so the route reads as a route and not a gap.
    name: "RouteProgress (loop)",
    element: (
      <RouteProgress
        loop
        points={[
          { x: 0, y: 0 },
          { x: 20, y: 10 },
          { x: 40, y: 0 },
        ]}
      />
    ),
    restingStyles: [],
  },
];

describe.each(LOOPING_PRIMITIVES)("$name under reduced motion", ({ element, restingStyles }) => {
  it("starts a loop when the system allows motion", async () => {
    // Positive control. If this ever fails, the reduced-motion assertions below
    // have stopped proving anything.
    await settleReducedMotion(false);
    render(element);
    await flush();
    expect(loopStarts).toHaveBeenCalled();
  });

  it("never starts a loop", async () => {
    await settleReducedMotion(true);
    render(element);
    await flush();
    expect(loopStarts).not.toHaveBeenCalled();
  });

  it("renders its static resting frame", async () => {
    await settleReducedMotion(true);
    const tree = render(element);
    await flush();
    expect(animatedStyles(tree)).toEqual(restingStyles);
  });

  it("stays static across a re-render", async () => {
    // A loop started on a later render is just as broken as one started on the
    // first, and effect-dependency churn is the usual way it happens.
    await settleReducedMotion(true);
    const tree = render(element);
    await flush();
    tree.rerender(element);
    await flush();
    expect(loopStarts).not.toHaveBeenCalled();
    expect(animatedStyles(tree)).toEqual(restingStyles);
  });
});

describe("Skeleton under reduced motion", () => {
  // Skeleton does not use `withRepeat` — its shimmer is a Reanimated CSS
  // animation shared at module scope, so the loop shows up as style props
  // rather than as a call. Same promise, different mechanism, so it needs its
  // own assertions rather than a row in the table above.
  const element = <Skeleton width={120} height={14} />;

  it("shimmers on an infinite CSS animation when motion is allowed", async () => {
    await settleReducedMotion(false);
    const tree = render(element);
    await flush();
    const sheen = inlineStyles(tree);
    expect(sheen).toHaveLength(1);
    expect(sheen[0].animationName).toBeDefined();
    expect(sheen[0].animationIterationCount).toBe("infinite");
  });

  it("renders a still sheen with no animation attached", async () => {
    await settleReducedMotion(true);
    const tree = render(element);
    await flush();
    const sheen = inlineStyles(tree);
    expect(sheen).toHaveLength(1);
    expect(sheen[0].animationName).toBeUndefined();
    expect(sheen[0].animationIterationCount).toBeUndefined();
    // Still legible as a placeholder — a skeleton that vanished under reduced
    // motion would leave a loading screen looking empty and broken.
    expect(sheen[0].opacity).toBe(0.5);
  });
});

// ── Stagger ───────────────────────────────────────────────────────────────

/**
 * Entrance descriptors on every wrapper Stagger produced.
 *
 * `entering` is consumed by Reanimated's animated component and never reaches a
 * host view, so this reads the composite tree rather than `toJSON()`. The
 * predicate is annotated by hand because `ReactTestInstance` comes from
 * `@types/react-test-renderer`, which this project does not install.
 */
type TestNode = { props: Record<string, unknown> };

function enteringProps(tree: RenderResult): unknown[] {
  const nodes: TestNode[] = tree.UNSAFE_root.findAll(
    (node: TestNode) => Boolean(node.props) && "entering" in node.props
  );
  return nodes.map((node) => node.props.entering);
}

describe("Stagger under reduced motion", () => {
  const element = (
    <Stagger>
      <Text>First stop</Text>
      <Text>Second stop</Text>
      <Text>Third stop</Text>
    </Stagger>
  );

  it("gives every item a delayed entrance when motion is allowed", async () => {
    await settleReducedMotion(false);
    const tree = render(element);
    await flush();
    const entrances = enteringProps(tree);
    expect(entrances.length).toBeGreaterThan(0);
    expect(entrances.every((e) => e !== undefined)).toBe(true);
  });

  it("renders its children immediately, with no entrance to wait through", async () => {
    await settleReducedMotion(true);
    const tree = render(element);
    await flush();

    const entrances = enteringProps(tree);
    // The wrappers still exist (layout is unchanged) — they just carry no
    // entrance, so nothing is held back behind a delay.
    expect(entrances.length).toBeGreaterThan(0);
    expect(entrances.every((e) => e === undefined)).toBe(true);

    expect(tree.getByText("First stop")).toBeTruthy();
    expect(tree.getByText("Second stop")).toBeTruthy();
    expect(tree.getByText("Third stop")).toBeTruthy();
  });
});

// ── The live hook ─────────────────────────────────────────────────────────

describe("useReducedMotion (live)", () => {
  it("subscribes to the system setting instead of snapshotting it", async () => {
    render(<ReduceMotionProbe />);
    await flush();
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalled();
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      "reduceMotionChanged",
      expect.any(Function)
    );
  });

  it("picks up a reduceMotionChanged event mid-session", async () => {
    // THE regression guard. Reanimated's own useReducedMotion() reads the OS
    // setting once at module import; a user who turns Reduce Motion on from
    // Control Center would keep every loop running until the app is killed.
    const tree = render(<ReduceMotionProbe />);
    await flush();
    expect(tree.getByText("full")).toBeTruthy();

    await act(async () => {
      changeHandlers.forEach((handler) => handler(true));
    });
    expect(tree.getByText("reduced")).toBeTruthy();

    // ...and back, so the hook is a live mirror rather than a one-way latch.
    await act(async () => {
      changeHandlers.forEach((handler) => handler(false));
    });
    expect(tree.getByText("full")).toBeTruthy();
  });

  it("stops a running loop when the setting is turned on mid-session", async () => {
    await settleReducedMotion(false);
    render(<PulseView style={{ width: 16, height: 16 }} />);
    await flush();
    expect(loopStarts).toHaveBeenCalled();

    loopCancels.mockClear();
    loopStarts.mockClear();
    await act(async () => {
      changeHandlers.forEach((handler) => handler(true));
    });
    expect(loopCancels).toHaveBeenCalled();
    // Cancellation alone proves nothing: the effect's cleanup calls
    // `cancelAnimation` on ANY dependency change, so a PulseView that ignored
    // the flag would cancel and immediately restart, and still pass the line
    // above. The loop must be gone, not merely restarted.
    expect(loopStarts).not.toHaveBeenCalled();
  });

  it("shares one native subscription across many consumers", async () => {
    // A loading screen mounts a dozen Skeletons; each adding its own native
    // listener would be pure overhead for the same single answer.
    render(
      <>
        <ReduceMotionProbe />
        <ReduceMotionProbe />
        <ReduceMotionProbe />
      </>
    );
    await flush();
    expect(changeHandlers).toHaveLength(1);
  });

  it("releases the native subscription when the last consumer unmounts", async () => {
    const tree = render(<ReduceMotionProbe />);
    await flush();
    expect(removedSubscriptions).toBe(0);
    tree.unmount();
    expect(removedSubscriptions).toBe(1);
  });

  it("retracts the loop it optimistically began before the first query resolved", async () => {
    // Documented cold-start behaviour, not an aspiration: the OS answer arrives
    // asynchronously, so the very first subscriber in a fresh process renders
    // one frame against the default (motion allowed) and a loop does start.
    // What must hold is that the loop is retracted the moment the real answer
    // lands — this test fails if that cancellation is ever dropped.
    systemReduceMotion = true;
    render(<PulseView style={{ width: 16, height: 16 }} />);
    expect(loopStarts).toHaveBeenCalled();

    loopCancels.mockClear();
    loopStarts.mockClear();
    await flush();
    expect(loopCancels).toHaveBeenCalled();
    // Same trap as above — retracted has to mean retracted, not re-armed.
    expect(loopStarts).not.toHaveBeenCalled();
  });
});
