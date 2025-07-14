import type { Route } from "./+types/incidents";
import IncidentsTable from "~/widgets/IncidentsTable";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "インシデント | サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

export default function IncidentsPage() {
  return <IncidentsTable />;
}