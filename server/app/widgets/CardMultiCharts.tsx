import type { IndexCardMulti } from "@/types/indexCard";

import { Button } from "~/components/ui/button";
import {
  CardHeader,
  CardTitle,
  CardContent,
} from "~/components/ui/card";
import {
  ChartContainer,
  type ChartConfig,
  ChartLegend,
  ChartLegendContent,
} from "~/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
} from "recharts";
import { getColorListsFromKey } from "~/library/index/color";

/**
 *
 * @param data
 * @returns
 */
function getMaxPerKey(data: IndexCardMulti[]) {
  const maxPerKey: Record<string, number> = { all: 0 };
  for (const row of data) {
    for (const key in row) {
      if (key === "created_at") continue;
      const value = row[key as keyof typeof row];
      if (typeof value === "number") {
        const maxValue = Math.max(maxPerKey[key] ?? 0, value);
        maxPerKey[key] = maxValue;
        if (maxPerKey.all < maxValue) maxPerKey.all = maxValue;
      }
    }
  }
  return maxPerKey;
}

export default function CardMultiCharts({
  title,
  data,
  rdsList,
  setRdsList,
}: {
  title: string;
  data: IndexCardMulti[];
  rdsList: string[];
  setRdsList: (value: string[]) => void;
}) {
  const THRESHOLD = 3000;

  const chartConfig: ChartConfig = Object.fromEntries(
    rdsList.map((key) => [
      key,
      {
        label: key,
        color: getColorListsFromKey(key).oklch,
      },
    ])
  );

  const targetKeys = Object.keys(chartConfig);
  const maxPerKey = getMaxPerKey(data);
  const rawMax = maxPerKey.all;
  const unit = rawMax < 1000 ? 100 : 500;
  const yAxisMax = Math.ceil(rawMax / unit) * unit;

  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center justify-between h-8">
          <span>{title}</span>
          <Dialog>
            <DialogTrigger asChild className={title === "サスケ" ? "" : "hidden" }>
              <Button variant="outline" size="sm" className="cursor-pointer">
                設定
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>表示させる環境の設定</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 p-2">
                {[
                  "saaske00",
                  "saaske01",
                  "saaske02",
                  "saaske03",
                  "saaske04",
                  "saaske05",
                  "saaske06",
                  "saaske07",
                  "saaske08",
                  "saaske09",
                  "saaske_api",
                  "saaske_webform",
                  "saaske_webtracking",
                ].map((key) => {
                  const isChecked = rdsList.includes(key);
                  return (
                    <div className="flex items-center space-x-2" key={key}>
                      <Switch
                        id={key}
                        checked={isChecked}
                        onCheckedChange={() => {
                          if (isChecked) {
                            setRdsList(rdsList.filter((rds) => rds !== key).sort());
                          } else {
                            setRdsList([...rdsList, key].sort());
                          }
                        }}
                        disabled={/saaske(0[68]|10)/.test(key)}
                        className="cursor-pointer"
                      />
                      <Label htmlFor={key} className="cursor-pointer">
                        {key}
                      </Label>
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <a
                  href="https://wiki.interpark.co.jp/67feee6d64ee9a19e3f75f44#envUsage"
                  target="_blank"
                  className="text-sm text-green-700 underline"
                >
                  ⚠️サスケが落ちた？ - インターパーク社内ナレッジ
                </a>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={chartConfig}
          className="h-64 w-full"
        >
          <AreaChart data={data}>
            <defs>
              {targetKeys.map((key) => {
                const max = maxPerKey[key] ?? 0;
                const percent = 100 - (THRESHOLD / max) * 100;
                const thresholdOffset = max < THRESHOLD ? "0%" : `${percent}%`;
                return (
                  <linearGradient
                    key={key}
                    id={`gradient-${key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="red" stopOpacity={0.4} />
                    <stop
                      offset={thresholdOffset}
                      stopColor={chartConfig[key].color}
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="95%"
                      stopColor={chartConfig[key].color}
                      stopOpacity={0.01}
                    />
                  </linearGradient>
                );
              })}
            </defs>

            <CartesianGrid vertical={false} />

            <XAxis
              dataKey="created_at"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              minTickGap={24}
              tickFormatter={(value) =>
                new Date(value).toLocaleTimeString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
            />

            <YAxis
              domain={[0, yAxisMax]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={38}
              tickFormatter={(value) => `${(value / 1000).toFixed(1)} s`} // ← 秒に変換
            />

            <Tooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const sorted = [...payload].sort(
                  (a, b) => (b.value as number) - (a.value as number)
                );
                const checkedAt = payload[0]?.payload?.created_at;
                const timeStr = checkedAt
                  ? new Date(checkedAt).toLocaleTimeString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
                return (
                  <div className="border bg-background rounded-lg px-3 py-2 text-sm shadow-xl">
                    <div className="mb-2 font-bold">{timeStr}</div>
                    {sorted.map((item) => {
                      const name = item.name as string;
                      const value = item.value;
                      const color = chartConfig[name]?.color ?? "#000";
                      const label = chartConfig[name]?.label ?? name;
                      return (
                        <div key={name} className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 mt-1 rounded-sm"
                            style={{ backgroundColor: color }}
                          />
                          <span className="">{label}</span>
                          <span className="font-bold">
                            {((value as number) / 1000).toFixed(2)} s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />

            {targetKeys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={chartConfig[key].color}
                fill={`url(#gradient-${key})`}
                fillOpacity={1}
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

            <ChartLegend content={<ChartLegendContent />} className="flex-wrap gap-y-0"/>
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </>
  );
}
