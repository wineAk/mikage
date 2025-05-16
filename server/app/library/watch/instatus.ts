const instatusURI = "https://api.instatus.com";
const API_KEY = process.env.VITE_INSTATUS_API_KEY;
const page_id = process.env.VITE_INSTATUS_PAGE_ID;
const components = process.env.VITE_INSTATUS_COMPONENTS ?? "";
const componentsList = components ? components.split(",") : [];
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// Instatus APIリクエスト送信
async function sendInstatusRequest(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return await res.json();
}

// コンポーネントのステータス作成
function getComponentStatuses(status: string) {
  return componentsList.map((id) => ({ id, status }));
}

// インシデント新規作成
export async function createIncidentInstatus(started: string) {
  const url = `${instatusURI}/v1/${page_id}/incidents`;
  const body = {
    name: "接続しづらい状況が発生",
    message: "一部環境において、Worksへアクセスできない状況が発生してます",
    components: componentsList,
    started,
    status: "INVESTIGATING",
    notify: true,
    statuses: getComponentStatuses("MAJOROUTAGE"),
  };
  return await sendInstatusRequest(url, body);
}

// インシデント更新
export async function updateIncidentInstatus(incident_id: string, started: string) {
  const url = `${instatusURI}/v1/${page_id}/incidents/${incident_id}/incident-updates`;
  const body = {
    message: "引き続き、Worksへアクセスしづらい状況が発生しています",
    components: componentsList,
    started,
    status: "MONITORING",
    notify: true,
    statuses: getComponentStatuses("MAJOROUTAGE"),
  };
  return await sendInstatusRequest(url, body);
}

// インシデント終了
export async function resolveIncidentInstatus(incident_id: string, started: string) {
  const url = `${instatusURI}/v1/${page_id}/incidents/${incident_id}/incident-updates`;
  const body = {
    message: "サーバーが平常時に復帰いたしました",
    components: componentsList,
    started,
    status: "RESOLVED",
    notify: true,
    statuses: getComponentStatuses("OPERATIONAL"),
  };
  return await sendInstatusRequest(url, body);
}
