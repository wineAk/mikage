export function parseWatchConfig(environment) {
  const enabled = environment.WATCH_SCHEDULER_ENABLED;
  if (enabled !== "true" && enabled !== "false") {
    throw new Error("WATCH_SCHEDULER_ENABLEDはtrueまたはfalseで明示してください。");
  }
  if (enabled === "false") return null;

  const rawUrl = environment.MIKAGE_RENDER_WATCH_URL;
  const token = environment.MIKAGE_WATCH_EXECUTE_TOKEN;
  if (!rawUrl || !token) throw new Error("Render監視起動設定が未完了です。");

  let watchUrl;
  try {
    watchUrl = new URL(rawUrl);
  } catch {
    throw new Error("Render監視URLの形式が不正です。");
  }
  if (
    watchUrl.protocol !== "https:" ||
    watchUrl.username ||
    watchUrl.password ||
    watchUrl.search ||
    watchUrl.hash ||
    watchUrl.pathname !== "/api/v1/watch"
  ) {
    throw new Error("Render監視URLはqueryなしのHTTPS /api/v1/watchである必要があります。");
  }
  return { watchUrl, token };
}

export function millisecondsUntilNextMinute(now = Date.now()) {
  const remainder = now % 60_000;
  return remainder === 0 ? 60_000 : 60_000 - remainder;
}

export function getWatchSlotStart(pendingSlotStart, now = new Date()) {
  if (
    typeof pendingSlotStart === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(pendingSlotStart)
    && new Date(pendingSlotStart).toISOString() === pendingSlotStart
  ) {
    return pendingSlotStart;
  }

  const slotStart = new Date(now);
  slotStart.setUTCSeconds(0, 0);
  return slotStart.toISOString();
}

export async function runWatchTick({ watchUrl, token, slotStart, fetchImpl = fetch, timeoutMs = 90_000 }) {
  const response = await fetchImpl(watchUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-Mikage-Watch-Slot": getWatchSlotStart(slotStart),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { ok: response.ok, status: response.status };
}
