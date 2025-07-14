import type { Route } from "./+types/index";
import LoginCard from "./components/card";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "ログイン | サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export default function LoginPage() {
  return <LoginCard />;
}
