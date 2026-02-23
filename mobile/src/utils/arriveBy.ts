/**
 * Build arrive_by ISO string for today at the given local time (HH:MM).
 */
export function arriveByIsoToday(startTimeLocal: string): string {
  const [h, m] = startTimeLocal.split(":").map(Number);
  const d = new Date();
  const arrive = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h ?? 0, m ?? 0, 0);
  return arrive.toISOString();
}
