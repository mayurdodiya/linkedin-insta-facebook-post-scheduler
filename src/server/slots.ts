/**
 * Scheduled posts use ONE daily slot: 10:00 in the user's timezone (IST for this app). It matches the
 * single daily cron in vercel.json (04:30 UTC = 10:00 IST) - the Vercel free plan runs cron once a day.
 * Only "Post now" (instant) publishes at any other moment.
 */
export const SLOT_FIRST_HOUR = 10;
export const SLOT_LAST_HOUR = 10;

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
