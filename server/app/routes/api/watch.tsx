import type { Route } from "./+types/watch";
import { createClient } from "~/lib/supabase";
const SUPABASE_TABLE_TARGETS = process.env.VITE_SUPABASE_TABLE_TARGETS as string;
const SUPABASE_TABLE_LOGS = process.env.VITE_SUPABASE_TABLE_LOGS as string;
const SUPABASE_TABLE_INCIDENTS = process.env.VITE_SUPABASE_TABLE_INCIDENTS as string;
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

import { resultsStable, resultsSaaskeError, resultsWorksError, resultsSaaskeWorksError, resultsSaaskeWebError, resultsWebError } from "./watch/test";

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
  const { data } = await supabase.from(SUPABASE_TABLE_TARGETS).select("*");

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
  const result = await supabase.from(SUPABASE_TABLE_LOGS).insert(insertRows);
  if (result) {
    console.log(`📝 ${insertRows.length}件のログをまとめて登録しました`);
  } else {
    console.log(`❌ ログ登録に失敗しました`);
  }
  // テストデータ
  //const results = resultsStable;

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
    const INSTATUS_SAASKE_COMPONENT_WEBTRACKING = process.env.VITE_INSTATUS_SAASKE_COMPONENT_WEBTRACKING as string;
    const INSTATUS_WORKS_PAGE_ID = process.env.VITE_INSTATUS_WORKS_PAGE_ID as string;
    const INSTATUS_WORKS_COMPONENT_WORKS = process.env.VITE_INSTATUS_WORKS_COMPONENT_WORKS as string;
    // Instatusのオプション変数
    let page_id = "";
    let component = "";
    let serviceName = "";
    switch (label) {
      case "saaske":
        page_id = INSTATUS_SAASKE_PAGE_ID;
        component = INSTATUS_SAASKE_COMPONENT_SAASKE;
        serviceName = "サスケ";
        break;
      case "saaske_api":
        page_id = INSTATUS_SAASKE_PAGE_ID;
        component = INSTATUS_SAASKE_COMPONENT_API;
        serviceName = "サスケAPI";
        break;
      case "saaske_webform":
        page_id = INSTATUS_SAASKE_PAGE_ID;
        component = INSTATUS_SAASKE_COMPONENT_WEBFORM;
        serviceName = "Webフォーム";
        break;
      case "saaske_webtracking":
        page_id = INSTATUS_SAASKE_PAGE_ID;
        component = INSTATUS_SAASKE_COMPONENT_WEBTRACKING;
        serviceName = "Web行動解析";
        break;
      case "works":
        page_id = INSTATUS_WORKS_PAGE_ID;
        component = INSTATUS_WORKS_COMPONENT_WORKS;
        serviceName = "Works";
        break;
    }

    // エラーがある
    if (errors.length > 0) {
      // 1回目
      if (!incident){
        console.log(`${label} エラー1回目`);
        supabaseResult = await supabase
          .from(SUPABASE_TABLE_INCIDENTS)
          .insert([{ keyword: label, created_at: now, updated_at: now }]);
      }
      // 2回目以降
      else {
        const { id, keyword, created_at, updated_at, count, is_closed, googlechat_name, instatus_id } = incident;
        const errorCount = count + 1;
        console.log(`${label} エラー${errorCount}回目`);
        // saaskeまたはworksの場合はInstatusへ通知
        if (page_id !== "" && component !== "") {
          // 2回目のみ作成
          if (!instatus_id  && errorCount === 2) {
            console.log(`${label} Instatusへ通知`);
            const started = new Date(created_at).toISOString(); // 初回のみ作成日時を利用
            const instatusOptions = {
              started: started,
              page_id: page_id,
              components: [component],
              serviceName: serviceName,
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
        // instatusから返却されるIDは必ずしも親ではない
        const incidentUpdateId = instatusResult?.id; // インシデント更新時のID
        const incidentParentId = instatusResult?.incident?.id; // インシデントの親ID
        const instatusId = incidentParentId ?? incidentUpdateId; // 親がなければ子IDを利用（新規時など）
        const instatusUrl = `https://${label === "works" ? "works" : "saaske"}.instatus.com/${instatusId}`;
        // Google Chatへ通知
        if (!googlechat_name) {
          console.log(`${label} Google Chatへ通知`);
          // チャットのみ送信
          googleChatResult = await createThreadGoogleChat(errors, instatusUrl);
          console.log("createThreadGoogleChat", googleChatResult);
          // スレッドに詳細を送信
          googleChatResult = await updateThreadGoogleChat(errors, googleChatResult?.thread?.name);
          console.log("updateThreadGoogleChat", googleChatResult);
        } else {
          console.log(`${label} Google Chatを更新`);
          googleChatResult = await updateThreadGoogleChat(errors, googlechat_name);
          console.log("updateThreadGoogleChat", googleChatResult);
        }
        // Supabaseを更新
        supabaseResult = await supabase
          .from(SUPABASE_TABLE_INCIDENTS)
          .update({
            count: errorCount,
            updated_at: now,
            googlechat_name: googleChatResult?.thread?.name,
            instatus_id: instatusId,
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
          .from(SUPABASE_TABLE_INCIDENTS)
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
    .from(SUPABASE_TABLE_INCIDENTS)
    .select("*")
    .is("is_closed", null);

  // サスケ saaske00～saaske09
  const saaskeMainErrors = findErrorResults(results, /^saaske\d+$/);
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
  const saaskeOtherErrors = findErrorResults(results, /^saaske_(broad_ap|sfc)$/);
  const saaskeOtherIncident = incidents?.find((i) => i.keyword === "saaske_other");
  const saaskeOtherResult = await handleIncident(
    "saaske_other",
    saaskeOtherErrors,
    saaskeOtherIncident
  );
  // Works works07～works09
  const worksErrors = findErrorResults(results, /^works\d+$/);
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
