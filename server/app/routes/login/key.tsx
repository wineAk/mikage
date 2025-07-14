import type { Route } from "./+types/key";
import { createClient } from "~/library/supabase/server";
import LoginCard from "./components/card";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.title || "No Title";
  return [
    { title: `ログイン - ${title} | サスケ監視ツール ミカゲ` },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { key } = params;
  const { supabase } = createClient(request, "mikage");
  const { data, error } = await supabase
    .from("targets")
    .select("key, name")
    .eq("key", key)
    .single();
  if (error) return null;
  return { title: data.name };
}

export default function LoginKeyPage() {
  return <LoginCard />;
}
