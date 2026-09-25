export type WatchSchedule =
  | { mode: "all"; reason: "business_hours" | "reduced_business_hours" }
  | { mode: "round_robin"; reason: "low_traffic" | "holiday" | "holiday_data_unavailable" }
  | { mode: "skip"; reason: "reduced_business_hours_interval" };

type HolidayResponse = {
  holidays: Array<{ date: string; name: string }>;
};

type HolidayCache = {
  dates: Set<string>;
  fetchedAt: number;
};

const JAPAN_TIME_ZONE = "Asia/Tokyo";
const HOLIDAY_CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
const HOLIDAY_FETCH_RETRY_DELAY_MS = 60 * 60 * 1000;
const HOLIDAY_REQUEST_TIMEOUT_MS = 5_000;
const holidayCache = new Map<number, HolidayCache>();
const holidayRetryAfter = new Map<number, number>();

function getJstParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JAPAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    year: Number(values.year),
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

async function getHolidayDates(year: number, now: number): Promise<Set<string> | null> {
  const cached = holidayCache.get(year);
  if (cached && now - cached.fetchedAt < HOLIDAY_CACHE_DURATION_MS) {
    return cached.dates;
  }
  if (now < (holidayRetryAfter.get(year) ?? 0)) {
    return cached?.dates ?? null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HOLIDAY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`https://holidays-jp.shogo82148.com/${year}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Holiday API returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as HolidayResponse;
    if (!Array.isArray(payload.holidays)) {
      throw new Error("Holiday API response did not contain a holiday list");
    }

    const dates = new Set(payload.holidays.map(({ date }) => date));
    holidayCache.set(year, { dates, fetchedAt: now });
    holidayRetryAfter.delete(year);
    return dates;
  } catch (error) {
    console.error("祝日一覧を取得できませんでした。保持済みの一覧を確認します。", error);
    holidayRetryAfter.set(year, now + HOLIDAY_FETCH_RETRY_DELAY_MS);
    return cached?.dates ?? null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getWatchSchedule(date: Date = new Date()): Promise<WatchSchedule> {
  const { dateKey, year, weekday, hour, minute } = getJstParts(date);
  const isWeekday = weekday !== "Sat" && weekday !== "Sun";

  if (!isWeekday) {
    return { mode: "round_robin", reason: "low_traffic" };
  }

  const holidayDates = await getHolidayDates(year, date.getTime());
  if (!holidayDates) {
    return { mode: "round_robin", reason: "holiday_data_unavailable" };
  }
  if (holidayDates.has(dateKey)) {
    return { mode: "round_robin", reason: "holiday" };
  }

  if (hour >= 9 && hour < 18) {
    return { mode: "all", reason: "business_hours" };
  }

  const isReducedBusinessHours = hour === 8 || hour === 18;
  if (isReducedBusinessHours) {
    return minute % 5 === 0
      ? { mode: "all", reason: "reduced_business_hours" }
      : { mode: "skip", reason: "reduced_business_hours_interval" };
  }

  return { mode: "round_robin", reason: "low_traffic" };
}

export function getUtcMinute(date: Date): string {
  const slotStart = new Date(date);
  slotStart.setUTCSeconds(0, 0);
  return slotStart.toISOString();
}
