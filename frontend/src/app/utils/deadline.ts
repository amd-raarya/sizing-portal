/**
 * Sizing deadlines are calendar dates. A draft is auto-submitted at 5:00 PM Toronto time
 * (America/Toronto — EDT or EST depending on the date) on that date. These helpers keep the
 * UI in step with the backend cron, regardless of the viewer's own time zone.
 */
export const DEADLINE_TZ = 'America/Toronto';
export const DEADLINE_CUTOFF_HOUR = 17;
export const DEADLINE_CUTOFF_LABEL = '5:00 PM Toronto time';

const torontoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEADLINE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});

/** Normalises an API value ('2026-10-23' or an ISO timestamp) to 'YYYY-MM-DD'. */
export function deadlineDateString(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return toLocalYmd(value);
  return String(value).slice(0, 10);
}

/** Toronto calendar date ('YYYY-MM-DD') and hour right now. */
export function torontoNow(now: Date = new Date()): { date: string; hour: number } {
  const p: Record<string, string> = {};
  for (const part of torontoFmt.formatToParts(now)) p[part.type] = part.value;
  return { date: `${p['year']}-${p['month']}-${p['day']}`, hour: Number(p['hour']) };
}

/** True once it is 5 PM Toronto time on the deadline date (or any later day). */
export function isDeadlinePassed(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  const d = deadlineDateString(value);
  if (!d) return false;
  const t = torontoNow(now);
  return t.date > d || (t.date === d && t.hour >= DEADLINE_CUTOFF_HOUR);
}

/** Whole calendar days from today (Toronto) to the deadline date: 0 = due today, negative = past. */
export function daysUntilDeadline(value: string | Date | null | undefined, now: Date = new Date()): number {
  const d = deadlineDateString(value);
  if (!d) return 999;
  const t = torontoNow(now).date;
  return Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(t + 'T00:00:00Z')) / 86400000);
}

/** A local-midnight Date for a datepicker, built from the calendar date (no UTC shift). */
export function deadlineToLocalDate(value: string | Date | null | undefined): Date | null {
  const d = deadlineDateString(value);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}

/** 'YYYY-MM-DD' from a Date's local calendar fields (toISOString would shift the day east of UTC). */
export function toLocalYmd(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mm}-${dd}`;
}
