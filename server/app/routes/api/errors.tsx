import type { Route } from "./+types/errors";
import { createClient } from "~/lib/supabase";

export async function loader({ request, params }: Route.LoaderArgs) {
  // パラメータを取得
  const { offset: offsetParam } = params;
  const offsetTxt = offsetParam ? offsetParam : "0";
  const offset = /^\d+$/.test(offsetTxt) ? Number(offsetTxt) : 0;

  // データ取得
  const { supabase } = createClient(request, "mikage");
  const { data, error } = await supabase.rpc("get_error_logs", {
    start_offset: offset,
    end_offset: offset - 1,
  });

  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
