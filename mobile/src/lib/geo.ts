/**
 * Pure-TS geodesic helpers for marker glides and heading rotation.
 * Zero dependencies. lerpLatLng and shortestAngleDelta run on the UI thread
 * every frame, so they allocate at most one small object and never throw.
 */

export type LatLng = { latitude: number; longitude: number };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Wrap any angle in degrees into [0, 360). */
export function normalizeDeg(deg: number): number {
  "worklet";
  if (!Number.isFinite(deg)) return 0;
  const m = deg % 360;
  const w = m < 0 ? m + 360 : m;
  // -720 % 360 is -0; hand back +0 so callers comparing with === see a clean 0.
  return w === 0 ? 0 : w;
}

/**
 * Signed shortest rotation from `from` to `to`, in degrees, always in
 * [-180, 180].
 *
 * This is the one that matters for bus headings: 350 -> 10 must be +20, not
 * -340, or the marker spins the long way round the compass every time a vehicle
 * crosses due north. Exactly-opposite headings return +/-180 keeping the sign of
 * the raw difference, so the direction stays stable frame to frame instead of
 * flip-flopping.
 */
export function shortestAngleDelta(from: number, to: number): number {
  "worklet";
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d === 0 ? 0 : d;
}

/**
 * Wrap a longitude into [-180, 180]. Values already in range are returned
 * untouched (so an exact +180 stays +180 rather than flipping to -180); only
 * genuinely unwrapped input takes the modulo path.
 */
function wrapLon(v: number): number {
  "worklet";
  if (v >= -180 && v <= 180) return v;
  if (!Number.isFinite(v)) return 0;
  return ((((v + 180) % 360) + 360) % 360) - 180;
}

/**
 * Interpolate between two coordinates. t is clamped to [0, 1] so an overshooting
 * spring cannot fling a marker past its target, and t === 0 / t === 1 return the
 * endpoints exactly. Longitude takes the shortest path, so a track crossing the
 * antimeridian does not sweep the whole globe.
 *
 * Endpoint longitudes are wrapped first: the single-step rewrap below is only
 * sufficient when the start longitude is already in [-180, 180], so an
 * unwrapped input (|lon| > 360) would otherwise leak a result outside the range
 * this function promises.
 */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  "worklet";
  if (!(t > 0)) return { latitude: a.latitude, longitude: a.longitude };
  if (t >= 1) return { latitude: b.latitude, longitude: b.longitude };

  const aLon = wrapLon(a.longitude);
  let dLon = (wrapLon(b.longitude) - aLon) % 360;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;

  let lon = aLon + dLon * t;
  if (lon > 180) lon -= 360;
  else if (lon < -180) lon += 360;

  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: lon,
  };
}

/**
 * Initial great-circle bearing from `a` to `b`, in degrees clockwise from true
 * north, in [0, 360). Runs on the JS thread: it is computed once per position
 * update, not per frame.
 */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  if (y === 0 && x === 0) return 0;
  return normalizeDeg(Math.atan2(y, x) * RAD);
}
