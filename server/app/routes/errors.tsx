import type { Route } from "./+types/errors";
import ErrorsTable from "~/widgets/ErrorsTable";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "エラー一覧 | サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export default function ErrorsPage() {
  return <ErrorsTable />;
}