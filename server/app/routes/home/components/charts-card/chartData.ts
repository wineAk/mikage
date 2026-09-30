import type { Key } from "@/types/api";
import type { MargeLog } from "@/types/indexCard";

export type ChartSeries = {
  dataKey: string;
  targetKey: string;
  sampleCount: number;
};

export type ChartData = {
  data: MargeLog[];
  series: ChartSeries[];
};

type Sample = {
  checkedAt: number;
  responseTime: number | null;
};

const MINUTE_IN_MS = 60 * 1000;
const MAX_CONNECTED_GAP_IN_MS = 60 * MINUTE_IN_MS;

export function createChartData(keys: string[], logs: Key[]): ChartData {
  const logsByKey = new Map<string, Key[]>();
  for (const logGroup of logs) {
    const targetLogs = logsByKey.get(logGroup.key) ?? [];
    targetLogs.push(logGroup);
    logsByKey.set(logGroup.key, targetLogs);
  }

  const dataByTimestamp = new Map<number, MargeLog>();
  const series: ChartSeries[] = [];
  const uniqueKeys = [...new Set(keys)];

  uniqueKeys.forEach((targetKey, targetIndex) => {
    const samplesByMinute = new Map<number, Sample>();
    for (const logGroup of logsByKey.get(targetKey) ?? []) {
      for (const log of logGroup.logs) {
        const checkedAt = Date.parse(log.created_at);
        if (!Number.isFinite(checkedAt)) continue;

        const timestamp = Math.floor(checkedAt / MINUTE_IN_MS) * MINUTE_IN_MS;
        const previousSample = samplesByMinute.get(timestamp);
        if (previousSample && previousSample.checkedAt > checkedAt) continue;

        samplesByMinute.set(timestamp, {
          checkedAt,
          responseTime:
            typeof log.response_time === "number" && Number.isFinite(log.response_time)
              ? log.response_time
              : null,
        });
      }
    }

    const measuredSamples = [...samplesByMinute.entries()]
      .filter(([, sample]) => sample.responseTime !== null)
      .sort(([firstTimestamp], [secondTimestamp]) => firstTimestamp - secondTimestamp);

    let segmentIndex = 0;
    let currentSegment: Array<[number, Sample]> = [];
    for (const measuredSample of measuredSamples) {
      const [timestamp] = measuredSample;
      const previousTimestamp = currentSegment.at(-1)?.[0];
      if (
        previousTimestamp !== undefined &&
        timestamp - previousTimestamp > MAX_CONNECTED_GAP_IN_MS
      ) {
        addSegment(currentSegment, targetKey, targetIndex, segmentIndex, dataByTimestamp, series);
        segmentIndex += 1;
        currentSegment = [];
      }
      currentSegment.push(measuredSample);
    }

    addSegment(currentSegment, targetKey, targetIndex, segmentIndex, dataByTimestamp, series);
  });

  return {
    data: [...dataByTimestamp.values()].sort((first, second) => first.timestamp - second.timestamp),
    series,
  };
}

function addSegment(
  samples: Array<[number, Sample]>,
  targetKey: string,
  targetIndex: number,
  segmentIndex: number,
  dataByTimestamp: Map<number, MargeLog>,
  series: ChartSeries[]
) {
  if (samples.length === 0) return;

  const dataKey = `series-${targetIndex}-${segmentIndex}`;
  series.push({ dataKey, targetKey, sampleCount: samples.length });

  for (const [timestamp, sample] of samples) {
    let row = dataByTimestamp.get(timestamp);
    if (!row) {
      row = {
        timestamp,
        created_at: new Date(timestamp).toISOString(),
      };
      dataByTimestamp.set(timestamp, row);
    }
    row[dataKey] = sample.responseTime as number;
  }
}
