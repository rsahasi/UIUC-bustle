/**
 * Pure-TS centripetal Catmull-Rom spline builder plus worklet-safe sampling
 * helpers. Zero dependencies: this module is imported from both the JS thread
 * (to build a path) and the UI thread (to sample or morph one), so it must not
 * touch React, Reanimated, or any native module.
 *
 * Why centripetal (alpha = 0.5) and not uniform: uniform Catmull-Rom produces
 * cusps and self-intersections whenever consecutive points are unevenly
 * spaced, which is exactly what a departures/crowding chart looks like.
 * Centripetal parameterisation is provably free of both.
 *
 * Why Float32Array for xs/ys/cum: capturing a typed array in a worklet is a
 * memcpy into the UI-thread heap. Capturing a plain number[] is a structured
 * clone of every boxed element, per closure, per animation.
 */

/** A 2D point in the caller's own coordinate space (usually SVG user units). */
export type Point = { x: number; y: number };

export type Spline = {
  /** SVG path data for the stroked curve: "M x,y C ..." (coords rounded 2dp). */
  d: string;
  /** Same curve, closed down to `baseline`, for gradient area fills. */
  area: string;
  /** Arc length of the sampled polyline, in the caller's units. */
  length: number;
  /** Sampled x coordinates along the curve (dense, evenly spaced in t). */
  xs: Float32Array;
  /** Sampled y coordinates, index-aligned with `xs`. */
  ys: Float32Array;
  /** Cumulative arc length at each sample; cum[0] === 0, last === length. */
  cum: Float32Array;
};

export type BuildSplineOptions = {
  /** Knot parameterisation exponent. 0 = uniform, 0.5 = centripetal (default), 1 = chordal. */
  alpha?: number;
  /** Samples emitted per Bezier segment (>= 1). Default 16. */
  samplesPerSeg?: number;
  /** y value the `area` path closes down to. Default 0. */
  baseline?: number;
};

const EPS = 1e-9;
const DEFAULT_SAMPLES_PER_SEG = 16;

