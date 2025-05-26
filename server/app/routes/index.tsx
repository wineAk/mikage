import type { Route } from "./+types/index";
import type { Key, Target } from "@/types/api";
import { useState, useEffect, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import CardMulti from "~/widgets/CardMulti";
import ErrorsTable from "~/widgets/ErrorsTable";
import SummaryTable from "~/widgets/SummaryTable";
import Login from "~/widgets/Login";
import IncidentsTable from "~/widgets/IncidentsTable";
import { useInterval } from "~/library/index/useInterval";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "サスケ 監視ツール - ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

// 日時をフォーマットする共通関数
function formatDateTime(str?: string) {
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

// 分数文字列（例: "60*3"）を数値に変換
function parseMinuteString(minute: string | null): number {
  if (!minute) return 0;
  return minute
    .split("*")
    .map(Number)
    .reduce((a, b) => a * b, 1);
}

export async function loader({ request }: Route.LoaderArgs) {}

export default function Index({ loaderData }: Route.ComponentProps) {
  // 個別に管理する状態
  const [now, setNow] = useState(formatDateTime());
  const [minute, setMinute] = useState("60*1");
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [logs, setLogs] = useState<Key[] | null>(null);

  // 時間・ターゲット・ログの一括更新
  const updateNow = useCallback(() => {
    setNow(formatDateTime());
  }, []);

  // targets取得
  useEffect(() => {
    // targets取得
    fetch("/api/v1/targets")
      .then((res) => res.json())
      .then((res) => {
        const targets = res.data;
        setTargets(targets);

        // targets取得後にlogsも取得
        if (now && minute && targets) {
          const targetKeys = targets.map((target: Target) => target.key);
          const minuteValue = parseMinuteString(minute);
          fetch(`/api/v1/keys/${targetKeys.join(",")}/minute/${minuteValue}`)
            .then((res) => res.json())
            .then((res) => setLogs(res.data));
        }
      });
  }, [now, minute]);

  // 5分ごとにnowを更新
  useInterval(updateNow, 5 * 60 * 1000);

  // minute変更ハンドラ
  const handleMinuteChange = (value: string) => {
    setMinute(value);
  };

  return (
    <main className="flex flex-col gap-4 p-4">
      <Tabs defaultValue="status" className="">
        <div className="fixed z-2 top-4 inset-x-4 h-14 bg-background/50 backdrop-blur-sm border dark:border-slate-700/70 max-w-screen-xl mx-4 rounded-full overflow-hidden">
          <TabsList className="w-full h-full bg-transparent p-0">
            {["status", "incidents", "errors", "login"].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-full rounded-none cursor-pointer hover:bg-neutral-100/50 data-[state=active]:bg-neutral-200/50 data-[state=active]:shadow-none"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="mt-18">
          <TabsContent value="status">
            <Status
              now={now}
              minute={minute}
              setMinute={handleMinuteChange}
              logs={logs}
              targets={targets}
            />
          </TabsContent>
          <TabsContent value="incidents">
            <IncidentsTable targets={targets} />
          </TabsContent>
          <TabsContent value="errors">
            <ErrorsTable />
          </TabsContent>
          <TabsContent value="login">
            <Login targets={targets} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  );
}

// StatusProps型
type StatusProps = {
  now: string;
  minute: string;
  setMinute: (value: string) => void;
  logs: Key[] | null;
  targets: Target[] | null;
};

function Status({ now, minute, setMinute, logs, targets }: StatusProps) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      <div className="col-span-1 md:col-span-2 xl:col-span-4">
        <section className="flex justify-between items-center gap-2">
          <div className="text-xs sm:text-sm">
            <span className="block sm:inline mr-2">更新日</span>
            <span>{now}</span>
          </div>
          <Select value={minute} onValueChange={setMinute}>
            <SelectTrigger className="w-24 cursor-pointer bg-white">
              <SelectValue
                placeholder={minute === null ? "読み込み中……" : undefined}
              />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="10" className="cursor-pointer">
                10分間
              </SelectItem>
              <SelectItem value="30" className="cursor-pointer">
                30分間
              </SelectItem>
              <SelectItem value="60*1" className="cursor-pointer">
                1時間
              </SelectItem>
              <SelectItem value="60*3" className="cursor-pointer">
                3時間
              </SelectItem>
              <SelectItem value="60*6" className="cursor-pointer">
                6時間
              </SelectItem>
              <SelectItem value="60*12" className="cursor-pointer">
                12時間
              </SelectItem>
              <SelectItem value="60*24" className="cursor-pointer">
                24時間
              </SelectItem>
              <SelectItem value="60*24*3" className="cursor-pointer">
                3日間
              </SelectItem>
              <SelectItem value="60*24*7" className="cursor-pointer">
                7日間
              </SelectItem>
              <SelectItem value="60*24*14" className="cursor-pointer">
                14日間
              </SelectItem>
              <SelectItem value="60*24*28" className="cursor-pointer">
                28日間
              </SelectItem>
            </SelectContent>
          </Select>
        </section>
      </div>
      <CardMulti
        title="ホームページ"
        logs={logs}
        targets={targets}
        defaultRdsList={["web_interpark", "web_saaske", "web_works"]}
      />
      <CardMulti
        title="Works"
        logs={logs}
        targets={targets}
        defaultRdsList={["works07", "works09"]}
      />
      <CardMulti
        title="サスケ"
        className="col-span-1 md:col-span-2"
        logs={logs}
        targets={targets}
        defaultRdsList={[
          "saaske02",
          "saaske04",
          "saaske07",
          "saaske09",
          "saaske_api",
        ]}
      />
      <SummaryTable
        className="col-span-1 md:col-span-2 xl:col-span-4"
        logs={logs}
      />
    </section>
  );
}
