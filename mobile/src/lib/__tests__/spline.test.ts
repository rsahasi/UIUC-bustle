import {
  buildSpline,
  flattenXY,
  morphD,
  pointAtLength,
} from "@/src/lib/spline";

const TWO_PI = Math.PI * 2;

function circlePoints(r: number, n: number): { x: number; y: number }[] {
  // n segments around a full circle, closing back on the start point.
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (TWO_PI * i) / n;
    out.push({ x: r * Math.cos(th), y: r * Math.sin(th) });
  }
  return out;
}

describe("buildSpline arc length", () => {
  it("matches the circumference of a sampled circle within ~1%", () => {
    const r = 100;
    const s = buildSpline(circlePoints(r, 64));
    const expected = TWO_PI * r;
    expect(Math.abs(s.length - expected) / expected).toBeLessThan(0.01);
  });

  it("stays within ~1% on a coarsely sampled circle too", () => {
    const r = 40;
    const s = buildSpline(circlePoints(r, 16));
    const expected = TWO_PI * r;
    expect(Math.abs(s.length - expected) / expected).toBeLessThan(0.01);
  });

  it("equals the distance for a straight two-point line", () => {
    const s = buildSpline([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ]);
    expect(s.length).toBeCloseTo(50, 3);
    expect(s.d).toBe("M 0,0 L 30,40");
  });

  it("equals the summed distance for collinear points", () => {
    const s = buildSpline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 25, y: 0 },
      { x: 60, y: 0 },
    ]);
    expect(s.length).toBeCloseTo(60, 1);
  });

  it("reports cum as a monotonic ramp ending at length", () => {
    const s = buildSpline([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
      { x: 20, y: 5 },
      { x: 30, y: 25 },
    ]);
    expect(s.cum[0]).toBe(0);
    expect(s.cum[s.cum.length - 1]).toBe(s.length);
    for (let i = 1; i < s.cum.length; i++) {
      expect(s.cum[i]).toBeGreaterThanOrEqual(s.cum[i - 1]);
    }
  });
});

describe("buildSpline output shape", () => {
  it("returns Float32Arrays of equal, expected length", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: 3 },
    ];
    const s = buildSpline(pts, { samplesPerSeg: 8 });
    expect(s.xs).toBeInstanceOf(Float32Array);
    expect(s.ys).toBeInstanceOf(Float32Array);
    expect(s.cum).toBeInstanceOf(Float32Array);
    expect(s.xs.length).toBe(2 * 8 + 1);
    expect(s.ys.length).toBe(s.xs.length);
    expect(s.cum.length).toBe(s.xs.length);
  });

  it("starts at the first point and ends at the last", () => {
    const pts = [
      { x: 3, y: 7 },
      { x: 11, y: 2 },
      { x: 19, y: 9 },
    ];
    const s = buildSpline(pts);
    expect(s.xs[0]).toBeCloseTo(3, 3);
    expect(s.ys[0]).toBeCloseTo(7, 3);
    expect(s.xs[s.xs.length - 1]).toBeCloseTo(19, 3);
    expect(s.ys[s.ys.length - 1]).toBeCloseTo(9, 3);
  });

  it("rounds every emitted coordinate to at most 2dp", () => {
    const s = buildSpline([
      { x: 0.123456, y: 1.987654 },
      { x: 5.555555, y: 2.333333 },
      { x: 9.999999, y: 0.111111 },
    ]);
    const nums = s.d.match(/-?\d+(\.\d+)?/g) ?? [];
    expect(nums.length).toBeGreaterThan(0);
    for (const nstr of nums) {
      const dot = nstr.indexOf(".");
      if (dot >= 0) expect(nstr.length - dot - 1).toBeLessThanOrEqual(2);
    }
  });

  it("closes the area path down to the baseline", () => {
    const s = buildSpline(
      [
        { x: 0, y: 10 },
        { x: 5, y: 4 },
        { x: 10, y: 8 },
      ],
      { baseline: 100 }
    );
    expect(s.area.startsWith(s.d)).toBe(true);
    expect(s.area.endsWith("L 10,100 L 0,100 Z")).toBe(true);
  });

  it("defaults the area baseline to 0", () => {
    const s = buildSpline([
      { x: 0, y: 10 },
      { x: 5, y: 4 },
      { x: 10, y: 8 },
    ]);
    expect(s.area.endsWith("L 10,0 L 0,0 Z")).toBe(true);
  });
});

