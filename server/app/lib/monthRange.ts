const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getJstMonthRange(offset: number, now = new Date()) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("月の指定が不正です。");
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jstNow.getUTCFullYear();
  const month = jstNow.getUTCMonth() - offset;
  return {
    start: new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS).toISOString(),
    end: new Date(Date.UTC(year, month + 1, 1) - JST_OFFSET_MS).toISOString(),
    previousStart: new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS).toISOString(),
    nextEnd: new Date(Date.UTC(year, month + 2, 1) - JST_OFFSET_MS).toISOString(),
  };
}
