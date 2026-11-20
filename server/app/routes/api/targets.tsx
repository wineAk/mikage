import type { Route } from "./+types/errors";
import { fetchMikageApi } from "~/lib/mikageApi.server";

export async function loader({ request }: Route.LoaderArgs) {
  // データ取得
  const { targets: data } = await fetchMikageApi<{ targets: unknown[] }>("view-targets", { signal: request.signal });
  const error = null;

  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