/** Round to 2dp and drop non-finite values, so path strings stay short and valid. */
function r2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function fmt(x: number, y: number): string {
  return `${r2(x)},${r2(y)}`;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

const EMPTY_F32 = new Float32Array(0);

function emptySpline(): Spline {
  return {
    d: "",
    area: "",
    length: 0,
    xs: EMPTY_F32,
    ys: EMPTY_F32,
    cum: EMPTY_F32,
  };
}

/**
 * Build a smooth curve through `pts` in a single pass, returning both the SVG
 * path strings and the sampled polyline used for length-based animation.
 *
 * Endpoints are MIRRORED (p[-1] = 2*p0 - p1) rather than duplicated. Duplicating
 * the endpoint zeroes the end tangent and leaves a visible flat spot at each end
 * of the chart.
 *
 * Degenerate inputs are handled rather than thrown on: 0 points yields an empty
 * spline, 1 point yields a bare moveto, 2 points yield an exact straight line,
 * and repeated identical points collapse to straight handles instead of
 * dividing by zero in the alpha exponent.
 */
export function buildSpline(
  pts: { x: number; y: number }[],
  opts?: BuildSplineOptions
): Spline {
  const n = pts ? pts.length : 0;
  const baseline = opts?.baseline ?? 0;
  const alpha = opts?.alpha ?? 0.5;
  const rawSamples = opts?.samplesPerSeg ?? DEFAULT_SAMPLES_PER_SEG;
  const S = Math.max(1, Math.floor(rawSamples));

  if (n === 0) return emptySpline();

  if (n === 1) {
    const p = pts[0];
    const xs = new Float32Array(1);
    const ys = new Float32Array(1);
    const cum = new Float32Array(1);
    xs[0] = p.x;
    ys[0] = p.y;
    cum[0] = 0;
    const d = `M ${fmt(p.x, p.y)}`;
    return {
      d,
      area: `${d} L ${fmt(p.x, baseline)} Z`,
      length: 0,
      xs,
      ys,
      cum,
    };
  }

  if (n === 2) {
    // A two-point spline is a straight line; emit it exactly so the path string
    // stays short and `length` is the true distance rather than a sampled one.
    const a = pts[0];
    const b = pts[1];
    const xs = new Float32Array(2);
    const ys = new Float32Array(2);
    const cum = new Float32Array(2);
    xs[0] = a.x;
    ys[0] = a.y;
    xs[1] = b.x;
    ys[1] = b.y;
    cum[0] = 0;
    cum[1] = dist(a.x, a.y, b.x, b.y);
    const d = `M ${fmt(a.x, a.y)} L ${fmt(b.x, b.y)}`;
    return {
      d,
      area: `${d} L ${fmt(b.x, baseline)} L ${fmt(a.x, baseline)} Z`,
      length: cum[1],
      xs,
      ys,
      cum,
    };
  }

  const segCount = n - 1;
  const sampleCount = segCount * S + 1;
  const xs = new Float32Array(sampleCount);
  const ys = new Float32Array(sampleCount);
  const cum = new Float32Array(sampleCount);

  let out = `M ${fmt(pts[0].x, pts[0].y)}`;
  let w = 0;
  xs[0] = pts[0].x;
  ys[0] = pts[0].y;
  cum[0] = 0;
  let acc = 0;
  let prevX = pts[0].x;
  let prevY = pts[0].y;

  for (let i = 0; i < segCount; i++) {
    // p1 -> p2 is the segment; p0 and p3 are its neighbours (mirrored at the ends).
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p0x = i > 0 ? pts[i - 1].x : 2 * p1.x - p2.x;
    const p0y = i > 0 ? pts[i - 1].y : 2 * p1.y - p2.y;
    const p3x = i + 2 < n ? pts[i + 2].x : 2 * p2.x - p1.x;
    const p3y = i + 2 < n ? pts[i + 2].y : 2 * p2.y - p1.y;

    const raw1 = dist(p0x, p0y, p1.x, p1.y);
    const raw2 = dist(p1.x, p1.y, p2.x, p2.y);
    const raw3 = dist(p2.x, p2.y, p3x, p3y);

    let b1x: number;
    let b1y: number;
    let b2x: number;
    let b2y: number;

    // Guard the alpha exponent: a zero-length neighbour chord (a repeated
    // identical point) makes the standard denominator 3*d1*(d1+d2) vanish.
    // Fall back to the straight-line handle, which is what the limit approaches.
    if (raw1 < EPS) {
      b1x = p1.x + (p2.x - p1.x) / 3;
      b1y = p1.y + (p2.y - p1.y) / 3;
    } else {
      const d1 = Math.pow(raw1, alpha);
      const d2 = Math.pow(raw2, alpha);
      const den = 3 * d1 * (d1 + d2);
      if (!(den > EPS)) {
        b1x = p1.x + (p2.x - p1.x) / 3;
        b1y = p1.y + (p2.y - p1.y) / 3;
      } else {
        const d1sq = d1 * d1;
        const d2sq = d2 * d2;
        const k = 2 * d1sq + 3 * d1 * d2 + d2sq;
        b1x = (d1sq * p2.x - d2sq * p0x + k * p1.x) / den;
        b1y = (d1sq * p2.y - d2sq * p0y + k * p1.y) / den;
      }
    }

    if (raw3 < EPS) {
      b2x = p2.x - (p2.x - p1.x) / 3;
      b2y = p2.y - (p2.y - p1.y) / 3;
    } else {
      const d3 = Math.pow(raw3, alpha);
      const d2 = Math.pow(raw2, alpha);
      const den = 3 * d3 * (d3 + d2);
      if (!(den > EPS)) {
        b2x = p2.x - (p2.x - p1.x) / 3;
        b2y = p2.y - (p2.y - p1.y) / 3;
      } else {
        const d3sq = d3 * d3;
        const d2sq = d2 * d2;
        const k = 2 * d3sq + 3 * d3 * d2 + d2sq;
        b2x = (d3sq * p1.x - d2sq * p3x + k * p2.x) / den;
        b2y = (d3sq * p1.y - d2sq * p3y + k * p2.y) / den;
      }
    }

    if (!Number.isFinite(b1x) || !Number.isFinite(b1y)) {
      b1x = p1.x + (p2.x - p1.x) / 3;
      b1y = p1.y + (p2.y - p1.y) / 3;
    }
    if (!Number.isFinite(b2x) || !Number.isFinite(b2y)) {
      b2x = p2.x - (p2.x - p1.x) / 3;
      b2y = p2.y - (p2.y - p1.y) / 3;
    }

    out += ` C ${fmt(b1x, b1y)} ${fmt(b2x, b2y)} ${fmt(p2.x, p2.y)}`;

    for (let k = 1; k <= S; k++) {
      const t = k / S;
      const mt = 1 - t;
      const a0 = mt * mt * mt;
      const a1 = 3 * mt * mt * t;
      const a2 = 3 * mt * t * t;
      const a3 = t * t * t;
      const x = a0 * p1.x + a1 * b1x + a2 * b2x + a3 * p2.x;
      const y = a0 * p1.y + a1 * b1y + a2 * b2y + a3 * p2.y;
      acc += dist(prevX, prevY, x, y);
      w += 1;
      xs[w] = x;
      ys[w] = y;
      cum[w] = acc;
      prevX = x;
      prevY = y;
    }
  }

  const last = pts[n - 1];
  const area = `${out} L ${fmt(last.x, baseline)} L ${fmt(pts[0].x, baseline)} Z`;

  return {
    d: out,
    area,
    // Read the length back out of the Float32Array so it agrees exactly with
    // the values pointAtLength compares against.
    length: cum[sampleCount - 1],
    xs,
    ys,
    cum,
  };
}

/**
 * Position at arc length `s` along a sampled curve. Clamps to the endpoints for
 * s <= 0, s >= length, and NaN. O(log n) binary search, allocation of one small
 * object per call, safe to run every frame on the UI thread.
 */
export function pointAtLength(
  xs: Float32Array,
  ys: Float32Array,
  cum: Float32Array,
  s: number
): { x: number; y: number } {
  "worklet";
  const n = xs.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: xs[0], y: ys[0] };
  const total = cum[n - 1];
  if (!(s > 0)) return { x: xs[0], y: ys[0] };
  if (s >= total) return { x: xs[n - 1], y: ys[n - 1] };

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = cum[hi] - cum[lo];
  const f = span > 0 ? (s - cum[lo]) / span : 0;
  return {
    x: xs[lo] + (xs[hi] - xs[lo]) * f,
    y: ys[lo] + (ys[hi] - ys[lo]) * f,
  };
}

