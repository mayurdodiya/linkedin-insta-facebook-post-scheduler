/**
 * Posting window: 09:00 .. 24:00, on the hour, in the user's own timezone.
 * 24:00 is midnight at the end of the day (stored as 00:00 of the following day).
 */
export const SLOT_FIRST_HOUR = 9;
export const SLOT_LAST_HOUR = 24;

/** Wall-clock parts of an instant in the given IANA timezone. */
export function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { hour: get('hour'), minute: get('minute'), second: get('second') };
}

export function isValidSlot(date: Date, timeZone: string): boolean {
  const { hour, minute, second } = localParts(date, timeZone);
  // localParts reports midnight as hour 0, so a 24:00 slot is the 00:00 that closes the day.
  const inWindow =
    SLOT_LAST_HOUR >= 24
      ? hour >= SLOT_FIRST_HOUR || hour === 0
      : hour >= SLOT_FIRST_HOUR && hour <= SLOT_LAST_HOUR;
  return inWindow && minute === 0 && second === 0 && date.getMilliseconds() === 0;
}
