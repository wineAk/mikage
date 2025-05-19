import type { Route } from "./+types/index";
import type { MargeLog } from "@/types/indexCard";
import type { Key, Target } from "@/types/api";

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

function mergeLogs(keys: string[], logs: Key[]): MargeLog[] {
  const margeLogs: Map<string, MargeLog> = new Map();
  for (const key of keys) {
    const findedLogs = logs.find((log) => log.key === key);
    if (findedLogs) {
      for (const log of findedLogs.logs) {
        const { created_at, response_time } = log;
        const created_date = new Date(created_at);
        created_date.setSeconds(0);
        created_date.setMilliseconds(0);
        const created_date_str = created_date.toISOString();
        if (margeLogs.has(created_date_str)) {
          margeLogs.get(created_date_str)![key] = response_time ?? 0;
        } else {
          margeLogs.set(created_date_str, { created_at: created_date_str, [key]: response_time ?? 0 });
        }
      }
    }
  }
  return Array.from(margeLogs.values());
}

export async function loader({ request }: Route.LoaderArgs) {}

export default function Index({ loaderData }: Route.ComponentProps) {

  // 表示時間
  const [minute, setMinute] = useState<string | null>(null);
  useEffect(() => setMinute("60*1"), []);

  // 更新日
  const [now, setNow] = useState("読み込み中……");
  // クライアントで初期化
  useEffect(() => {
    setNow(timeFormatter());
  }, []);
  // 5分に1度更新
  useInterval(() => {
    setNow(timeFormatter());
  }, 5 * 60 * 1000);

  // データ取得
  const [targets, setTargets] = useState<Target[]>([]);
  useEffect(() => {
    fetch("/api/v1/targets")
      .then((res) => res.json())
      .then((res) => setTargets(res.data));
  }, []);

  const [logs, setLogs] = useState<Key[]>([]);
  useEffect(() => {
    if (!now || !minute || targets.length === 0) return;
    const targetKeys = targets.map((target) => target.key);
    const minuteValue = minute.split("*").map(Number).reduce((a, b) => a * b, 1);
    fetch(`/api/v1/keys/${targetKeys.join(",")}/minute/${minuteValue}`)
      .then((res) => res.json())
      .then((res) => {
        setLogs(res.data)
      });
  }, [now, minute, targets]);

  return (
    <main className="flex flex-col gap-4 p-4">
      <section className="flex justify-between items-center gap-2">
        <div className="text-xs sm:text-sm">
          <span className="block sm:inline mr-2">更新日</span>
          <span>{now}</span>
        </div>
        <Select value={minute ?? ""} onValueChange={(value) => setMinute(value)}>
          <SelectTrigger className="w-24 cursor-pointer bg-white">
            <SelectValue
              placeholder={minute === null ? "読み込み中……" : undefined}
            />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="10" className="cursor-pointer">10分間</SelectItem>
            <SelectItem value="30" className="cursor-pointer">30分間</SelectItem>
            <SelectItem value="60*1" className="cursor-pointer">1時間</SelectItem>
            <SelectItem value="60*3" className="cursor-pointer">3時間</SelectItem>
            <SelectItem value="60*6" className="cursor-pointer">6時間</SelectItem>
            <SelectItem value="60*12" className="cursor-pointer">12時間</SelectItem>
            <SelectItem value="60*24" className="cursor-pointer">24時間</SelectItem>
            <SelectItem value="60*24*3" className="cursor-pointer">3日間</SelectItem>
            <SelectItem value="60*24*7" className="cursor-pointer">7日間</SelectItem>
            <SelectItem value="60*24*14" className="cursor-pointer">14日間</SelectItem>
            <SelectItem value="60*24*28" className="cursor-pointer">28日間</SelectItem>
          </SelectContent>
        </Select>
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <CardMulti
          title="ホームページ"
          margeLogs={mergeLogs(["web_interpark", "web_saaske", "web_works"], logs)}
          targets={targets}
          keyNames={["web_interpark", "web_saaske", "web_works"]}
          minute={minute}
          now={now}
        />
        <CardMulti
          title="Works"
          margeLogs={mergeLogs(["works07", "works09"], logs)}
          targets={targets}
          keyNames={["works07", "works09"]}
          minute={minute}
          now={now}
        />
        <CardMulti
          title="サスケ"
          margeLogs={mergeLogs(["saaske02", "saaske04", "saaske07", "saaske09", "saaske_api"], logs)}
          className="col-span-1 md:col-span-2"
          targets={targets}
          keyNames={["saaske02", "saaske04", "saaske07", "saaske09", "saaske_api"]}
          minute={minute}
          now={now}
        />
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryTable className="col-span-1" minute={minute} />
        <ErrorsTable className="col-span-1" />
      </section>
      <section className="grid grid-cols-1 gap-4">
        <CardLogin 
          targets={targets}
          className="col-span-1 md:col-span-2 xl:col-span-4"
        />
      </section>
    </main>
  );
}
