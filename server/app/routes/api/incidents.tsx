import type { Route } from "./+types/errors";
import { createClient } from "~/library/supabase/server";

export async function loader({ request, params }: Route.LoaderArgs) {
  // パラメータを取得
  const { offset: offsetParam } = params;
  const offsetNum = Number(offsetParam ?? "0");

  // 今日の年月を取得
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // offset分だけ月をずらす
  const targetStart = new Date(year, month + offsetNum, 1, 0, 0, 0, 0);
  // 次の月の1日（＝今月の末日23:59:59の次の瞬間）
  const targetEnd = new Date(targetStart.getFullYear(), targetStart.getMonth() + 1, 1, 0, 0, 0, 0);

  // ISO文字列に変換（Supabaseのtimestamp型に合わせるため）
  const startIso = targetStart.toISOString();
  const endIso = targetEnd.toISOString();

  // データ取得
  const { supabase } = createClient(request, "mikage");
  const { data, error } = await supabase
    .from("incidents")
    .select("keyword, created_at, updated_at, count, is_closed, googlechat_name, instatus_id")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });

  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
