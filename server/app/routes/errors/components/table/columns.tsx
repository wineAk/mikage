import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "~/components/ui/badge";

import type { ErrorLog } from "@/types/api";
import { getColorListsFromKey } from "~/library/index/color";


export const columns: ColumnDef<ErrorLog>[] = [
  {
    accessorKey: "created_at",
    header: "日時",
    cell: ({ row }) => {
      const original = row.original;
      const created_at = original.created_at;
      const created_at_jp = new Date(created_at).toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return <>{created_at_jp}</>;
    },
  },
  {
    accessorKey: "name",
    header: "環境",
    cell: ({ row }) => {
      const original = row.original;
      const key = original.target_key;
      const bg = getColorListsFromKey(key).bg;
      const text = getColorListsFromKey(key).text;
      return (
        <Badge className={[bg, text].join(" ")}>{row.getValue("name")}</Badge>
      );
    },
  },
  {
    accessorKey: "response_time",
    header: "読込速度",
    cell: ({ row }) => {
      return (
        <div>
          {(Number(row.getValue("response_time")) / 1000).toFixed(2)} 秒
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "ステータス",
    cell: ({ row }) => {
      const original = row.original;
      const code = original.status_code;
      const message = original.status_message;
      return (
        <div className="flex gap-2">
          <Badge variant="secondary" className="w-24 empty:hidden">
            {code}
          </Badge>
          <div>{message}</div>
        </div>
      );
    },
  },
  {
    accessorKey: "error",
    header: "エラー",
    cell: ({ row }) => {
      const original = row.original;
      const code = original.error_code;
      const name = original.error_name;
      return (
        <div className="flex gap-2">
          <Badge variant="secondary" className="w-24 empty:hidden">
            {code}
          </Badge>
          <div>{name}</div>
        </div>
      );
    },
  },
];