describe("buildSpline degenerate inputs", () => {
  it("handles zero points", () => {
    const s = buildSpline([]);
    expect(s.d).toBe("");
    expect(s.area).toBe("");
    expect(s.length).toBe(0);
    expect(s.xs.length).toBe(0);
    expect(s.ys.length).toBe(0);
    expect(s.cum.length).toBe(0);
  });

  it("handles a single point", () => {
    const s = buildSpline([{ x: 4, y: 6 }], { baseline: 20 });
    expect(s.d).toBe("M 4,6");
    expect(s.area).toBe("M 4,6 L 4,20 Z");
    expect(s.length).toBe(0);
    expect(s.xs.length).toBe(1);
    expect(s.cum[0]).toBe(0);
  });

  it("handles two identical points", () => {
    const s = buildSpline([
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(s.length).toBe(0);
    expect(s.d).not.toMatch(/NaN|Infinity/);
  });

  it("handles repeated identical points in the middle without dividing by zero", () => {
    const s = buildSpline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(s.d).not.toMatch(/NaN|Infinity/);
    expect(s.area).not.toMatch(/NaN|Infinity/);
    expect(Number.isFinite(s.length)).toBe(true);
    expect(s.length).toBeCloseTo(20, 1);
    for (let i = 0; i < s.xs.length; i++) {
      expect(Number.isFinite(s.xs[i])).toBe(true);
      expect(Number.isFinite(s.ys[i])).toBe(true);
      expect(Number.isFinite(s.cum[i])).toBe(true);
    }
  });

  it("handles every point being identical", () => {
    const same = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ];
    const s = buildSpline(same);
    expect(s.length).toBe(0);
    expect(s.d).not.toMatch(/NaN|Infinity/);
  });

  it("clamps samplesPerSeg to at least 1", () => {
    const s = buildSpline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ],
      { samplesPerSeg: 0 }
    );
    expect(s.xs.length).toBe(3);
  });
});

describe("pointAtLength", () => {
  const line = buildSpline([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);

  it("returns the start at s = 0", () => {
    const p = pointAtLength(line.xs, line.ys, line.cum, 0);
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.y).toBeCloseTo(0, 4);
  });

  it("returns the end at s = length", () => {
    const p = pointAtLength(line.xs, line.ys, line.cum, line.length);
    expect(p.x).toBeCloseTo(100, 4);
    expect(p.y).toBeCloseTo(0, 4);
  });

  it("returns the midpoint at s = length / 2", () => {
    const p = pointAtLength(line.xs, line.ys, line.cum, line.length / 2);
    expect(p.x).toBeCloseTo(50, 3);
    expect(p.y).toBeCloseTo(0, 4);
  });

  it("clamps outside [0, length]", () => {
    const before = pointAtLength(line.xs, line.ys, line.cum, -25);
    const after = pointAtLength(line.xs, line.ys, line.cum, line.length * 3);
    expect(before.x).toBeCloseTo(0, 4);
    expect(after.x).toBeCloseTo(100, 4);
  });

  it("walks a dense multi-segment curve monotonically", () => {
    const s = buildSpline([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 150, y: 0 },
    ]);
    const mid = pointAtLength(s.xs, s.ys, s.cum, s.length / 2);
    expect(mid.x).toBeCloseTo(75, 1);
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const p = pointAtLength(s.xs, s.ys, s.cum, (s.length * i) / 10);
      expect(p.x).toBeGreaterThanOrEqual(prev - 1e-4);
      prev = p.x;
    }
  });

  it("survives empty and single-sample inputs", () => {
    const empty = new Float32Array(0);
    expect(pointAtLength(empty, empty, empty, 10)).toEqual({ x: 0, y: 0 });
    const one = buildSpline([{ x: 8, y: 9 }]);
    const p = pointAtLength(one.xs, one.ys, one.cum, 5);
    expect(p).toEqual({ x: 8, y: 9 });
  });

  it("returns the start for NaN", () => {
    const p = pointAtLength(line.xs, line.ys, line.cum, NaN);
    expect(p.x).toBeCloseTo(0, 4);
  });
});

describe("flattenXY", () => {
  it("interleaves x and y", () => {
    const xs = Float32Array.from([1, 2, 3]);
    const ys = Float32Array.from([4, 5, 6]);
    expect(Array.from(flattenXY(xs, ys))).toEqual([1, 4, 2, 5, 3, 6]);
  });
});

describe("morphD", () => {
  const a = Float32Array.from([0, 0, 10, 10, 20, 0]);
  const b = Float32Array.from([0, 20, 10, 30, 20, 20]);

  it("returns the first shape at t = 0", () => {
    expect(morphD(a, b, 0)).toBe("M 0,0 L 10,10 L 20,0");
  });

  it("returns the second shape at t = 1", () => {
    expect(morphD(a, b, 1)).toBe("M 0,20 L 10,30 L 20,20");
  });

  it("interpolates in between", () => {
    expect(morphD(a, b, 0.5)).toBe("M 0,10 L 10,20 L 20,10");
  });

  it("clamps t outside [0, 1]", () => {
    expect(morphD(a, b, -3)).toBe(morphD(a, b, 0));
    expect(morphD(a, b, 4)).toBe(morphD(a, b, 1));
  });

  it("uses the shorter input rather than throwing on a topology mismatch", () => {
    const short = Float32Array.from([0, 0, 5, 5]);
    expect(morphD(a, short, 1)).toBe("M 0,0 L 5,5");
  });

  it("returns an empty string for empty input", () => {
    const empty = new Float32Array(0);
    expect(morphD(empty, empty, 0.5)).toBe("");
    expect(morphD(a, empty, 0.5)).toBe("");
  });

  it("round-trips a spline's own samples", () => {
    const s = buildSpline([
      { x: 0, y: 0 },
      { x: 10, y: 8 },
      { x: 20, y: 2 },
    ]);
    const flat = flattenXY(s.xs, s.ys);
    const d0 = morphD(flat, flat, 0);
    expect(d0).toBe(morphD(flat, flat, 1));
    expect(d0.startsWith("M 0,0")).toBe(true);
    expect(d0).not.toMatch(/NaN/);
  });
});
