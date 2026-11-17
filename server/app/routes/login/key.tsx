import type { Route } from "./+types/key";
import { fetchMikageApi } from "~/lib/mikageApi.server";
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
  const { targets } = await fetchMikageApi<{ targets: Array<{ key: string; name: string }> }>("view-targets", { signal: request.signal });
  const target = targets.find((item) => item.key === key);
  if (!target) return null;
  return { title: target.name };
}

export default function LoginKeyPage() {
  return <LoginCard />;
}
