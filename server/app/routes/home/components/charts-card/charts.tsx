import type { ChartRange, MargeLog } from "@/types/indexCard";
import type { Target } from "@/types/api";
import type { KeyboardEvent, PointerEvent } from "react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { CardContent } from "~/components/ui/card";
import { getColorListsFromKey } from "~/library/index/color";
import type { ChartSeries } from "./chartData";
import { CHART_HEIGHT, CHART_MARGIN, CHART_THRESHOLD, createChartGeometry, findNearestDataIndex, getMeasuredValues } from "./chartGeometry";

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const dayFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" });
const dateTickFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

type ChartsProps = {
  targets: Target[];
  data: MargeLog[];
  series: ChartSeries[];
  selectedKeys: string[];
  range: ChartRange;
};

function Charts({ targets, data, series, selectedKeys, range }: ChartsProps) {
  const chartId = useId().replaceAll(":", "");
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const hasData = selectedKeys.length > 0 && data.length > 0 && series.length > 0;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const nextWidth = Math.max(100, Math.round(entries[0].contentRect.width));
      setWidth(previousWidth => previousWidth === nextWidth ? previousWidth : nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasData]);
  useEffect(() => setActiveIndex(null), [data]);

  const geometry = useMemo(() => createChartGeometry(data, series, range, width), [data, series, range, width]);
  const targetByKey = useMemo(() => new Map(targets.map(target => [target.key, target])), [targets]);
  const visibleTargetKeys = useMemo(() => [...new Set(series.map(item => item.targetKey))], [series]);
  const hasDateLabels = dayFormatter.format(range.start) !== dayFormatter.format(range.end);
  const tickCount = width < 400 ? 2 : width < 700 ? 3 : 5;
  const activeRow = activeIndex === null ? undefined : data[activeIndex];
  const measuredValues = activeRow ? getMeasuredValues(activeRow, series) : [];
  const activeX = activeRow
    ? CHART_MARGIN.left + (activeRow.timestamp - range.start) / Math.max(1, range.end - range.start) * geometry.plotWidth
    : 0;

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * width;
    const ratio = Math.max(0, Math.min(1, (x - CHART_MARGIN.left) / geometry.plotWidth));
    setActiveIndex(findNearestDataIndex(data, range.start + ratio * (range.end - range.start)));
  };
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") { setActiveIndex(null); return; }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActiveIndex(previousIndex => previousIndex === null ? 0 : Math.max(0, Math.min(data.length - 1, previousIndex + (event.key === "ArrowRight" ? 1 : -1))));
  };

  if (!hasData) {
    return (
      <CardContent>
        <div className="flex h-64 flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
          <p>{selectedKeys.length === 0 ? "表示対象が選択されていません。" : "選択した期間に監視データがありません。"}</p>
          <div className="mt-4 w-full px-4">
            <div className="h-px w-full bg-border" />
            <div className="flex justify-between gap-4 pt-1 text-xs">
              <span>{dateTimeFormatter.format(range.start)}</span><span>{dateTimeFormatter.format(range.end)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    );
  }

  const thresholdY = geometry.bottom - CHART_THRESHOLD / geometry.yMaximum * geometry.plotHeight;
  const thresholdOffset = Math.max(0, 1 - CHART_THRESHOLD / geometry.yMaximum);
  return (
    <CardContent>
      <div ref={container} data-slot="chart" className="relative w-full text-xs text-muted-foreground">
        <svg
          role="img"
          aria-label="応答時間グラフ。左右の矢印キーで計測値を確認できます。"
          aria-describedby={activeRow && measuredValues.length > 0 ? `tooltip-${chartId}` : undefined}
          tabIndex={0}
          className="block h-55 w-full outline-offset-2"
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActiveIndex(null)}
          onKeyDown={handleKeyDown}
          onBlur={() => setActiveIndex(null)}
        >
          <title>応答時間グラフ</title>
          <desc>{visibleTargetKeys.length}対象、{geometry.paths.reduce((total, path) => total + path.points.length, 0)}件の計測値。しきい値3秒。</desc>
          <defs>
            <clipPath id={`plot-${chartId}`}><rect x={CHART_MARGIN.left} y={CHART_MARGIN.top} width={geometry.plotWidth} height={geometry.plotHeight} /></clipPath>
            {geometry.paths.map(path => {
              const color = getColorListsFromKey(path.targetKey).oklch;
              return (
                <linearGradient key={path.dataKey} id={`gradient-${chartId}-${path.dataKey}`} gradientUnits="userSpaceOnUse" x1="0" y1={CHART_MARGIN.top} x2="0" y2={geometry.bottom}>
                  <stop offset="0%" stopColor={geometry.yMaximum > CHART_THRESHOLD ? "red" : color} stopOpacity={0.4} />
                  <stop offset={`${thresholdOffset * 100}%`} stopColor={color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                </linearGradient>
              );
            })}
          </defs>
          {[0, 1, 2, 3, 4].map(index => {
            const y = CHART_MARGIN.top + index / 4 * geometry.plotHeight;
            const value = geometry.yMaximum * (1 - index / 4);
            return (
              <g key={index}>
                <line x1={CHART_MARGIN.left} x2={width - CHART_MARGIN.right} y1={y} y2={y} stroke="var(--border)" strokeOpacity={0.5} />
                <text x={CHART_MARGIN.left - 6} y={y} dy="0.35em" textAnchor="end" fill="currentColor">{(value / 1000).toFixed(geometry.yMaximum < 1000 ? 2 : 1)} s</text>
              </g>
            );
          })}
          {Array.from({ length: tickCount }, (_, index) => {
            const ratio = index / (tickCount - 1);
            return <text key={index} x={CHART_MARGIN.left + ratio * geometry.plotWidth} y={geometry.bottom + 20} fill="currentColor" textAnchor={index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle"}>{(hasDateLabels ? dateTickFormatter : timeFormatter).format(range.start + ratio * (range.end - range.start))}</text>;
          })}
          <g clipPath={`url(#plot-${chartId})`}>
            {geometry.paths.map(path => (
              <g key={path.dataKey} data-series={path.dataKey}>
                <path d={path.area} fill={`url(#gradient-${chartId}-${path.dataKey})`} />
                <path data-chart-line d={path.line} fill="none" stroke={getColorListsFromKey(path.targetKey).oklch} strokeWidth={1.5} strokeLinejoin="round" />
                {path.points.length === 1 && <circle cx={path.points[0].x} cy={path.points[0].y} r={3} fill={getColorListsFromKey(path.targetKey).oklch} />}
              </g>
            ))}
            {CHART_THRESHOLD <= geometry.yMaximum && <g><line x1={CHART_MARGIN.left} x2={width - CHART_MARGIN.right} y1={thresholdY} y2={thresholdY} stroke="red" strokeDasharray="4 4" /><text x={CHART_MARGIN.left + 4} y={thresholdY + 14} fill="red">しきい値: 3.0s</text></g>}
          </g>
        </svg>
        <div className="flex min-h-9 flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-3">
          {visibleTargetKeys.map(targetKey => <div key={targetKey} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: getColorListsFromKey(targetKey).oklch }} /><span>{targetByKey.get(targetKey)?.name ?? targetKey}</span></div>)}
        </div>
        {activeRow && measuredValues.length > 0 && <div id={`tooltip-${chartId}`} role="tooltip" className="pointer-events-none absolute top-2 z-10 max-w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-xl" style={{ left: `${Math.max(0, Math.min(100, activeX / width * 100))}%`, transform: activeX > width / 2 ? "translateX(-100%)" : undefined }}>
          <div className="mb-2 font-bold">{dateTimeFormatter.format(activeRow.timestamp)}</div>
          {measuredValues.map(item => <div key={item.dataKey} className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: getColorListsFromKey(item.targetKey).oklch }} /><span>{targetByKey.get(item.targetKey)?.name ?? item.targetKey}</span><span className="font-bold">{(item.value / 1000).toFixed(2)} s</span></div>)}
        </div>}
      </div>
    </CardContent>
  );
}

export default memo(Charts);
