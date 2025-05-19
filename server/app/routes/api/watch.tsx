import type { Route } from "./+types/watch";
import { createClient } from "~/library/supabase/server";
import { isNetworkAvailable, checkTarget } from "~/library/watch/checkTarget";
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

export async function loader({ request }: Route.LoaderArgs) {
  // パラメータを取得
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (key !== process.env.VITE_WATCH_KEY) {
    return new Response(JSON.stringify({ error: "Invalid key." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { supabase } = createClient(request, "mikage");

  // 対象取得
  const { data } = await supabase.from("targets").select("*");

  // ネットワークチェックを最初に1回だけ実行
  // const isAvailable = await isNetworkAvailable();
  // if (!isAvailable) {
  //   const results = (data ?? []).map(target => ({
  //     key: target.key,
  //     name: target.name,
  //     log: {
  //      responseTime: null,
  //      statusCode: null,
  //      statusMessage: null,
  //      errorName: "NetworkUnavailable",
  //      errorCode: "NO_INTERNET",
  //    }
  //    }));
  //    return new Response(JSON.stringify({ results }), {
  //      headers: { "Content-Type": "application/json" },
  //    });
  // }

  // 全ターゲットのチェックを非同期で行う
  const checkPromises = (data ?? []).map(async (target) => {
    const { key, name, url, headers } = target;
    const log = await checkTarget({ url, headers });
    return { key, name, log };
  });
  // 全レスポンスをまとめて取得
  const results = await Promise.all(checkPromises);
  // まとめてDBへinsert
  const insertRows = results.map(({ key, log }) => ({
    target_key: key,
    checked_at: new Date(),
    response_time: log.responseTime,
    status_code: log.statusCode,
    status_message: log.statusMessage,
    error_name: log.errorName,
    error_code: log.errorCode,
  }));
  const result = await supabase.from("logs").insert(insertRows);
  if (result) {
    console.log(`📝 ${insertRows.length}件のログをまとめて登録しました`);
  } else {
    console.log(`❌ ログ登録に失敗しました`);
  }

  /*
  // テストデータ
  const resultsStable = [
    {
      key: "works09",
      name: "Works09",
      log: {
        startDate: 1747274301570,
        responseTime: 541,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske00",
      name: "Saaske00",
      log: {
        startDate: 1747274301852,
        responseTime: 481,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske01",
      name: "Saaske01",
      log: {
        startDate: 1747274301661,
        responseTime: 377,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske02",
      name: "Saaske02",
      log: {
        startDate: 1747274301695,
        responseTime: 485,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske03",
      name: "Saaske03",
      log: {
        startDate: 1747274301857,
        responseTime: 495,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske_api",
      name: "Saaske API",
      log: {
        startDate: 1747274301603,
        responseTime: 387,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webform",
      name: "Webフォーム",
      log: {
        startDate: 1747274301832,
        responseTime: 585,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webtracking",
      name: "Web行動解析",
      log: {
        startDate: 1747274301788,
        responseTime: 4,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "works07",
      name: "Works07",
      log: {
        startDate: 1747274301865,
        responseTime: 593,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske04",
      name: "Saaske04",
      log: {
        startDate: 1747274301649,
        responseTime: 478,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske05",
      name: "Saaske05",
      log: {
        startDate: 1747274301861,
        responseTime: 407,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske07",
      name: "Saaske07",
      log: {
        startDate: 1747274301623,
        responseTime: 337,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske09",
      name: "Saaske09",
      log: {
        startDate: 1747274301658,
        responseTime: 486,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
  ];
  const resultsAllError = [
    {
      key: "works09",
      name: "Works09",
      log: {
        startDate: 1747274301570,
        responseTime: 10003,
        statusCode: 408,
        statusMessage: "Request Timeout",
        errorName: "TimeoutError",
        errorCode: "ETIMEDOUT",
      },
    },
    {
      key: "saaske00",
      name: "Saaske00",
      log: {
        startDate: 1747274301852,
        responseTime: 10003,
        statusCode: 408,
        statusMessage: "Request Timeout",
        errorName: "TimeoutError",
        errorCode: "ETIMEDOUT",
      },
    },
    {
      key: "saaske01",
      name: "Saaske01",
      log: {
        startDate: 1747274301661,
        responseTime: 377,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske02",
      name: "Saaske02",
      log: {
        startDate: 1747274301695,
        responseTime: 485,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske03",
      name: "Saaske03",
      log: {
        startDate: 1747274301857,
        responseTime: 495,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske_api",
      name: "Saaske API",
      log: {
        startDate: 1747274301603,
        responseTime: 387,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webform",
      name: "Webフォーム",
      log: {
        startDate: 1747274301832,
        responseTime: 585,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webtracking",
      name: "Web行動解析",
      log: {
        startDate: 1747274301788,
        responseTime: 4,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "works07",
      name: "Works07",
      log: {
        startDate: 1747274301865,
        responseTime: 593,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske04",
      name: "Saaske04",
      log: {
        startDate: 1747274301649,
        responseTime: 478,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske05",
      name: "Saaske05",
      log: {
        startDate: 1747274301861,
        responseTime: 407,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske07",
      name: "Saaske07",
      log: {
        startDate: 1747274301623,
        responseTime: 337,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske09",
      name: "Saaske09",
      log: {
        startDate: 1747274301658,
        responseTime: 486,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
  ];
  const resultsSaaskeError = [
    {
      key: "works09",
      name: "Works09",
      log: {
        startDate: 1747274301570,
        responseTime: 541,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske00",
      name: "Saaske00",
      log: {
        startDate: 1747274301852,
        responseTime: 10003,
        statusCode: 408,
        statusMessage: "Request Timeout",
        errorName: "TimeoutError",
        errorCode: "ETIMEDOUT",
      },
    },
    {
      key: "saaske01",
      name: "Saaske01",
      log: {
        startDate: 1747274301661,
        responseTime: 23,
        statusCode: 502,
        statusMessage: "Bad Gateway",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske02",
      name: "Saaske02",
      log: {
        startDate: 1747274301695,
        responseTime: 485,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske03",
      name: "Saaske03",
      log: {
        startDate: 1747274301857,
        responseTime: 495,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske_api",
      name: "Saaske API",
      log: {
        startDate: 1747274301603,
        responseTime: 387,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webform",
      name: "Webフォーム",
      log: {
        startDate: 1747274301832,
        responseTime: 585,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webtracking",
      name: "Web行動解析",
      log: {
        startDate: 1747274301788,
        responseTime: 4,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "works07",
      name: "Works07",
      log: {
        startDate: 1747274301865,
        responseTime: 593,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske04",
      name: "Saaske04",
      log: {
        startDate: 1747274301649,
        responseTime: 478,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske05",
      name: "Saaske05",
      log: {
        startDate: 1747274301861,
        responseTime: 407,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske07",
      name: "Saaske07",
      log: {
        startDate: 1747274301623,
        responseTime: 337,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske09",
      name: "Saaske09",
      log: {
        startDate: 1747274301658,
        responseTime: 486,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
  ];
  const resultsWorksError = [
    {
      key: "works09",
      name: "Works09",
      log: {
        startDate: 1747274301570,
        responseTime: 10003,
        statusCode: 408,
        statusMessage: "Request Timeout",
        errorName: "TimeoutError",
        errorCode: "ETIMEDOUT",
      },
    },
    {
      key: "saaske00",
      name: "Saaske00",
      log: {
        startDate: 1747274301852,
        responseTime: 486,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske01",
      name: "Saaske01",
      log: {
        startDate: 1747274301661,
        responseTime: 377,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske02",
      name: "Saaske02",
      log: {
        startDate: 1747274301695,
        responseTime: 485,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske03",
      name: "Saaske03",
      log: {
        startDate: 1747274301857,
        responseTime: 495,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske_api",
      name: "Saaske API",
      log: {
        startDate: 1747274301603,
        responseTime: 387,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webform",
      name: "Webフォーム",
      log: {
        startDate: 1747274301832,
        responseTime: 585,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "webtracking",
      name: "Web行動解析",
      log: {
        startDate: 1747274301788,
        responseTime: 4,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "works07",
      name: "Works07",
      log: {
        startDate: 1747274301865,
        responseTime: 593,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske04",
      name: "Saaske04",
      log: {
        startDate: 1747274301649,
        responseTime: 478,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske05",
      name: "Saaske05",
      log: {
        startDate: 1747274301861,
        responseTime: 407,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske07",
      name: "Saaske07",
      log: {
        startDate: 1747274301623,
        responseTime: 337,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
    {
      key: "saaske09",
      name: "Saaske09",
      log: {
        startDate: 1747274301658,
        responseTime: 486,
        statusCode: 200,
        statusMessage: "OK",
        errorName: null,
        errorCode: null,
      },
    },
  ];
  const results = resultsStable;
  */

  // エラーがある配列を返す関数
  function findErrorResults(
    results: LogResult[],
    key: string | string[]
  ): LogResult[] {
    const keys = Array.isArray(key) ? key : [key];
    const filtered = results.filter(
      (result) =>
        keys.some((k) => result.key.includes(k)) &&
        (result.log.statusCode !== 200 ||
          (result.log.errorCode !== null &&
            result.log.errorCode !== "NO_INTERNET"))
    );
    return filtered;
  }
  const saaskeErrors = findErrorResults(results, "saaske");
  const worksErrors = findErrorResults(results, "works");
  //const anyErrors = findErrorResults(results, ["saaske", "works"]);

  // インシデント状況を取得
  type Incident = Database["mikage"]["Tables"]["incident"]["Row"];
  const { data: incidentData }: { data: Incident[] | null } = await supabase
    .from("incident")
    .select("*");
  const saaskeIncident = incidentData?.find(
    (incident) => incident.key === "saaske"
  );
  const worksIncident = incidentData?.find(
    (incident) => incident.key === "works"
  );
  if (!saaskeIncident || !worksIncident) {
    return new Response(JSON.stringify({ results }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // インシデントを更新する関数
  async function handleIncident(
    label: string,
    errors: LogResult[],
    incident: Incident
  ): Promise<any> {
    const { last_updated, googlechat_name, instatus_id } = incident;
    const now = new Date();
    // --- エラーがある場合 ---
    if (errors.length > 0) {
      // 1回目
      if (!last_updated && !googlechat_name) {
        console.log(`${label} エラー1回目`);
        // upsertでlast_updatedのみ更新
        const supabaseResult = await supabase
          .from("incident")
          .upsert([{ key: label, last_updated: now }], { onConflict: "key" });
        return { supabaseResult, googleChatResult: null, instatusResult: null };
      }
      // 2回目
      if (last_updated && !googlechat_name) {
        console.log(`${label} エラー2回目`);
        const googleChatResult = await createThreadGoogleChat(errors);
        const started = new Date(last_updated).toISOString();
        const instatusResult =
          label === "works" ? await createIncidentInstatus(started) : null;
        // 2回目はgooglechat_nameとinstatus_idをセット
        const supabaseResult = await supabase
          .from("incident")
          .update({
            googlechat_name: googleChatResult.thread.name,
            instatus_id: instatusResult?.id,
          })
          .eq("key", label);
        return { supabaseResult, googleChatResult, instatusResult };
      }
      // 3回目以降
      if (last_updated && googlechat_name) {
        console.log(`${label} エラー3回目以降`);
        const diffMin =
          (now.getTime() - new Date(last_updated).getTime()) / 60000;
        const googleChatResult = await updateThreadGoogleChat(
          errors,
          googlechat_name
        );
        if (label === "works" && diffMin >= 5 && instatus_id) {
          console.log(`${label} エラー3回目以降 & 5分経過`);
          const started = now.toISOString();
          const instatusResult = await updateIncidentInstatus(
            instatus_id,
            started
          );
          const supabaseResult = await supabase
            .from("incident")
            .update({ last_updated: now })
            .eq("key", label);
          return { supabaseResult, googleChatResult, instatusResult };
        }
        return { supabaseResult: null, googleChatResult, instatusResult: null };
      }
    }
    // --- エラーがない場合 ---
    // 何もしない
    if (!last_updated && !googlechat_name) {
      console.log(`${label} なにもしない`);
      return {
        supabaseResult: null,
        googleChatResult: null,
        instatusResult: null,
      };
    }
    // 日付だけある or 両方あるときは全て空にする
    if (last_updated) {
      let googleChatResult = null;
      let instatusResult = null;
      if (googlechat_name) {
        console.log(`${label} 両方あるときは全て空にする`);
        googleChatResult = await resolveThreadGoogleChat(
          errors,
          googlechat_name
        );
        if (label === "works" && instatus_id) {
          const started = now.toISOString();
          instatusResult = await resolveIncidentInstatus(instatus_id, started);
        }
      } else {
        console.log(`${label} 日付だけあるときは全て空にする`);
      }
      const supabaseResult = await supabase
        .from("incident")
        .update({
          last_updated: null,
          googlechat_name: null,
          instatus_id: null,
        })
        .eq("key", label);
      return { supabaseResult, googleChatResult, instatusResult };
    }
  }

  // 呼び出し
  const worksResult = await handleIncident(
    "works",
    worksErrors,
    worksIncident!
  );
  const saaskeResult = await handleIncident(
    "saaske",
    saaskeErrors,
    saaskeIncident!
  );

  return new Response(JSON.stringify({ results, worksResult, saaskeResult }), {
    headers: { "Content-Type": "application/json" },
  });
}
