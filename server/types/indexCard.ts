// CardMulti.tsx
export type MargeLog = {
  created_at: string;
  [key: string]: number | string;
}

export type ChartProps = {
  margeLogs: MargeLog[];
}
