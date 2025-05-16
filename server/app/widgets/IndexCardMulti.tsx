import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
  CardFooter
} from "~/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

import IndexCardMultiCharts from "./indexCardMultiCharts";
import IndexLoading from "./indexLoading";
import type { IndexCard, IndexCardMulti } from "@/types/indexCard";
import { getColorListsFromKey } from "~/library/index/color";
import { useEffect, useState } from "react";

/**
 *
 * @param raw
 * @returns
 */
function mergeTargetsData(raw: IndexCard[]) {
  const roundTo5Min = (datetime: string) => {
    const date = new Date(datetime);
    date.setSeconds(0);
    date.setMilliseconds(0);
    date.setMinutes(Math.floor(date.getMinutes() / 5) * 5);
    return date.toISOString();
  };
  const map = new Map<string, any>();
  for (const target of raw) {
    const { key, logs } = target;
    for (const { checked_at, response_time } of logs) {
      const timeKey = roundTo5Min(checked_at);
      if (!map.has(timeKey)) {
        map.set(timeKey, { checked_at: timeKey });
      }
      map.get(timeKey)[key] = response_time;
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.checked_at.localeCompare(b.checked_at)
  );
}

type IndexCardMultiProps = {
  title: string;
  className?: string;
  keyNames: string[];
  hour: string | null;
  now: string;
};

export default function IndexCardMulti({
  title,
  keyNames,
  hour,
  className,
  now,
}: IndexCardMultiProps) {
  const [data, setData] = useState<IndexCardMulti[] | null>(null);
  const [rdsList, setRdsList] = useState<string[]>(keyNames);
  const colorLists = getColorListsFromKey(keyNames[0]);
  useEffect(() => {
    fetch(`/api/v1/keys/${rdsList.join(",")}/hour/${hour}`)
      .then((res) => res.json())
      .then((res) => {
        const rawData = res.data;        
        const mergeData = mergeTargetsData(rawData);
        setData(mergeData);
      });
  }, [now, hour, rdsList]);

  return (
    <Card className={`${className}`}>
      {data ? (
        <IndexCardMultiCharts data={data} rdsList={rdsList} setRdsList={setRdsList} title={title} />
      ) : (
        <IndexLoading className={colorLists.border} />
      )}
    </Card>
  );
}
