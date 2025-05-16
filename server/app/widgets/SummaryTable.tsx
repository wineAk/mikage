import { useEffect, useState } from "react";
import type { DataLog } from "@/types/indexCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import CardLoading from "./CardLoading";
import { getColorListsFromKey } from "~/library/index/color";

type Row = {
  key: string;
  name: string;
  logs: DataLog[];
};

type Stats = { max: number; min: number; avg: number; median: number };

function calcStatsFromLogs(logs: DataLog[]): Stats {
  if (!logs || logs.length === 0) return { max: 0, min: 0, avg: 0, median: 0 };
  const values = logs.map((log) => log.response_time);
  const sorted = [...values].sort((a, b) => a - b);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { max, min, avg, median };
}

function getCellClass(value: number) {
  if (value >= 10000) return "text-red-500 font-medium";
  if (value >= 6000) return "text-fuchsia-500 font-medium";
  return "";
}

function msToSecStr(ms: number) {
  return (ms / 1000).toFixed(2) + " 秒";
}

export default function SummaryTable({
  className,
  hour,
}: {
  className: string;
  hour: string | null;
}) {
  const [data, setData] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch(`/api/v1/targets`)
      .then((res) => res.json())
      .then((res) => {
        const targets = res.data;
        const rdsList = targets.map((target: any) => target.key);
        fetch(`/api/v1/keys/${rdsList.join(",")}/hour/${hour}`)
          .then((res) => res.json())
          .then((res) => setData(res.data));
      });
  }, [hour]);

  return (
    <Card className={`${className}`}>
      {data ? (
        <>
          <CardHeader>
            <CardTitle className="flex items-center justify-between h-8">
              <span>サマリー</span>
            </CardTitle>
          </CardHeader>

          <CardContent>
            <div className="max-h-[460px] relative overflow-y-auto">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-white">
                  <TableRow>
                    <TableHead>名前</TableHead>
                    <TableHead>最大</TableHead>
                    <TableHead>最小</TableHead>
                    <TableHead>平均</TableHead>
                    <TableHead>中央値</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => {
                    const { key, name, logs } = row;
                    const stats = calcStatsFromLogs(logs);
                    const bgColor = getColorListsFromKey(key).bg;
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <span
                            className={`inline-block h-3 w-3 mr-2 rounded-sm ${bgColor}`}
                          />
                          {name}
                        </TableCell>
                        <TableCell className={getCellClass(stats.max)}>
                          {msToSecStr(stats.max)}
                        </TableCell>
                        <TableCell className={getCellClass(stats.min)}>
                          {msToSecStr(stats.min)}
                        </TableCell>
                        <TableCell className={getCellClass(stats.avg)}>
                          {msToSecStr(stats.avg)}
                        </TableCell>
                        <TableCell className={getCellClass(stats.median)}>
                          {msToSecStr(stats.median)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          </CardContent>
        </>
      ) : (
        <CardLoading className="border-neutral-800" />
      )}
    </Card>
  );
}
