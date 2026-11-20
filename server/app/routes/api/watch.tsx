import type { Route } from "./+types/watch";
import { fetchMikageApi } from "~/lib/mikageApi.server";
import {
  getServiceLabel,
  hasUnconfirmedFailures,
  toLogResults,
  type WatchTargetState,
} from "~/library/watch/incidentState";
import { getWatchSchedule } from "~/library/watch/schedule";
import { checkTarget } from "~/library/watch/checkTarget";
import { isAuthorizedWatchExecuteRequest } from "~/library/watch/executeAuth.mjs";
import {
  areExternalNotificationsEnabled,
  isPreviewNotificationMockEnabled,
  isWatchExecutionEnabled,
} from "~/library/watch/notificationEnvironment.mjs";
import { isIncidentNotificationDue } from "~/library/watch/incidentNotificationPolicy.mjs";
import {
  deliverActiveIncidentNotifications,
  deliverResolvedIncidentNotifications,
} from "~/library/watch/incidentNotificationDelivery.mjs";
import { PreviewNotificationAbortError } from "~/library/watch/previewNotification.mjs";
import { parseWatchSlot } from "~/library/watch/watchSlot.mjs";
import {
  createIncidentInstatus,
  updateIncidentInstatus,
  resolveIncidentInstatus,
} from "~/library/watch/instatus";
import {
  createThreadGoogleChat,
  updateThreadGoogleChat,
  resolveThreadGoogleChat,
} from "~/library/watch/googlechat";
import type { LogResult } from "@/types/watch";

type IncidentLabel =
  | "saaske"
  | "saaske_api"
  | "saaske_webform"
  | "saaske_webtracking"
  | "saaske_other"
  | "works"
  | "web";

type Incident = {
  id: number | string;
  keyword: string;
  count: number;
  created_at: string;
  updated_at: string;
  is_closed: boolean | null;
  googlechat_name: string | null;
  instatus_id: string | null;
  notification_pending: boolean;
};
type Target = {
  key: string;
  name: string;
  url: string;
  headers: Record<string, string> | null;
};

