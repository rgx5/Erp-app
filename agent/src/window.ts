export interface MaintenanceWindow { days: number[]; startHour: number; durationHours: number; timezone: string }

/** Is this moment inside the site's maintenance window (days of the week, 0 = Sunday, from a start hour, in the site's time zone)? A window may run past midnight. */
export function inWindow(now: Date, w: MaintenanceWindow): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: w.timezone, weekday: 'short', hour: '2-digit', hourCycle: 'h23', minute: '2-digit' }).formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const start = w.startHour * 60; const end = start + w.durationHours * 60;
  if (w.days.includes(day) && minutes >= start && minutes < Math.min(end, 24 * 60)) return true;
  // the part of a window that ran past midnight belongs to the previous day
  return end > 24 * 60 && w.days.includes((day + 6) % 7) && minutes < end - 24 * 60;
}
