import {
  formatRelativeAge,
  dataStatus,
  departuresSourceLabel,
} from "@/src/utils/freshness";

const MIN = 60_000;
const HR = 60 * MIN;

describe("formatRelativeAge", () => {
  it("shows 'just now' under 45s", () => {
    expect(formatRelativeAge(0, 10_000)).toBe("just now");
  });
  it("shows minutes", () => {
    expect(formatRelativeAge(0, 6 * MIN)).toBe("6 min ago");
  });
  it("shows hours", () => {
    expect(formatRelativeAge(0, 2 * HR)).toBe("2 hr ago");
  });
  it("shows days (with pluralization)", () => {
    expect(formatRelativeAge(0, 24 * HR)).toBe("1 day ago");
    expect(formatRelativeAge(0, 72 * HR)).toBe("3 days ago");
  });
  it("never goes negative", () => {
    expect(formatRelativeAge(1000, 0)).toBe("just now");
  });
});

describe("dataStatus", () => {
  it("live: online, fresh, no error → no banner", () => {
    const s = dataStatus({ online: true, isError: false, hasLiveData: true, cacheAgeMs: 5 * MIN });
    expect(s.kind).toBe("live");
    expect(s.banner).toBeNull();
  });

  it("offline with cache → offline banner showing age", () => {
    const s = dataStatus({ online: false, isError: false, hasLiveData: false, cacheAgeMs: 6 * MIN });
    expect(s.kind).toBe("offline");
    expect(s.banner).toBe("Offline — showing data from 6 min ago");
  });

  it("online error with cache → 'live data unavailable' banner", () => {
    const s = dataStatus({ online: true, isError: true, hasLiveData: false, cacheAgeMs: 2 * MIN });
    expect(s.kind).toBe("offline");
    expect(s.banner).toBe("Live data unavailable — showing data from 2 min ago");
  });

  it("offline with no cache → no-data", () => {
    const s = dataStatus({ online: false, isError: false, hasLiveData: false, cacheAgeMs: null });
    expect(s.kind).toBe("no-data");
    expect(s.banner).toBe("You're offline");
  });

  it("online error, no cache → no-data with load-failure message", () => {
    const s = dataStatus({ online: true, isError: true, hasLiveData: false, cacheAgeMs: null });
    expect(s.kind).toBe("no-data");
    expect(s.banner).toBe("Couldn't load live data");
  });

  it("online, refreshing, cache present → stale", () => {
    const s = dataStatus({ online: true, isError: false, hasLiveData: false, cacheAgeMs: 1 * MIN });
    expect(s.kind).toBe("stale");
    expect(s.banner).toContain("Updating");
  });
});

describe("departuresSourceLabel", () => {
  it("maps realtime → Live", () => {
    expect(departuresSourceLabel("realtime")).toBe("Live");
  });
  it("maps scheduled / undefined → Scheduled", () => {
    expect(departuresSourceLabel("scheduled")).toBe("Scheduled");
    expect(departuresSourceLabel(undefined)).toBe("Scheduled");
  });
});
