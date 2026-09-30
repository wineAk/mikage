// CardMulti.tsx
export type MargeLog = {
  timestamp: number;
  created_at: string;
  [key: string]: number | string | null | undefined;
};

export type ChartRange = {
  start: number;
  end: number;
};
