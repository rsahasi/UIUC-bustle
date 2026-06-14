import { arriveByIsoToday } from "@/src/utils/arriveBy";

describe("arriveByIsoToday", () => {
  it("returns an ISO string for today at the given local time", () => {
    const iso = arriveByIsoToday("14:30");
    const d = new Date(iso);
    const now = new Date();
    expect(d.getFullYear()).toBe(now.getFullYear());
    expect(d.getMonth()).toBe(now.getMonth());
    expect(d.getDate()).toBe(now.getDate());
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    // Valid round-trippable ISO 8601 (ends in Z / UTC).
    expect(iso).toMatch(/T.*Z$/);
  });

  it("defaults missing minutes to 0", () => {
    const d = new Date(arriveByIsoToday("09"));
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });
});
