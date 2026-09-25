import type { LogResult } from "@/types/watch";
import type { Database } from "@/types/supabase";

export type WatchTargetState = Database["mikage"]["Tables"]["watch_target_states"]["Row"];

type Target = {
  key: string;
  name: string;
};

export type WatchTargetStateUpdate = Database["mikage"]["Tables"]["watch_target_states"]["Insert"];

export function isWatchFailure(result: LogResult) {
  const hasErrorStatus = result.log.statusCode !== 200;
  const hasActionableError =
    result.log.errorCode !== null && result.log.errorCode !== "NO_INTERNET";

  return hasErrorStatus || hasActionableError;
}

export function createWatchTargetStateUpdates(
  results: LogResult[],
  previousStates: WatchTargetState[],
  reservedAt: string
): WatchTargetStateUpdate[] {
  const previousStateByKey = new Map(
    previousStates.map((state) => [state.target_key, state])
  );

  return results.map((result) => {
    const previousState = previousStateByKey.get(result.key);
    const checkedAt = new Date(result.log.startDate).toISOString();
    const hasFailed = isWatchFailure(result);
    let firstFailedAt: string | null = null;
    let failureConfirmedAt: string | null = null;

    if (hasFailed) {
      firstFailedAt = previousState?.first_failed_at ?? checkedAt;
      if (previousState?.failure_confirmed_at) {
        failureConfirmedAt = previousState.failure_confirmed_at;
      } else if (Date.parse(checkedAt) - Date.parse(firstFailedAt) >= 5 * 60 * 1000) {
        failureConfirmedAt = checkedAt;
      }
    }

    return {
      target_key: result.key,
      last_reserved_at: reservedAt,
      last_checked_at: checkedAt,
      first_failed_at: firstFailedAt,
      failure_confirmed_at: failureConfirmedAt,
      response_time: result.log.responseTime,
      status_code: result.log.statusCode,
      status_message: result.log.statusMessage,
      error_name: result.log.errorName,
      error_code: result.log.errorCode,
    };
  });
}

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
