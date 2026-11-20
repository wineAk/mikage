import type { Route } from "./+types/errors";
import { fetchMikageApi } from "~/lib/mikageApi.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  // パラメータを取得
  const { offset: offsetParam } = params;
  const offsetTxt = offsetParam ? offsetParam : "0";
  const offset = /^\d+$/.test(offsetTxt) ? Number(offsetTxt) : 0;

  // データ取得
  const { data } = await fetchMikageApi<{ data: unknown; error: null }>("view-errors", { query: new URLSearchParams({ offset: String(offset) }), signal: request.signal });
  const error = null;

  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
