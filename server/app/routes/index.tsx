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
    { title: "サスケ監視ツール ミカゲ" },
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
  // 現在時刻を管理
  const [now, setNow] = useState(formatDateTime());
  const updateNow = useCallback(() => {
    setNow(formatDateTime());
  }, []);
  // 5分ごとにnowを更新
  useInterval(updateNow, 5 * 60 * 1000);

  // 分間隔を管理
  const [minute, setMinute] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!minute) setMinute("60*1");
  }, []);
  // minute変更ハンドラ
  const handleMinuteChange = (value: string) => {
    setMinute(value);
  };

  // targetを管理
  const [targets, setTargets] = useState<Target[] | null>(null);
  useEffect(() => {
    fetch("/api/v1/targets")
      .then((res) => res.json())
      .then((res) => {
        const targets = res.data;
        setTargets(targets);
      });
  }, []);

  // logsを管理
  const [logs, setLogs] = useState<Key[] | null>(null);
  useEffect(() => {
    if (!now || !minute || !targets) return;
    const targetKeys = targets.map((target: Target) => target.key);
    const minuteValue = parseMinuteString(minute);
    fetch(`/api/v1/keys/${targetKeys.join(",")}/minute/${minuteValue}`)
      .then((res) => res.json())
      .then((res) => setLogs(res.data));
  }, [now, minute, targets]);

  return (
    <>
      <Status
        now={now}
        minute={minute}
        setMinute={handleMinuteChange}
        logs={logs}
        targets={targets}
      />
     {/*
      <Tabs defaultValue="status" className="hidden">
        <div className="fixed z-2 w-full">
          <div className="h-14 max-w-screen-xl mx-4 xl:mx-auto mt-4">
            <TabsList className="w-full h-full p-0 bg-background/50 backdrop-blur-sm border dark:border-slate-700/70 max-w-screen-xl rounded-full overflow-hidden">
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
        </div>
        <div className="mt-18 p-4">
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
      */}
    </>
  );
}

// StatusProps型
type StatusProps = {
  now: string;
  minute: string | undefined;
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
                placeholder={minute === undefined ? "読み込み中……" : undefined}
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
