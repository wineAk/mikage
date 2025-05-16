export type Log = {
  startDate: number;
  responseTime: number | null;
  statusCode: number | null;
  statusMessage: string | null;
  errorName: string | null;
  errorCode: string | null;
};

export type LogResult = {
  key: string;
  name: string;
  log: Log;
};
