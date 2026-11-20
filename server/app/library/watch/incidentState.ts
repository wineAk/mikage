import type { LogResult } from "@/types/watch";

export type WatchTargetState = {
  target_key: string;
  last_reserved_at: string | null;
  last_checked_at: string | null;
  first_failed_at: string | null;
  failure_confirmed_at: string | null;
  response_time: number | null;
  status_code: number | null;
  status_message: string | null;
  error_name: string | null;
  error_code: string | null;
};

type Target = {
  key: string;
  name: string;
};

export function getServiceLabel(targetKey: string):
  | "saaske"
  | "saaske_api"
  | "saaske_webform"
  | "saaske_webtracking"
  | "saaske_other"
  | "works"
  | "web"
  | null {
  if (/^saaske\d+$/.test(targetKey)) return "saaske";
  if (targetKey === "saaske_api") return "saaske_api";
  if (targetKey === "saaske_webform") return "saaske_webform";
  if (/^saaske_webtracking(_v2)?$/.test(targetKey)) return "saaske_webtracking";
  if (/^saaske_(broad_ap|sfc)$/.test(targetKey)) return "saaske_other";
  if (/^works\d+$/.test(targetKey)) return "works";
  if (/^web_/.test(targetKey)) return "web";
  return null;
}

export function toLogResults(
  states: WatchTargetState[],
  targets: Target[],
  confirmedOnly: boolean
): LogResult[] {
  const targetsByKey = new Map(targets.map((target) => [target.key, target]));

  return states.flatMap((state) => {
    const target = targetsByKey.get(state.target_key);
    const isActiveFailure = state.first_failed_at !== null;
    const isConfirmedFailure = state.failure_confirmed_at !== null;
    if (
      !target ||
      !isActiveFailure ||
      (confirmedOnly && !isConfirmedFailure)
    ) {
      return [];
    }

    return [{
      key: target.key,
      name: target.name,
      log: {
        startDate: state.last_checked_at ? Date.parse(state.last_checked_at) : 0,
        responseTime: state.response_time,
        statusCode: state.status_code,
        statusMessage: state.status_message,
        errorName: state.error_name,
        errorCode: state.error_code,
      },
    }];
  });
}

export function hasUnconfirmedFailures(states: WatchTargetState[]) {
  return states.some(
    (state) => state.first_failed_at !== null && state.failure_confirmed_at === null
  );
}
