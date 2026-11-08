import type { ChartRange, MargeLog } from "@/types/indexCard";
import type { ChartSeries } from "./chartData";

export const CHART_THRESHOLD = 3000;
export const CHART_HEIGHT = 220;
export const CHART_MARGIN = { top: 12, right: 12, bottom: 28, left: 42 };
export type ChartPoint = { timestamp: number; value: number; x: number; y: number };
export type ChartPath = ChartSeries & { points: ChartPoint[]; line: string; area: string };

// 全計測点を維持し、chartDataで分割した欠測区間をそのまま別パスにする。
export function createChartGeometry(data: MargeLog[], series: ChartSeries[], range: ChartRange, width: number) {
  const pointsByKey = new Map(series.map(item => [item.dataKey, [] as ChartPoint[]]));
  let maximum = 0;
  for (const row of data) {
    for (const [key, value] of Object.entries(row)) {
      const points = pointsByKey.get(key);
      if (!points || typeof value !== "number" || !Number.isFinite(value)) continue;
      maximum = Math.max(maximum, value);
      points.push({ timestamp: row.timestamp, value, x: 0, y: 0 });
    }
  }
  const unit = maximum < 1000 ? 100 : 500;
  const yMaximum = Math.max(unit, Math.ceil(maximum / unit) * unit);
  const plotWidth = Math.max(1, width - CHART_MARGIN.left - CHART_MARGIN.right);
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const bottom = CHART_MARGIN.top + plotHeight;
  const duration = Math.max(1, range.end - range.start);
  const paths: ChartPath[] = series.map(item => {
    const points = pointsByKey.get(item.dataKey)!;
    for (const point of points) {
      point.x = CHART_MARGIN.left + (point.timestamp - range.start) / duration * plotWidth;
      point.y = bottom - point.value / yMaximum * plotHeight;
    }
    const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const first = points[0];
    const last = points.at(-1);
    const area = first && last ? `${line} L${last.x.toFixed(2)},${bottom} L${first.x.toFixed(2)},${bottom} Z` : "";
    return { ...item, points, line, area };
  });
  return { paths, yMaximum, plotWidth, plotHeight, bottom };
}

// chartDataの時刻順配列から最寄りの実測時刻を二分探索する。
export function findNearestDataIndex(data: MargeLog[], timestamp: number): number {
  if (data.length === 0) return -1;
  let low = 0;
  let high = data.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (data[middle].timestamp < timestamp) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && timestamp - data[low - 1].timestamp <= data[low].timestamp - timestamp) return low - 1;
  return low;
}

export function getMeasuredValues(row: MargeLog, series: ChartSeries[]) {
  return series.flatMap(item => {
    const value = row[item.dataKey];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ dataKey: item.dataKey, targetKey: item.targetKey, value }]
      : [];
  }).sort((first, second) => second.value - first.value);
}