/**
 * Interleave separate x/y sample arrays into the flat [x0,y0,x1,y1,...] layout
 * `morphD` expects. Call this once on the JS thread per shape, then capture the
 * two flat arrays in the worklet.
 */
export function flattenXY(xs: Float32Array, ys: Float32Array): Float32Array {
  const n = Math.min(xs.length, ys.length);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = xs[i];
    out[i * 2 + 1] = ys[i];
  }
  return out;
}

/**
 * Interpolate between two equal-topology flat point arrays and emit an SVG path.
 * Inputs are [x0,y0,x1,y1,...] (see `flattenXY`). Both must describe the same
 * number of samples; if they differ the shorter one wins rather than throwing,
 * because a worklet throwing takes down the UI thread.
 *
 * The emitted path is a dense polyline, not a Bezier: the samples coming out of
 * buildSpline are close enough together that the two are pixel-identical, and a
 * polyline is far cheaper to rebuild 60 times a second. t is clamped to [0,1],
 * and t === 0 / t === 1 return the endpoint shapes exactly.
 */
export function morphD(a: Float32Array, b: Float32Array, t: number): string {
  "worklet";
  const pairs = Math.min(a.length, b.length) >> 1;
  if (pairs === 0) return "";
  const tc = !(t > 0) ? 0 : t > 1 ? 1 : t;

  let out = "";
  for (let i = 0; i < pairs; i++) {
    const j = i * 2;
    const ax = a[j];
    const ay = a[j + 1];
    const bx = b[j];
    const by = b[j + 1];
    let x: number;
    let y: number;
    if (tc === 0) {
      x = ax;
      y = ay;
    } else if (tc === 1) {
      x = bx;
      y = by;
    } else {
      x = ax + (bx - ax) * tc;
      y = ay + (by - ay) * tc;
    }
    const rx = Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
    const ry = Number.isFinite(y) ? Math.round(y * 100) / 100 : 0;
    out += `${i === 0 ? "M " : " L "}${rx},${ry}`;
  }
  return out;
}
