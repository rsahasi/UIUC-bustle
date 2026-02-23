import type { ScheduleClass } from "@/src/api/types";

const DAY_TO_CODE: Record<number, string> = {
  0: "SUN",
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THU",
  5: "FRI",
  6: "SAT",
};

/** Parse "HH:MM" to minutes since midnight. */
function parseTime(s: string): number {
  const [h, m] = s.split(":").map(Number);
  if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return -1;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

/** Get today's weekday code (MON .. SUN). */
export function getTodayCode(date: Date): string {
  return DAY_TO_CODE[date.getDay()] ?? "SUN";
}

/**
 * Next upcoming class today based on local time. Deterministic: schedule + time only.
 * Returns the first class that is (1) on today's weekday and (2) start_time_local > now (minutes since midnight).
 * If no such class, returns null ("no more classes today").
 */
export function getNextClassToday(
  classes: ScheduleClass[],
  now: Date = new Date()
): ScheduleClass | null {
  const today = getTodayCode(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const todayClasses = classes.filter(
    (c) => c.days_of_week && c.days_of_week.includes(today)
  );
  if (todayClasses.length === 0) return null;

  let best: ScheduleClass | null = null;
  let bestMins = 24 * 60 + 1;
  for (const c of todayClasses) {
    const mins = parseTime(c.start_time_local);
    if (mins < 0) continue;
    if (mins > nowMins && mins < bestMins) {
      bestMins = mins;
      best = c;
    }
  }
  return best;
}
