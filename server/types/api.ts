// api/404.tsx
export type NotFound = {
  data: null;
  error: string;
}

// api/errors.tsx
export type Error = {
  name: string;
  target_key: string;
  created_at: string;
  response_time: number | null;
  status_code: number | null;
  status_message: string | null;
  error_code: string | null;
  error_name: string | null;
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

