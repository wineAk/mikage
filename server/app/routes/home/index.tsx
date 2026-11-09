import type { Route } from "./+types/index";
import { useMemo } from "react";
import { data, useSearchParams } from "react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import ChartsCard from "./components/charts-card";
import SummaryCard from "./components/summary-card";
import { createPageHeaders, getPageCacheRevision, readTargets, readLogs } from "~/lib/pageQueries.server";
import { readHomeMinute, minuteValue } from "~/lib/pageParams";
import { readConsistentPage } from "~/lib/pageSnapshot.server";

const webKeys = ["web_interpark", "web_saaske", "web_works"];
const worksKeys = ["works07", "works09"];
const saaskeKeys = ["saaske02", "saaske04", "saaske07", "saaske09", "saaske_api"];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "サスケ監視ツール ミカゲ" },
    { name: "description", content: 'サスケを監視するツール"ミカゲ"です。' },
  ];
}

// 日時をフォーマットする共通関数
function formatDateTime(date: Date) {
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) { return loaderHeaders; }

export async function loader({ request }: Route.LoaderArgs) {
  const minute = readHomeMinute(new URL(request.url).searchParams.get("minute"));
  let checkedAt = new Date();
  try {
    const { targets, logs } = await readConsistentPage(request, async () => {
      const targets = await readTargets(request);
      checkedAt = new Date();
      const logs = targets.length === 0 ? [] : await readLogs(request, targets.map(target => target.key), minuteValue(minute), checkedAt);
      return { targets, logs };
    });
    return data({ targets, logs, minute, checkedAt: checkedAt.toISOString(), cacheRevision: getPageCacheRevision(request), loadError: null }, { headers: createPageHeaders(request) });
  } catch {
    return data({ targets: null, logs: null, minute, checkedAt: checkedAt.toISOString(), cacheRevision: null, loadError: "監視データを取得できませんでした。ページを再読み込みしてください。" }, { status: 503, headers: createPageHeaders(request) });
  }
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { targets, logs, minute, checkedAt, loadError } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const now = useMemo(() => new Date(checkedAt), [checkedAt]);
  const range = useMemo(() => ({ start: now.getTime() - minuteValue(minute) * 60_000, end: now.getTime() }), [now, minute]);
  const setMinute = (value: string) => setSearchParams(previous => {
    const next = new URLSearchParams(previous);
    next.set("minute", readHomeMinute(value));
    return next;
  });

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {loadError && <p role="alert" className="col-span-full text-red-700">{loadError}</p>}
      <div className="col-span-1 md:col-span-2 xl:col-span-4">
        <section className="flex justify-between items-center gap-2">
          <div className="text-xs sm:text-sm">
            <span className="block sm:inline mr-2">更新日</span>
            <span>{formatDateTime(now)}</span>
          </div>
          <Select value={minute} onValueChange={setMinute}>
            <SelectTrigger className="w-24 cursor-pointer bg-white">
              <SelectValue
                placeholder="期間を選択"
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
      <ChartsCard
        title="ホームページ"
        logs={logs}
        targets={targets}
        defaultRdsList={webKeys}
        range={range}
      />
      <ChartsCard
        title="Works"
        logs={logs}
        targets={targets}
        defaultRdsList={worksKeys}
        range={range}
      />
      <ChartsCard
        title="サスケ"
        className="col-span-1 md:col-span-2"
        logs={logs}
        targets={targets}
        defaultRdsList={saaskeKeys}
        range={range}
      />
      <SummaryCard
        className="col-span-1 md:col-span-2 xl:col-span-4"
        logs={logs}
      />
    </section>
  );
}
