import { useEffect, useState } from "react";
import type { KeyLog, Key } from "@/types/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "~/components/ui/card";
import { ScrollArea, ScrollBar } from "~/components/ui/scroll-area";
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
  logs: KeyLog[];
};

type Stats = { max: number; min: number; avg: number; median: number };

function calcStatsFromLogs(logs: KeyLog[]): Stats {
  if (!logs || logs.length === 0) return { max: 0, min: 0, avg: 0, median: 0 };
  const values = logs
    .map((log) => log.response_time)
    .filter((v): v is number => v !== null);
  const sorted = [...values].sort((a, b) => a - b);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : 0;
  const median = values.length ? sorted[Math.floor(sorted.length / 2)] : 0;
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

type SummaryTableProps = {
  className: string;
  logs: Key[] | null;
}

export default function SummaryTable({className, logs}: SummaryTableProps) {
  return (
    <Card className={`${className}`}>
      {logs ? (
        <>
          <CardHeader>
            <CardTitle className="flex items-center justify-between h-8">
              <span>サマリー</span>
            </CardTitle>
          </CardHeader>

          <CardContent>
            <ScrollArea className="relative pb-2 pr-2">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-1 bg-white">
                  <TableRow>
                    <TableHead>名前</TableHead>
                    <TableHead>最大</TableHead>
                    <TableHead>最小</TableHead>
                    <TableHead>平均</TableHead>
                    <TableHead>中央値</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((row) => {
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
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </>
      ) : (
        <CardLoading className="border-neutral-800" />
      )}
    </Card>
  );
}
