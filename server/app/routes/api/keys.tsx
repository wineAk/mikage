import type { Route } from "./+types/keys";
import { createClient } from "~/lib/supabase";

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
  const { supabase } = createClient(request, "mikage");
  const { data, error } = await supabase.rpc("get_logs_in_range", {
    keys: keys,
    start_time: start,
    end_time: end,
  });
  
  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
