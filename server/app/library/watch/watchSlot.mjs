const WATCH_SLOT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/;

export function parseWatchSlot(value, now = new Date()) {
  if (value === null) {
    const currentSlot = new Date(now);
    currentSlot.setUTCSeconds(0, 0);
    return { date: currentSlot, slotStart: currentSlot.toISOString() };
  }

  if (typeof value !== "string" || !WATCH_SLOT_PATTERN.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) return null;

  return { date, slotStart: value };
}
