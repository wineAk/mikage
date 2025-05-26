// api/404.tsx
export type NotFound = {
  data: null;
  error: string;
}

// api/errors.tsx
export type ErrorLog = {
  name: string;
  target_key: string;
  created_at: string;
  response_time: number | null;
  status_code: number | null;
  status_message: string | null;
  error_code: string | null;
  error_name: string | null;
}

export type Error = {
  // 前月の件数
  previous_month_count: number;
  // 次月の件数
  next_month_count: number;
  // 今月のログ
  logs: ErrorLog[];
}

// api/incidents.tsx
export type Incident = {
  keyword: string;
  created_at: string;
  updated_at: string;
  count: number;
  is_closed: boolean;
  googlechat_name: string | null;
  instatus_id: string | null;
}

// api/index.tsx
export type Index = {
  data: [];
  error: null;
}

// api/keys.tsx
export type KeyLog = {
  created_at: string;
  response_time: number | null;
  status_code: number | null;
  status_message: string | null;
  error_code: string | null;
  error_name: string | null;
};

export type Key = {
  key: string;
  name: string;
  logs: KeyLog[];
};

// api/targets.tsx
export type Target = {
  key: string;
  name: string;
}

