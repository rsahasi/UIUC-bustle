import { getNextClassToday, getTodayCode } from "../nextClass";
import type { ScheduleClass } from "@/src/api/types";

const MON_WED_9: ScheduleClass = {
  class_id: "1",
  title: "CS 101",
  days_of_week: ["MON", "WED"],
  start_time_local: "09:00",
  building_id: "siebel",
};

const MON_14: ScheduleClass = {
  class_id: "2",
  title: "Math",
  days_of_week: ["MON"],
  start_time_local: "14:00",
  building_id: "altgeld",
};

const TUE_10: ScheduleClass = {
  class_id: "3",
  title: "TUE only",
  days_of_week: ["TUE"],
  start_time_local: "10:00",
  building_id: "grainger",
};

describe("getTodayCode", () => {
  it("returns MON for Monday", () => {
    expect(getTodayCode(new Date("2025-02-17T12:00:00"))).toBe("MON");
  });
  it("returns SUN for Sunday", () => {
    expect(getTodayCode(new Date("2025-02-16T12:00:00"))).toBe("SUN");
  });
});

describe("getNextClassToday", () => {
  it("returns next class today when one is later", () => {
    // Monday 08:00 -> next is CS 101 at 09:00
    const now = new Date("2025-02-17T08:00:00");
    const next = getNextClassToday([MON_WED_9, MON_14, TUE_10], now);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("CS 101");
  });

  it("returns later class when current time is past first", () => {
    // Monday 10:00 -> next is Math at 14:00
    const now = new Date("2025-02-17T10:00:00");
    const next = getNextClassToday([MON_WED_9, MON_14], now);
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Math");
  });

  it("returns null when no more classes today", () => {
    // Monday 15:00 -> no class after 14:00
    const now = new Date("2025-02-17T15:00:00");
    const next = getNextClassToday([MON_WED_9, MON_14], now);
    expect(next).toBeNull();
  });

  it("returns null when no classes on today's weekday", () => {
    // Tuesday: only TUE_10 at 10:00. At 11:00, no more.
    const now = new Date("2025-02-18T11:00:00");
    const next = getNextClassToday([MON_WED_9, MON_14, TUE_10], now);
    expect(next).toBeNull();
  });

  it("returns null for empty list", () => {
    expect(getNextClassToday([], new Date())).toBeNull();
  });
});
