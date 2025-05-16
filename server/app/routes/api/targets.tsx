import type { Route } from "./+types/errors";
import { createClient } from "~/library/supabase/server";

export async function loader({ request }: Route.LoaderArgs) {
  // データ取得
  const { supabase } = createClient(request, "mikage");
  const { data, error } = await supabase
    .from("targets")
    .select("key, name")
    .order("key", { ascending: true });

  return new Response(JSON.stringify({ data, error }), {
    headers: { "Content-Type": "application/json" },
  });
}
