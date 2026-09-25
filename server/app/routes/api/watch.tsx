import type { Route } from "./+types/watch";
import { createClient } from "~/lib/supabase";
import { getWatchSchedulerClient } from "~/lib/supabase/watchScheduler.server";
import {
  createWatchTargetStateUpdates,
  getServiceLabel,
  hasUnconfirmedFailures,
  toLogResults,
  type WatchTargetState,
} from "~/library/watch/incidentState";
import { getUtcMinute, getWatchSchedule } from "~/library/watch/schedule";
import { checkTarget } from "~/library/watch/checkTarget";
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
import type { Database } from "@/types/supabase";

const SUPABASE_TABLE_TARGETS = process.env.VITE_SUPABASE_TABLE_TARGETS as string;
const SUPABASE_TABLE_LOGS = process.env.VITE_SUPABASE_TABLE_LOGS as string;
const SUPABASE_TABLE_INCIDENTS = process.env.VITE_SUPABASE_TABLE_INCIDENTS as string;
const SUPABASE_TABLE_WATCH_STATES = "watch_target_states";

type IncidentLabel =
  | "saaske"
  | "saaske_api"
  | "saaske_webform"
  | "saaske_webtracking"
  | "saaske_other"
  | "works"
  | "web";

type Incident = Database["mikage"]["Tables"]["incidents"]["Row"];
type Target = Database["mikage"]["Tables"]["targets"]["Row"];

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
  const requestUrl = new URL(request.url);
  const watchKey = requestUrl.searchParams.get("key");
  if (watchKey !== process.env.VITE_WATCH_KEY) {
    return jsonResponse({ error: "Invalid key." }, 401);
  }

  const schedule = await getWatchSchedule();
  if (schedule.mode === "skip") {
    return skippedResponse(schedule.reason);
  }

  try {
    const { supabase } = createClient(request, "mikage");
    const { data: targets, error: targetError } = await supabase
      .from(SUPABASE_TABLE_TARGETS)
      .select("*")
      .order("key", { ascending: true });

    if (targetError || !targets?.length) {
      console.error("監視対象をSupabaseから取得できませんでした。");
      return jsonResponse({ error: "監視対象を取得できませんでした。" }, 503);
    }

    const schedulerSupabase = getWatchSchedulerClient();
    const slotStart = getUtcMinute(new Date());
    const targetKeys = targets.map(({ key }) => key);
    const { data: selectedKeys, error: reservationError } = await schedulerSupabase.rpc(
      "reserve_watch_run",
      {
        p_slot_start: slotStart,
        p_is_full_run: schedule.mode === "all",
        p_target_keys: targetKeys,
      }
    );

    if (reservationError || !selectedKeys) {
      console.error("監視枠をSupabaseで予約できませんでした。");
      return jsonResponse({ error: "監視枠を予約できませんでした。" }, 503);
    }

    if (selectedKeys.length === 0) {
      return skippedResponse("slot_already_reserved");
    }

    const selectedKeySet = new Set(selectedKeys);
    const selectedTargets = targets.filter((target) => selectedKeySet.has(target.key));
    const { data: previousStates, error: previousStateError } = await schedulerSupabase
      .from(SUPABASE_TABLE_WATCH_STATES)
      .select("*")
      .in("target_key", selectedKeys);

    if (previousStateError || !previousStates) {
      console.error("対象別の監視状態をSupabaseから取得できませんでした。");
      return jsonResponse({ error: "監視状態を取得できませんでした。" }, 503);
    }

    const results: LogResult[] = await Promise.all(
      selectedTargets.map(async (target) => ({
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
    const { error: logError } = await supabase.from(SUPABASE_TABLE_LOGS).insert(logRows);
    if (logError) {
      console.error("監視ログをSupabaseへ保存できませんでした。");
    }

    const stateUpdates = createWatchTargetStateUpdates(
      results,
      previousStates as WatchTargetState[],
      slotStart
    );
    const { error: stateUpdateError } = await schedulerSupabase
      .from(SUPABASE_TABLE_WATCH_STATES)
      .upsert(stateUpdates, { onConflict: "target_key" });

    if (stateUpdateError) {
      console.error("対象別の監視状態をSupabaseへ保存できませんでした。");
      return jsonResponse({ error: "監視状態を保存できませんでした。" }, 503);
    }

    const { data: targetStates, error: targetStatesError } = await schedulerSupabase
      .from(SUPABASE_TABLE_WATCH_STATES)
      .select("*");
    if (targetStatesError || !targetStates) {
      console.error("対象別の監視状態をSupabaseから再取得できませんでした。");
      return jsonResponse({ error: "監視状態を取得できませんでした。" }, 503);
    }

    const { data: incidents, error: incidentsError } = await supabase
      .from(SUPABASE_TABLE_INCIDENTS)
      .select("*")
      .is("is_closed", null);
    if (incidentsError || !incidents) {
      console.error("インシデント状態をSupabaseから取得できませんでした。");
      return jsonResponse({ error: "インシデント状態を取得できませんでした。" }, 503);
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
        const { data, error } = await supabase
          .from(SUPABASE_TABLE_INCIDENTS)
          .insert([{ keyword: label, count: 1, created_at: now.toISOString(), updated_at: now.toISOString() }])
          .select("*")
          .single();
        if (error || !data) {
          throw new Error("インシデントをSupabaseへ登録できませんでした。");
        }
        incident = data;
        isNewIncident = true;
      }

      if (errors.length > 0 && incident) {
        const notificationIsDue =
          isNewIncident || now.getTime() - Date.parse(incident.updated_at) >= 5 * 60 * 1000;
        if (!notificationIsDue) {
          return { status: "notification_interval_not_elapsed" };
        }

        const errorCount = isNewIncident ? incident.count : incident.count + 1;
        let instatusId = incident.instatus_id;
        let googleChatName = incident.googlechat_name;
        let instatusUrl: string | null = null;

        if (pageId && component) {
          if (!instatusId) {
            const instatusResult = await createIncidentInstatus({
              started: new Date(incident.created_at).toISOString(),
              page_id: pageId,
              components: [component],
              serviceName,
            });
            instatusId = instatusResult?.incident?.id ?? instatusResult?.id ?? null;
          } else {
            const instatusResult = await updateIncidentInstatus(instatusId, {
              started: now.toISOString(),
              page_id: pageId,
              components: [component],
            });
            instatusId = instatusResult?.incident?.id ?? instatusResult?.id ?? instatusId;
          }
        }

        if (instatusId) {
          const subDomain = label === "works" ? "works" : "saaske";
          instatusUrl = `https://${subDomain}.instatus.com/${instatusId}`;
        }

        if (!googleChatName) {
          const googleChatResult = await createThreadGoogleChat(errors, instatusUrl);
          googleChatName = googleChatResult?.thread?.name ?? null;
          if (googleChatName) {
            await updateThreadGoogleChat(errors, googleChatName);
          }
        } else {
          await updateThreadGoogleChat(errors, googleChatName);
        }

        const { error } = await supabase
          .from(SUPABASE_TABLE_INCIDENTS)
          .update({
            count: errorCount,
            updated_at: now.toISOString(),
            googlechat_name: googleChatName,
            instatus_id: instatusId,
          })
          .eq("id", incident.id);
        if (error) {
          throw new Error("インシデント状態をSupabaseへ保存できませんでした。");
        }

        return { status: isNewIncident ? "notified" : "updated" };
      }

      if (errors.length === 0 && incident) {
        if (incident.googlechat_name) {
          await resolveThreadGoogleChat([], incident.googlechat_name);
        }
        if (incident.instatus_id && pageId && component) {
          await resolveIncidentInstatus(incident.instatus_id, {
            started: now.toISOString(),
            page_id: pageId,
            components: [component],
          });
        }

        const { error } = await supabase
          .from(SUPABASE_TABLE_INCIDENTS)
          .update({ is_closed: true, updated_at: now.toISOString() })
          .eq("id", incident.id);
        if (error) {
          throw new Error("インシデントをSupabaseで解決できませんでした。");
        }
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
      const incident = incidents.find((item) => item.keyword === label);

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
    console.error(
      "監視処理に失敗しました。",
      error instanceof Error ? error.name : "UnknownError"
    );
    return jsonResponse({ error: "監視処理に失敗しました。" }, 503);
  }
}
