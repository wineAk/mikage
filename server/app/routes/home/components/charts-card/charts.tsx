import type { ChartConfig } from "~/components/ui/chart";
import type { ChartRange, MargeLog } from "@/types/indexCard";
import type { Target } from "@/types/api";

import { useId } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from "recharts";

import {
  ChartContainer,
  ChartLegend,
} from "~/components/ui/chart";
import { CardContent } from "~/components/ui/card";
import { getColorListsFromKey } from "~/library/index/color";
import type { ChartSeries } from "./chartData";

const THRESHOLD = 3000;

type ChartsProps = {
  targets: Target[];
  data: MargeLog[];
  series: ChartSeries[];
  selectedKeys: string[];
  range: ChartRange;
};

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export default function Charts({
  targets,
  data,
  series,
  selectedKeys,
  range,
}: ChartsProps) {
  const chartId = useId().replaceAll(":", "");
  const targetByKey = new Map(targets.map((target) => [target.key, target]));
  const chartConfig: ChartConfig = Object.fromEntries(
    series.map(({ dataKey, targetKey }) => [
      dataKey,
      {
        label: targetByKey.get(targetKey)?.name ?? targetKey,
        color: getColorListsFromKey(targetKey).oklch,
      },
    ])
  );
  const maxBySeries = Object.fromEntries(
    series.map(({ dataKey }) => [
      dataKey,
      data.reduce((maximum, row) => {
        const value = row[dataKey];
        return typeof value === "number" ? Math.max(maximum, value) : maximum;
      }, 0),
    ])
  );
  const rawMax = Math.max(0, ...Object.values(maxBySeries));
  const unit = rawMax < 1000 ? 100 : 500;
  const yAxisMax = Math.max(unit, Math.ceil(rawMax / unit) * unit);
  const visibleTargetKeys = [...new Set(series.map(({ targetKey }) => targetKey))];
  const usesDateLabels =
    new Date(range.start).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) !==
    new Date(range.end).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

  if (selectedKeys.length === 0 || data.length === 0 || series.length === 0) {
    const message = selectedKeys.length === 0
      ? "表示対象が選択されていません。"
      : "選択した期間に監視データがありません。";

    return (
      <CardContent>
        <div className="flex h-64 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
          <p>{message}</p>
          <div className="mt-4 w-full px-4">
            <div className="h-px w-full bg-border" />
            <div className="flex justify-between gap-4 pt-1 text-xs">
              <span>{formatDateTime(range.start)}</span>
              <span>{formatDateTime(range.end)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    );
  }

  return (
    <CardContent>
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <AreaChart data={data}>
          <defs>
            {series.map(({ dataKey }) => {
              const max = maxBySeries[dataKey] ?? 0;
              const percent = max === 0 ? 0 : 100 - (THRESHOLD / max) * 100;
              const thresholdOffset = max < THRESHOLD ? "0%" : `${percent}%`;

              return (
                <linearGradient
                  key={dataKey}
                  id={`gradient-${chartId}-${dataKey}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="red" stopOpacity={0.4} />
                  <stop
                    offset={thresholdOffset}
                    stopColor={chartConfig[dataKey].color}
                    stopOpacity={0.2}
                  />
                  <stop
                    offset="95%"
                    stopColor={chartConfig[dataKey].color}
                    stopOpacity={0.01}
                  />
                </linearGradient>
              );
            })}
          </defs>

          <CartesianGrid vertical={false} />

          <XAxis
            type="number"
            dataKey="timestamp"
            scale="time"
            domain={[range.start, range.end]}
            allowDataOverflow
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval="preserveStartEnd"
            minTickGap={24}
            tickFormatter={(value: number) => {
              const options: Intl.DateTimeFormatOptions = usesDateLabels
                ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
                : { hour: "2-digit", minute: "2-digit" };
              return new Intl.DateTimeFormat("ja-JP", {
                ...options,
                timeZone: "Asia/Tokyo",
              }).format(value);
            }}
          />

          <YAxis
            domain={[0, yAxisMax]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={38}
            tickFormatter={(value) => `${(value / 1000).toFixed(1)} s`}
          />

          <Tooltip
            filterNull
            cursor={false}
            content={({ active, payload }) => {
              const measuredItems = payload?.filter(
                (item) => typeof item.value === "number" && typeof item.dataKey === "string"
              ) ?? [];
              if (!active || measuredItems.length === 0) return null;

              const sortedItems = [...measuredItems].sort(
                (first, second) => Number(second.value) - Number(first.value)
              );
              const timestamp = sortedItems[0]?.payload?.timestamp;

              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-xl">
                  <div className="mb-2 font-bold">
                    {typeof timestamp === "number" ? formatDateTime(timestamp) : ""}
                  </div>
                  {sortedItems.map((item) => {
                    const dataKey = item.dataKey as string;
                    const targetKey = series.find((entry) => entry.dataKey === dataKey)?.targetKey;
                    if (!targetKey) return null;

                    return (
                      <div key={dataKey} className="flex items-center gap-2">
                        <span
                          className="mt-1 inline-block h-3 w-3 rounded-sm"
                          style={{ backgroundColor: getColorListsFromKey(targetKey).oklch }}
                        />
                        <span>{targetByKey.get(targetKey)?.name ?? targetKey}</span>
                        <span className="font-bold">
                          {(Number(item.value) / 1000).toFixed(2)} s
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />

          {series.map(({ dataKey, sampleCount }) => (
            <Area
              key={dataKey}
              type="monotone"
              dataKey={dataKey}
              name={dataKey}
              stroke={chartConfig[dataKey].color}
              fill={`url(#gradient-${chartId}-${dataKey})`}
              fillOpacity={1}
              connectNulls
              dot={sampleCount === 1}
            />
          ))}

          <ReferenceLine
            y={THRESHOLD}
            stroke="red"
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{
              value: `しきい値: ${(THRESHOLD / 1000).toFixed(1)}s`,
              position: "insideTopLeft",
              fill: "red",
              fontSize: 12,
            }}
          />

          <ChartLegend
            content={() => (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3">
                {visibleTargetKeys.map((targetKey) => (
                  <div key={targetKey} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: getColorListsFromKey(targetKey).oklch }}
                    />
                    <span>{targetByKey.get(targetKey)?.name ?? targetKey}</span>
                  </div>
                ))}
              </div>
            )}
            className="flex-wrap gap-y-0"
          />
        </AreaChart>
      </ChartContainer>
    </CardContent>
  );
}
