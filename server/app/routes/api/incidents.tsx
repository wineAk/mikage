import type { Route } from "./+types/errors";
import { fetchMikageApi } from "~/lib/mikageApi.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  // パラメータを取得
  const { offset: offsetParam } = params;
  const offsetNum = Number(offsetParam ?? "0");

  const { data } = await fetchMikageApi<{ data: unknown; error: null }>("view-incidents", { query: new URLSearchParams({ offset: String(offsetNum) }), signal: request.signal });
  const error = null;

  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
