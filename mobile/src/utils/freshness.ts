/**
 * Pure helpers for honest "how fresh / where did this come from" UI state on the
 * commute screen. No React or I/O — fully unit-testable. The screen feeds in
 * online/error/cache-age and renders whatever `dataStatus` decides.
 */

/** Human-readable age of cached data, e.g. "just now", "6 min ago", "2 hr ago". */
export function formatRelativeAge(savedAtMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - savedAtMs) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type DataKind = "live" | "stale" | "offline" | "no-data";

export interface DataStatus {
  kind: DataKind;
  /** Banner text to show, or null when data is live (no banner needed). */
  banner: string | null;
  /** Short age suffix, e.g. "6 min ago" (empty when not applicable). */
  ageLabel: string;
}

export interface DataStatusInput {
  online: boolean;
  isError: boolean;
  hasLiveData: boolean;
  /** Age of the cached snapshot in ms, or null if there is no cache. */
  cacheAgeMs: number | null;
}

/**
 * Decide what the commute screen should communicate.
 * - live:      online and fresh data loaded → no banner.
 * - stale:     showing cached data while a refresh is pending/failing, but we're
 *              online (transient) → soft banner with age.
 * - offline:   offline (or errored) but we have a cached snapshot to show.
 * - no-data:   offline/errored and nothing cached → honest empty state.
 */
export function dataStatus(input: DataStatusInput): DataStatus {
  const { online, isError, hasLiveData, cacheAgeMs } = input;

  if (hasLiveData && online && !isError) {
    return { kind: "live", banner: null, ageLabel: "" };
  }

  const hasCache = cacheAgeMs != null;
  if (!online || isError) {
    if (hasCache) {
      const ago = formatRelativeAge(0, cacheAgeMs!); // cacheAgeMs is the age, so render directly
      return {
        kind: "offline",
        banner: `${online ? "Live data unavailable" : "Offline"} — showing data from ${ago}`,
        ageLabel: ago,
      };
    }
    return {
      kind: "no-data",
      banner: online ? "Couldn't load live data" : "You're offline",
      ageLabel: "",
    };
  }

  // Online, no error, but live data not yet present and we have a cache → stale.
  if (hasCache) {
    const ago = formatRelativeAge(0, cacheAgeMs!);
    return { kind: "stale", banner: `Updating… showing data from ${ago}`, ageLabel: ago };
  }
  return { kind: "no-data", banner: null, ageLabel: "" };
}

/** Label for whether departures are live or scheduled (GTFS) times. */
export function departuresSourceLabel(source: string | undefined): "Live" | "Scheduled" {
  return source === "realtime" ? "Live" : "Scheduled";
}
