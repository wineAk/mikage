export const homeMinutes = ["10", "30", "60*1", "60*3", "60*6", "60*12", "60*24", "60*24*3", "60*24*7", "60*24*14", "60*24*28"];
export const MAX_MONTH_OFFSET = 120;

export function readHomeMinute(value: string | null): string {
  return value !== null && homeMinutes.includes(value) ? value : "60*1";
}

export function minuteValue(value: string): number {
  return readHomeMinute(value).split("*").map(Number).reduce((total, factor) => total * factor, 1);
}

export function readMonthOffset(value: string | null): number {
  return value !== null && /^\d+$/.test(value) ? Math.min(MAX_MONTH_OFFSET, Number(value)) : 0;
}
