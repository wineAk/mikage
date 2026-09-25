import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

let watchSchedulerClient: SupabaseClient<Database, "mikage"> | null = null;

export function getWatchSchedulerClient() {
  if (watchSchedulerClient) {
    return watchSchedulerClient;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("スケジューラ用のSupabaseサーバー設定がありません。");
  }

  watchSchedulerClient = createSupabaseClient<Database, "mikage">(
    supabaseUrl,
    supabaseSecretKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      db: { schema: "mikage" },
    }
  );

  return watchSchedulerClient;
}
