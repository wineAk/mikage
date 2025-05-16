export type DataLog = {
  target_id: number;
  response_time: number;
  checked_at: string;
};

export type DataTarget = {
  key: string;
  name: string;
};

export type IndexCard = {
  key: string;
  name: string;
  logs: DataLog[];
};

export type IndexCardMulti = {
  checked_at: string;
  saaske02: number;
  saaske04: number;
  saaske07: number;
  saaske09: number;
};

export type apiError = {
  target_key: string;
  name: string;
  checked_at: Date;
  response_time: number | null;
  status_code: number | null;
  status_message: string | null;
  error_name: string | null;
  error_code: string | null;
};