const INCIDENT_LABELS: IncidentLabel[] = [
  "saaske",
  "saaske_api",
  "saaske_webform",
  "saaske_webtracking",
  "saaske_other",
  "works",
  "web",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function skippedResponse(reason: string) {
  return jsonResponse({
    resultsAll: {
      results: [],
      works: { status: "skipped" },
      saaske: { status: "skipped" },
      saaske_api: { status: "skipped" },
      saaske_webform: { status: "skipped" },
      saaske_webtracking: { status: "skipped" },
      saaske_other: { status: "skipped" },
      web: { status: "skipped" },
    },
    execution: { executed: false, reason },
  });
}

function getInstatusSettings(label: IncidentLabel) {
  const saaskePageId = process.env.VITE_INSTATUS_SAASKE_PAGE_ID ?? "";
  const worksPageId = process.env.VITE_INSTATUS_WORKS_PAGE_ID ?? "";
  const components: Partial<Record<IncidentLabel, string>> = {
    saaske: process.env.VITE_INSTATUS_SAASKE_COMPONENT_SAASKE,
    saaske_api: process.env.VITE_INSTATUS_SAASKE_COMPONENT_API,
    saaske_webform: process.env.VITE_INSTATUS_SAASKE_COMPONENT_WEBFORM,
    saaske_webtracking: process.env.VITE_INSTATUS_SAASKE_COMPONENT_WEBTRACKING,
    works: process.env.VITE_INSTATUS_WORKS_COMPONENT_WORKS,
  };
  const serviceNames: Partial<Record<IncidentLabel, string>> = {
    saaske: "サスケ",
    saaske_api: "サスケAPI",
    saaske_webform: "Webフォーム",
    saaske_webtracking: "Web行動解析",
    works: "Works",
  };

  return {
    pageId: label === "works" ? worksPageId : saaskePageId,
    component: components[label] ?? "",
    serviceName: serviceNames[label] ?? "",
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!isAuthorizedWatchExecuteRequest(request, process.env.MIKAGE_WATCH_EXECUTE_TOKEN)) {
    return jsonResponse({ error: "Invalid key." }, 401);
  }
  if (!isWatchExecutionEnabled(process.env)) {
    return jsonResponse({ error: "Preview watch execution is disabled." }, 503);
  }

  const watchSlot = parseWatchSlot(request.headers.get("X-Mikage-Watch-Slot"));
  if (!watchSlot) {
    return jsonResponse({ error: "監視slotが不正です。" }, 400);
  }

  const slotStart = watchSlot.slotStart;
  const schedule = await getWatchSchedule(watchSlot.date);
  if (schedule.mode === "skip") {
    return skippedResponse(schedule.reason);
  }

  try {
    const externalNotificationsEnabled = areExternalNotificationsEnabled(process.env);
    const previewNotificationMockEnabled = isPreviewNotificationMockEnabled(process.env);
    const incidentNotificationsEnabled = externalNotificationsEnabled || previewNotificationMockEnabled;
    const instatusClients = {
      createIncident: createIncidentInstatus,
      updateIncident: updateIncidentInstatus,
      resolveIncident: resolveIncidentInstatus,
    };
    const googleChatClients = {
      createThread: createThreadGoogleChat,
      updateThread: updateThreadGoogleChat,
      resolveThread: resolveThreadGoogleChat,
    };
    const reservation = await fetchMikageApi<{
      selected_target_keys: string[];
      selected_target_names: Record<string, string>;
      saved_results: Array<{
        target_key: string;
        created_at: string;
        response_time: number | null;
        status_code: number | null;
        status_message: string | null;
        error_name: string | null;
        error_code: string | null;
      }> | null;
    }>("watch-reservations", {
      method: "POST",
      body: { slot_start: slotStart, is_full_run: schedule.mode === "all" },
      signal: request.signal,
    });
    const selectedKeys = reservation.selected_target_keys;

    if (!Array.isArray(selectedKeys)) {
      console.error("監視枠をミカゲAPIで予約できませんでした。");
      return jsonResponse({ error: "監視枠を予約できませんでした。" }, 503);
    }

    if (selectedKeys.length === 0) {
      return skippedResponse("slot_already_reserved");
    }

    const { targets: activeTargets } = await fetchMikageApi<{ targets: Target[] }>("watch-targets", { signal: request.signal });
    const targetsByKey = new Map(activeTargets.map((target) => [target.key, target]));
    for (const targetKey of selectedKeys) {
      if (!targetsByKey.has(targetKey)) {
        const name = reservation.selected_target_names[targetKey];
        if (name) targetsByKey.set(targetKey, { key: targetKey, name, url: "", headers: null });
      }
    }
    const targets = [...targetsByKey.values()];
    const selectedTargets = selectedKeys.map((targetKey) => targetsByKey.get(targetKey)).filter((target): target is Target => target !== undefined);
    if (selectedTargets.length !== selectedKeys.length) {
      console.error("予約済みtargetを復元できませんでした。");
      return jsonResponse({ error: "予約済みtargetを復元できませんでした。" }, 503);
    }

    let results: LogResult[];
    if (Array.isArray(reservation.saved_results)) {
      results = reservation.saved_results.map((result) => {
        const target = targetsByKey.get(result.target_key);
        if (!target) throw new Error("保存済み結果のtargetを復元できませんでした。");
        return {
          key: result.target_key,
          name: target.name,
          log: {
            startDate: Date.parse(result.created_at),
            responseTime: result.response_time,
            statusCode: result.status_code,
            statusMessage: result.status_message,
            errorName: result.error_name,
            errorCode: result.error_code,
          },
        };
      });
    } else {
      const checkTargets = selectedTargets.filter((target) => target.url.length > 0);
      if (checkTargets.length !== selectedTargets.length) {
        console.error("監視対象のURLを取得できませんでした。");
        return jsonResponse({ error: "監視対象のURLを取得できませんでした。" }, 503);
      }
      results = await Promise.all(
        checkTargets.map(async (target) => ({
          key: target.key,
          name: target.name,
          log: await checkTarget({ url: target.url, headers: target.headers ?? undefined }),
        }))
      );

      const logRows = results.map(({ key, log }) => ({
        target_key: key,
        created_at: new Date(log.startDate).toISOString(),
        response_time: log.responseTime,
        status_code: log.statusCode,
        status_message: log.statusMessage,
        error_name: log.errorName,
        error_code: log.errorCode,
      }));
      const savedResults = await fetchMikageApi<{ saved: boolean }>("watch-results", {
        method: "POST",
        body: { slot_start: slotStart, results: logRows },
        signal: request.signal,
      });

      if (!savedResults.saved) {
        console.error("監視ログと状態をミカゲAPIへ保存できませんでした。");
        return jsonResponse({ error: "監視状態を保存できませんでした。" }, 503);
      }
    }

    const { states: targetStates, active_incidents: activeIncidents } = await fetchMikageApi<{ states: WatchTargetState[]; active_incidents: Incident[] }>("watch-state", { signal: request.signal });
    if (!Array.isArray(targetStates) || !Array.isArray(activeIncidents)) {
      console.error("監視状態をミカゲAPIから再取得できませんでした。");
      return jsonResponse({ error: "監視状態を取得できませんでした。" }, 503);
    }

    async function handleIncident(
      label: IncidentLabel,
      errors: LogResult[],
      currentIncident: Incident | undefined
    ) {
      const now = new Date();
      const { pageId, component, serviceName } = getInstatusSettings(label);
      let incident = currentIncident;
      let isNewIncident = false;

      if (errors.length > 0 && !incident) {
        const created = await fetchMikageApi<{ incident_id: number | string; duplicate: boolean }>("watch-incidents", {
          method: "POST",
          body: {
            request_id: `${slotStart}:${label}:open`,
            operation: "open",
            keyword: label,
            incident_id: null,
            now: now.toISOString(),
            count: 1,
          },
          signal: request.signal,
        });
        if (!created.incident_id) throw new Error("インシデントをミカゲAPIへ登録できませんでした。");
        incident = {
          id: created.incident_id,
          keyword: label,
          count: 1,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          is_closed: null,
          googlechat_name: null,
          instatus_id: null,
          notification_pending: true,
        };
        isNewIncident = true;
      }

      if (errors.length > 0 && incident) {
        const notificationIsDue = isIncidentNotificationDue({
          isNewIncident,
          isNotificationPending: incident.notification_pending,
          updatedAt: incident.updated_at,
          now,
        });
        if (!notificationIsDue) {
          return { status: "notification_interval_not_elapsed" };
        }

        if (!incident.notification_pending) {
          await fetchMikageApi("watch-incidents", {
            method: "POST",
            body: {
              request_id: `${slotStart}:${label}:pending`,
              operation: "notification_pending",
              keyword: label,
              incident_id: incident.id,
              now: slotStart,
            },
            signal: request.signal,
          });
          incident.notification_pending = true;
        }

        const errorCount = isNewIncident ? Number(incident.count) : Number(incident.count) + 1;
        const delivery = await deliverActiveIncidentNotifications({
          environment: process.env,
          label,
          errors,
          incident,
          pageId,
          component,
          serviceName,
          now,
          instatusClients,
          googleChatClients,
        });
        const instatusId = delivery.instatusId;
        const googleChatName = delivery.googleChatName;

        await fetchMikageApi("watch-incidents", {
          method: "POST",
          body: {
            request_id: `${slotStart}:${label}:update`,
            operation: "update",
            keyword: label,
            incident_id: incident.id,
            now: now.toISOString(),
            count: errorCount,
            googlechat_name: googleChatName,
            instatus_id: instatusId,
          },
          signal: request.signal,
        });

        if (!incidentNotificationsEnabled) {
          return { status: "recorded_without_notifications" };
        }
        if (previewNotificationMockEnabled) {
          return { status: isNewIncident ? "preview_mock_notified" : "preview_mock_updated" };
        }
        return { status: isNewIncident ? "notified" : "updated" };
      }

      if (errors.length === 0 && incident) {
        await deliverResolvedIncidentNotifications({
          environment: process.env,
          incident,
          pageId,
          component,
          now,
          instatusClients,
          googleChatClients,
        });

        await fetchMikageApi("watch-incidents", {
          method: "POST",
          body: {
            request_id: `${slotStart}:${label}:close`,
            operation: "close",
            keyword: label,
            incident_id: incident.id,
            now: now.toISOString(),
          },
          signal: request.signal,
        });
        return { status: "resolved" };
      }

      return { status: "unchanged" };
    }

    const resultsByLabel: Partial<Record<IncidentLabel, unknown>> = {};
    for (const label of INCIDENT_LABELS) {
      const serviceTargets = targets.filter((target) => getServiceLabel(target.key) === label);
      const serviceStates = (targetStates as WatchTargetState[]).filter(
        (state) => getServiceLabel(state.target_key) === label
      );
      const confirmedErrors = toLogResults(
        serviceStates,
        targets as Target[],
        true
      );
      const hasPendingFailures = hasUnconfirmedFailures(serviceStates);
      const incident = activeIncidents.find((item) => item.keyword === label);

      if (confirmedErrors.length > 0) {
        resultsByLabel[label] = await handleIncident(label, confirmedErrors, incident);
      } else if (hasPendingFailures) {
        resultsByLabel[label] = { status: "confirmation_pending" };
      } else {
        const stateByKey = new Map(
          serviceStates.map((state) => [state.target_key, state])
        );
        const allTargetsChecked = serviceTargets.length > 0 && serviceTargets.every((target) => {
          const state = stateByKey.get(target.key);
          return state?.last_checked_at !== null && state?.last_checked_at !== undefined;
        });

        if (incident && allTargetsChecked) {
          resultsByLabel[label] = await handleIncident(label, [], incident);
        } else {
          resultsByLabel[label] = { status: "unchanged" };
        }
      }
    }

    const resultsAll = {
      results,
      works: resultsByLabel.works,
      saaske: resultsByLabel.saaske,
      saaske_api: resultsByLabel.saaske_api,
      saaske_webform: resultsByLabel.saaske_webform,
      saaske_webtracking: resultsByLabel.saaske_webtracking,
      saaske_other: resultsByLabel.saaske_other,
      web: resultsByLabel.web,
    };

    return jsonResponse({
      resultsAll,
      execution: { executed: true, reason: schedule.reason },
    });

  } catch (error) {
    if (error instanceof PreviewNotificationAbortError) {
      console.error("監視処理に失敗しました。", error.name);
      return jsonResponse({ error: "監視処理に失敗しました。" }, 503);
    }
    console.error(
      "監視処理に失敗しました。",
      error instanceof Error ? error.name : "UnknownError"
    );
    return jsonResponse({ error: "監視処理に失敗しました。" }, 503);
  }
}
