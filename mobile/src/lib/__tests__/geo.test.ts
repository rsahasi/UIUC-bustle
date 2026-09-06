import {
  bearingDeg,
  lerpLatLng,
  normalizeDeg,
  shortestAngleDelta,
} from "@/src/lib/geo";

describe("shortestAngleDelta", () => {
  it("crosses the 0/360 seam forwards", () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(359, 1)).toBe(2);
  });

  it("crosses the 0/360 seam backwards", () => {
    expect(shortestAngleDelta(10, 350)).toBe(-20);
    expect(shortestAngleDelta(1, 359)).toBe(-2);
  });

  it("never returns the long way round", () => {
    for (let from = 0; from < 360; from += 7) {
      for (let to = 0; to < 360; to += 11) {
        const d = shortestAngleDelta(from, to);
        expect(Math.abs(d)).toBeLessThanOrEqual(180);
        // Applying the delta lands on the target heading.
        expect(normalizeDeg(from + d)).toBeCloseTo(normalizeDeg(to), 6);
      }
    }
  });

  it("handles exact 180 with a stable sign", () => {
    expect(shortestAngleDelta(0, 180)).toBe(180);
    expect(shortestAngleDelta(180, 0)).toBe(-180);
    expect(Math.abs(shortestAngleDelta(90, 270))).toBe(180);
  });

  it("is zero for equal angles", () => {
    expect(shortestAngleDelta(0, 0)).toBe(0);
    expect(shortestAngleDelta(137, 137)).toBe(0);
    expect(shortestAngleDelta(0, 360)).toBe(0);
  });

  it("normalises unwrapped inputs", () => {
    expect(shortestAngleDelta(-10, 370)).toBe(20);
    expect(shortestAngleDelta(710, 10)).toBe(20);
    expect(shortestAngleDelta(-350, 10)).toBe(0);
  });

  it("returns 0 for non-finite input instead of NaN", () => {
    expect(shortestAngleDelta(NaN, 10)).toBe(0);
    expect(shortestAngleDelta(10, Infinity)).toBe(0);
  });
});

describe("normalizeDeg", () => {
  it("wraps into [0, 360)", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(450)).toBe(90);
    expect(normalizeDeg(-720)).toBe(0);
  });

  it("returns 0 for non-finite input", () => {
    expect(normalizeDeg(NaN)).toBe(0);
  });

  it("returns +0 rather than -0", () => {
    expect(Object.is(normalizeDeg(-720), 0)).toBe(true);
    expect(Object.is(shortestAngleDelta(10, -350), 0)).toBe(true);
  });
});

describe("lerpLatLng", () => {
  const a = { latitude: 40.1, longitude: -88.2 };
  const b = { latitude: 40.2, longitude: -88.4 };

  it("returns the start exactly at t = 0", () => {
    expect(lerpLatLng(a, b, 0)).toEqual(a);
  });

  it("returns the end exactly at t = 1", () => {
    expect(lerpLatLng(a, b, 1)).toEqual(b);
  });

  it("returns the midpoint at t = 0.5", () => {
    const m = lerpLatLng(a, b, 0.5);
    expect(m.latitude).toBeCloseTo(40.15, 10);
    expect(m.longitude).toBeCloseTo(-88.3, 10);
  });

  it("clamps t outside [0, 1]", () => {
    expect(lerpLatLng(a, b, -2)).toEqual(a);
    expect(lerpLatLng(a, b, 9)).toEqual(b);
  });

  it("takes the short way across the antimeridian", () => {
    const west = { latitude: 0, longitude: 179 };
    const east = { latitude: 0, longitude: -179 };
    const m = lerpLatLng(west, east, 0.5);
    expect(Math.abs(m.longitude)).toBeCloseTo(180, 6);
    const quarter = lerpLatLng(west, east, 0.25);
    expect(quarter.longitude).toBeCloseTo(179.5, 6);
  });

  it("keeps longitude inside [-180, 180]", () => {
    const m = lerpLatLng(
      { latitude: 0, longitude: 179 },
      { latitude: 0, longitude: -179 },
      0.75
    );
    expect(m.longitude).toBeGreaterThanOrEqual(-180);
    expect(m.longitude).toBeLessThanOrEqual(180);
    expect(m.longitude).toBeCloseTo(-179.5, 6);
  });

  it("keeps longitude in range for unwrapped input beyond +/-360", () => {
    for (const [alon, blon] of [
      [540, 545],
      [-540, -545],
      [200, 210],
      [400, 410],
      [-1080, -1075],
    ]) {
      for (const t of [0.25, 0.5, 0.75]) {
        const m = lerpLatLng(
          { latitude: 0, longitude: alon },
          { latitude: 0, longitude: blon },
          t
        );
        expect(m.longitude).toBeGreaterThanOrEqual(-180);
        expect(m.longitude).toBeLessThanOrEqual(180);
      }
    }
    // 540 == 180 and 545 == -175, so the midpoint is 182.5 == -177.5.
    expect(
      lerpLatLng(
        { latitude: 0, longitude: 540 },
        { latitude: 0, longitude: 545 },
        0.5
      ).longitude
    ).toBeCloseTo(-177.5, 6);
  });

  it("leaves in-range longitudes bit-identical (no +180 -> -180 flip)", () => {
    expect(
      lerpLatLng(
        { latitude: 0, longitude: 179 },
        { latitude: 0, longitude: -179 },
        0.5
      ).longitude
    ).toBe(180);
  });
});

describe("bearingDeg", () => {
  const origin = { latitude: 40.1, longitude: -88.2 };

  it("points north at 0", () => {
    expect(bearingDeg(origin, { latitude: 40.2, longitude: -88.2 })).toBeCloseTo(
      0,
      6
    );
  });

  it("points east at 90", () => {
    expect(
      bearingDeg({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })
    ).toBeCloseTo(90, 6);
  });

  it("points south at 180", () => {
    expect(bearingDeg(origin, { latitude: 40.0, longitude: -88.2 })).toBeCloseTo(
      180,
      6
    );
  });

  it("points west at 270", () => {
    expect(
      bearingDeg({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: -1 })
    ).toBeCloseTo(270, 6);
  });

  it("stays inside [0, 360)", () => {
    for (let i = 0; i < 36; i++) {
      const th = (i * 10 * Math.PI) / 180;
      const to = {
        latitude: origin.latitude + 0.01 * Math.cos(th),
        longitude: origin.longitude + 0.01 * Math.sin(th),
      };
      const bd = bearingDeg(origin, to);
      expect(bd).toBeGreaterThanOrEqual(0);
      expect(bd).toBeLessThan(360);
    }
  });

  it("returns 0 for identical points", () => {
    expect(bearingDeg(origin, { ...origin })).toBe(0);
  });
});
