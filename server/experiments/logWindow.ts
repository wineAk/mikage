import type { Key } from "@/types/api";

export type LogWindow = { start: string; end: string };
type WindowOptions = { includeStart?: boolean; includeEnd?: boolean };

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

// Date.parseで失われる小数秒の下位桁を保持して比較する。
function timestampNanoseconds(timestamp: string): bigint {
  const match = TIMESTAMP_PATTERN.exec(timestamp);
  if (!match) throw new Error("監視ログの日時が不正です。");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const milliseconds = Date.parse(timestamp);
  if (
    month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] ||
    Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59 ||
    !Number.isFinite(milliseconds)
  ) throw new Error("監視ログの日時が不正です。");
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND + BigInt(fraction.padEnd(9, "0").slice(3));
}

function getRequestedWindow(minute: number, now: Date): LogWindow {
  if (!Number.isSafeInteger(minute) || minute < 0 || !Number.isFinite(now.getTime())) {
    throw new Error("監視ログの取得期間が不正です。");
  }
  return { start: new Date(now.getTime() - minute * 60_000).toISOString(), end: now.toISOString() };
}

export function createLogWindow(minute: number, now: Date, horizonMs = 60_000): LogWindow {
  if (!Number.isSafeInteger(horizonMs) || horizonMs < 0) throw new Error("監視ログの保持期間が不正です。");
  const requested = getRequestedWindow(minute, now);
  return { start: requested.start, end: new Date(now.getTime() + horizonMs).toISOString() };
}

export function canReuseLogWindow(window: LogWindow, minute: number, now: Date): boolean {
  const requested = getRequestedWindow(minute, now);
  const start = timestampNanoseconds(window.start);
  const end = timestampNanoseconds(window.end);
  if (start > end) throw new Error("監視ログの保持期間が不正です。");
  return start <= timestampNanoseconds(requested.start) && end >= timestampNanoseconds(requested.end);
}

export function filterLogWindow(groups: Key[], minute: number, now: Date, options: WindowOptions = {}): Key[] {
  const requested = getRequestedWindow(minute, now);
  const start = timestampNanoseconds(requested.start);
  const end = timestampNanoseconds(requested.end);
  const includeStart = options.includeStart ?? true;
  const includeEnd = options.includeEnd ?? true;
  // 時間の経過だけでも最古行を除外し、取得済みの未来日時行を適切な時点で表示する。
  return groups.map(group => ({
    ...group,
    logs: group.logs.filter(log => {
      const timestamp = timestampNanoseconds(log.created_at);
      return (includeStart ? timestamp >= start : timestamp > start) && (includeEnd ? timestamp <= end : timestamp < end);
    }),
  }));
}
