import type { Route } from "./+types/watch";
import { createClient } from "~/lib/supabase";
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
    created_at: new Date(),
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
    key: RegExp
  ): LogResult[] {
    return results.filter((result) => {
      const keyMatches = key.test(result.key);
      const isErrorStatus = result.log.statusCode !== 200;
      const hasActionableError  = result.log.errorCode !== null && result.log.errorCode !== "NO_INTERNET";
      return keyMatches && (isErrorStatus || hasActionableError);
    });
  }

  // インシデントを更新する関数
  async function handleIncident(
    label: "saaske" | "saaske_api" | "saaske_webform" | "saaske_webtracking" | "saaske_other" | "works" | "web",
    errors: LogResult[],
    incident: Incidents | undefined
  ): Promise<any> {
    // 現在の時刻
    const now = new Date();
    // 結果
    let supabaseResult, googleChatResult, instatusResult;
    
    // Instatusの環境変数
    const INSTATUS_SAASKE_PAGE_ID = process.env.VITE_INSTATUS_SAASKE_PAGE_ID as string;
    const INSTATUS_SAASKE_COMPONENT_API = process.env.VITE_INSTATUS_SAASKE_COMPONENT_API as string;
    const INSTATUS_SAASKE_COMPONENT_CTI = process.env.VITE_INSTATUS_SAASKE_COMPONENT_CTI as string;
    const INSTATUS_SAASKE_COMPONENT_SAASKE = process.env.VITE_INSTATUS_SAASKE_COMPONENT_SAASKE as string;
    const INSTATUS_SAASKE_COMPONENT_WEBFORM = process.env.VITE_INSTATUS_SAASKE_COMPONENT_WEBFORM as string;
    const INSTATUS_WORKS_PAGE_ID = process.env.VITE_INSTATUS_WORKS_PAGE_ID as string;
    const INSTATUS_WORKS_COMPONENT_WORKS = process.env.VITE_INSTATUS_WORKS_COMPONENT_WORKS as string;
    // Instatusのオプション変数
    let page_id = "";
    let component = "";
    switch (label) {
      case "saaske":
        page_id = INSTATUS_SAASKE_PAGE_ID;
        component = INSTATUS_SAASKE_COMPONENT_SAASKE;
        break;
      case "saaske_api":
        page_id = INSTATUS_SAASKE_PAGE_ID;
        component = INSTATUS_SAASKE_COMPONENT_API;
        break;
      case "works":
        page_id = INSTATUS_WORKS_PAGE_ID;
        component = INSTATUS_WORKS_COMPONENT_WORKS;
        break;
    }

    // エラーがある
    if (errors.length > 0) {
      // 1回目
      if (!incident){
        console.log(`${label} エラー1回目`);
        supabaseResult = await supabase
          .from("incidents")
          .insert([{ keyword: label, created_at: now, updated_at: now }]);
      }
      // 2回目以降
      else {
        const { id, keyword, created_at, updated_at, count, is_closed, googlechat_name, instatus_id } = incident;
        const errorCount = count + 1;
        console.log(`${label} エラー${errorCount}回目`);
        // Google Chatへ通知
        if (!googlechat_name) {
          console.log(`${label} Google Chatへ通知`);
          // チャットのみ送信
          googleChatResult = await createThreadGoogleChat(errors);
          console.log("createThreadGoogleChat", googleChatResult);
          // スレッドに詳細を送信
          googleChatResult = await updateThreadGoogleChat(errors, googleChatResult?.thread?.name);
          console.log("updateThreadGoogleChat", googleChatResult);
        } else {
          console.log(`${label} Google Chatを更新`);
          googleChatResult = await updateThreadGoogleChat(errors, googlechat_name);
          console.log("updateThreadGoogleChat", googleChatResult);
        }
        // saaskeまたはworksの場合はInstatusへ通知
        if (label === "saaske" || label === "saaske_api" || label === "works") {
          // 2回目のみ作成
          if (!instatus_id  && errorCount === 2) {
            console.log(`${label} Instatusへ通知`);
            const started = new Date(created_at).toISOString(); // 初回のみ作成日時を利用
            const instatusOptions = {
              started: started,
              page_id: page_id,
              components: [component],
            };
            instatusResult = await createIncidentInstatus(instatusOptions);
            console.log("createIncidentInstatus", instatusResult);
          }
          // 2回目以降は5回に1回更新
          else if (instatus_id && errorCount % 5 === 0) {
            console.log(`${label} Instatusを更新`);
            const started = new Date(updated_at).toISOString(); // 2回目以降は前回更新日時を利用
            const instatusOptions = {
              started: started,
              page_id: page_id,
              components: [component],
            };
            instatusResult = await updateIncidentInstatus(instatus_id, instatusOptions);
            console.log("updateIncidentInstatus", instatusResult);
          }
        }
        // Supabaseを更新
        supabaseResult = await supabase
          .from("incidents")
          .update({
            count: errorCount,
            updated_at: now,
            googlechat_name: googleChatResult?.thread?.name,
            instatus_id: instatusResult?.id,
          })
          .eq("id", id);
      }
    }
    // エラーがない
    else {
      // 1回目以降
      if (incident) {
        console.log(`${label} エラー解決`);
        const { id, keyword, created_at, updated_at, count, is_closed, googlechat_name, instatus_id } = incident;
        // Google Chatを終了
        if (googlechat_name) {
          console.log(`${label} Google Chatを終了`);
          googleChatResult = await resolveThreadGoogleChat(errors, googlechat_name);
          console.log("resolveThreadGoogleChat", googleChatResult);
        }
        // Instatusを終了
        if (instatus_id) {
          console.log(`${label} Instatusを終了`);
          const started = new Date(now).toISOString(); // 終了ときは現在の日時を利用
          const instatusOptions = {
            started: started,
            page_id: page_id,
            components: [component],
          };
          instatusResult = await resolveIncidentInstatus(instatus_id, instatusOptions);
          console.log("resolveIncidentInstatus", instatusResult);
        }
        // Supabaseを更新
        supabaseResult = await supabase
          .from("incidents")
          .update({ 
            is_closed: true,
            updated_at: now,
          })
          .eq("id", id); 
      } else {
        console.log(`${label} 問題なし`);
      }
    }

    // 結果を返す
    return { supabaseResult, googleChatResult, instatusResult };
  }

  // インシデント状況を取得
  type Incidents = Database["mikage"]["Tables"]["incidents"]["Row"];
  const { data: incidents }: { data: Incidents[] | null } = await supabase
    .from("incidents")
    .select("*")
    .is("is_closed", null);

  // サスケ saaske00～saaske09
  const saaskeMainErrors = findErrorResults(results, /^saaske(\d+)$/);
  const saaskeMainIncident = incidents?.find((i) => i.keyword === "saaske");
  const saaskeMainResult = await handleIncident(
    "saaske",
    saaskeMainErrors,
    saaskeMainIncident
  );
  // サスケAPI saaske_api
  const saaskeApiErrors = findErrorResults(results, /^saaske_api$/);
  const saaskeApiIncident = incidents?.find((i) => i.keyword === "saaske_api");
  const saaskeApiResult = await handleIncident(
    "saaske_api",
    saaskeApiErrors,
    saaskeApiIncident
  );
  // サスケWebフォーム saaske_webform
  const saaskeWebformErrors = findErrorResults(results, /^saaske_webform$/);
  const saaskeWebformIncident = incidents?.find((i) => i.keyword === "saaske_webform");
  const saaskeWebformResult = await handleIncident(
    "saaske_webform",
    saaskeWebformErrors,
    saaskeWebformIncident
  );
  // サスケWeb行動解析 saaske_webtracking、saaske_webtracking_v2
  const saaskeWebtrackingErrors = findErrorResults(results, /^saaske_webtracking(_v2)?$/);
  const saaskeWebtrackingIncident = incidents?.find((i) => i.keyword === "saaske_webtracking");
  const saaskeWebtrackingResult = await handleIncident(
    "saaske_webtracking",
    saaskeWebtrackingErrors,
    saaskeWebtrackingIncident
  );
  // サスケ その他 saaske_*
  const saaskeOtherErrors = findErrorResults(results, /^saaske_.*$/);
  const saaskeOtherIncident = incidents?.find((i) => i.keyword === "saaske_other");
  const saaskeOtherResult = await handleIncident(
    "saaske_other",
    saaskeOtherErrors,
    saaskeOtherIncident
  );
  // Works works07～works09
  const worksErrors = findErrorResults(results, /^works\\d+$/);
  const worksIncident = incidents?.find((i) => i.keyword === "works");
  const worksResult = await handleIncident(
    "works",
    worksErrors,
    worksIncident
  );
  // WEBサイト web_*
  const webErrors = findErrorResults(results, /^web_.*$/);
  const webIncident = incidents?.find((i) => i.keyword === "web");
  const webResult = await handleIncident(
    "web",
    webErrors,
    webIncident
  );

  const resultsAll = {
    results: results,
    works: worksResult,
    saaske: saaskeMainResult,
    saaske_api: saaskeApiResult,
    saaske_webform: saaskeWebformResult,
    saaske_webtracking: saaskeWebtrackingResult,
    saaske_other: saaskeOtherResult,
    web: webResult,
  };
  return new Response(JSON.stringify({ resultsAll }), {
    headers: { "Content-Type": "application/json" },
  });
}
