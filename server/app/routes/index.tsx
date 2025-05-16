import type { Route } from "./+types/index";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import CardMulti from "~/widgets/CardMulti";
import ErrorsTable from "~/widgets/ErrorsTable";
import SummaryTable from "~/widgets/SummaryTable";
import CardLogin from "~/widgets/CardLogin";
import { useInterval } from "~/library/index/useInterval";

import { useState, useEffect } from "react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "サスケ 監視ツール - ミカゲ" },
    { name: "description", content: "サスケを監視するツール“ミカゲ”です。" },
  ];
}

/**
 *
 * @param str - ISO8601形式の文字列（例：2023-10-01T12:34:56Z）
 * @returns str
 */
function timeFormatter(str?: string) {
  const date = str ? new Date(str) : new Date();
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function loader({ request }: Route.LoaderArgs) {}

export default function Index({ loaderData }: Route.ComponentProps) {
  // 更新日
  const [now, setNow] = useState("読み込み中……");
  // クライアントで初期化
  useEffect(() => {
    setNow(timeFormatter());
  }, []);
  // 5で割って1余る分（1, 6, 11, ..., 56）だけ更新
  useInterval(() => {
    if (new Date().getMinutes() % 5 === 1) setNow(timeFormatter());
  }, 60 * 1000);

  // 表示時間
  const [hour, setHour] = useState<string | null>(null);
  useEffect(() => setHour("1"), []);

  return (
    <main className="flex flex-col gap-4 p-4">
      <section className="flex justify-between items-center gap-2">
        <div className="text-xs sm:text-sm">
          <span className="block sm:inline mr-2">更新日</span>
          <span>{now}</span>
        </div>
        <Select value={hour ?? ""} onValueChange={(value) => setHour(value)}>
          <SelectTrigger className="w-24 cursor-pointer bg-white">
            <SelectValue
              placeholder={hour === null ? "読み込み中……" : undefined}
            />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="1" className="cursor-pointer">1時間</SelectItem>
            <SelectItem value="3" className="cursor-pointer">3時間</SelectItem>
            <SelectItem value="6" className="cursor-pointer">6時間</SelectItem>
            <SelectItem value="12" className="cursor-pointer">12時間</SelectItem>
            <SelectItem value="24" className="cursor-pointer">24時間</SelectItem>
            <SelectItem value="72" className="cursor-pointer">3日間</SelectItem>
            <SelectItem value="168" className="cursor-pointer">7日間</SelectItem>
            <SelectItem value="336" className="cursor-pointer">14日間</SelectItem>
            <SelectItem value="672" className="cursor-pointer">28日間</SelectItem>
          </SelectContent>
        </Select>
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <CardMulti
          title="ホームページ"
          keyNames={["web_interpark", "web_saaske", "web_works"]}
          hour={hour}
          now={now}
        />
        <CardMulti
          title="Works"
          keyNames={["works07", "works09"]}
          hour={hour}
          now={now}
        />
        <CardMulti
          title="サスケ"
          className="col-span-1 md:col-span-2"
          keyNames={["saaske02", "saaske04", "saaske07", "saaske09", "saaske_api"]}
          hour={hour}
          now={now}
        />
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryTable className="col-span-1" hour={hour} />
        <ErrorsTable className="col-span-1" />
      </section>
      <section className="grid grid-cols-1 gap-4">
        <CardLogin className="col-span-1 md:col-span-2 xl:col-span-4" />
      </section>
    </main>
  );
}
