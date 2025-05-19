import type { MargeLog, ChartProps } from "@/types/indexCard";
import type { Key, Target } from "@/types/api";

import { Card } from "~/components/ui/card";
import CardMultiCharts from "./CardMultiCharts";
import CardLoading from "./CardLoading";
import { getColorListsFromKey } from "~/library/index/color";
import { useEffect, useState } from "react";

function mergeTargetsData(raw: Key[]): MargeLog[] {
  const roundTo5Min = (datetime: string) => {
    const date = new Date(datetime);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date.toISOString();
  };
  const map = new Map<string, MargeLog>();
  for (const target of raw) {
    const { key, logs } = target;
    for (const { created_at, response_time } of logs) {
      const timeKey = roundTo5Min(created_at);
      if (!map.has(timeKey)) {
        map.set(timeKey, { created_at: timeKey });
      }
      map.get(timeKey)![key] = response_time ?? 0;
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
}

type CardMultiProps = {
  title: string;
  className?: string;
  targets: Target[];
  keyNames: string[];
  minute: string | null;
  now: string;
};

export default function CardMulti({
  title,
  targets,
  keyNames,
  minute,
  className,
  now,
}: CardMultiProps) {
  const [data, setData] = useState<ChartProps | null>(null);
  const [rdsList, setRdsList] = useState<string[]>(keyNames);
  const colorLists = getColorListsFromKey(keyNames[0]);
  useEffect(() => {
    // 分を計算
    const minuteValue = minute ? minute : "60*1";
    const minuteValueStr = minuteValue
      .split("*")
      .map(Number)
      .reduce((a, b) => a * b, 1);
    // データ取得
    fetch(`/api/v1/keys/${rdsList.join(",")}/minute/${minuteValueStr}`)
      .then((res) => res.json())
      .then((res) => {
        const keyLogs = res.data as Key[];
        const margeLogs = mergeTargetsData(keyLogs);
        setData({ margeLogs });
      });
  }, [now, minute, rdsList]);

  return (
    <Card className={`${className}`}>
      {data ? (
        <CardMultiCharts
          targets={targets}
          list={data}
          rdsList={rdsList}
          setRdsList={setRdsList}
          title={title}
        />
      ) : (
        <CardLoading className={colorLists.border} />
      )}
    </Card>
  );
}
