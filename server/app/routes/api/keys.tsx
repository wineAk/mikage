import type { Route } from "./+types/keys";
import { fetchMikageApi } from "~/lib/mikageApi.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  // パラメータを取得
  const { keys: keysParam, minute: minuteParam } = params;
  const keys = keysParam.split(",");
  const minute = /^\d+$/.test(minuteParam) ? Number(minuteParam) : 1;

  // 現在 から 指定時間 までの絞り込み
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - minute * 60 * 1000).toISOString();

  // データ取得
  const query = new URLSearchParams({ keys: keys.join(","), start, end });
  const { data } = await fetchMikageApi<{ data: unknown; error: null }>("view-logs", { query, signal: request.signal });
  const error = null;
  
  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
