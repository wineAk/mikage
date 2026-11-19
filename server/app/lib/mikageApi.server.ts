const GATEWAY_SOURCES = [
  "watch-targets",
  "watch-reservations",
  "watch-results",
  "watch-state",
  "watch-incidents",
  "view-targets",
  "view-logs",
  "view-errors",
  "view-incidents",
  "view-revision",
  "view-target-proxy",
] as const;

const DEFAULT_GATEWAY_ROUTE_PREFIX = "office/mikage";
const ALLOWED_GATEWAY_ROUTE_PREFIXES = new Set([
  DEFAULT_GATEWAY_ROUTE_PREFIX,
  "office/mikage-staging",
]);

export type MikageGatewaySource = typeof GATEWAY_SOURCES[number];

function getGatewayConfig() {
  const baseUrl = process.env.MIKAGE_GATEWAY_BASE_URL?.replace(/\/+$/, "");
  const token = process.env.MIKAGE_API_BEARER_TOKEN;
  const routePrefix = process.env.MIKAGE_GATEWAY_ROUTE_PREFIX ?? DEFAULT_GATEWAY_ROUTE_PREFIX;
  if (!baseUrl || !token) {
    throw new Error("ミカゲAPI Gatewayのserver環境変数が未設定です。");
  }
  const parsed = new URL(baseUrl);
  const hasValidGatewayUrl = parsed.protocol === "https:"
    && !parsed.username
    && !parsed.password
    && parsed.pathname === "/"
    && !parsed.search
    && !parsed.hash;
  const hasValidRoutePrefix = ALLOWED_GATEWAY_ROUTE_PREFIXES.has(routePrefix);
  const isStagingRouteAllowed = routePrefix !== "office/mikage-staging" || process.env.IS_PULL_REQUEST === "true";
  if (!hasValidGatewayUrl || !hasValidRoutePrefix || !isStagingRouteAllowed) {
    throw new Error("ミカゲAPI Gatewayの設定が不正です。");
  }
  return { baseUrl, routePrefix, token };
}

export async function fetchMikageApi<T>(
  source: MikageGatewaySource,
  options: { method?: "GET" | "POST"; query?: URLSearchParams; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  if (!GATEWAY_SOURCES.includes(source)) {
    throw new Error("未許可のミカゲAPI Gateway sourceです。");
  }
  const { baseUrl, routePrefix, token } = getGatewayConfig();
  const url = new URL(`${baseUrl}/${routePrefix}/${source}`);
  if (options.query) url.search = options.query.toString();
  const timeoutSignal = AbortSignal.timeout(10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`ミカゲAPI GatewayがHTTP ${response.status}を返しました。`);
  }
  return response.json() as Promise<T>;
}

export function isMikageGatewayConfigured(): boolean {
  return Boolean(process.env.MIKAGE_GATEWAY_BASE_URL && process.env.MIKAGE_API_BEARER_TOKEN);
}
