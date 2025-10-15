const instatusURI = "https://api.instatus.com";
const INSTATUS_API_KEY = process.env.VITE_INSTATUS_API_KEY;
//const page_id = process.env.VITE_INSTATUS_PAGE_ID;
//const components = process.env.VITE_INSTATUS_COMPONENTS ?? "";
//const componentsList = components ? components.split(",") : [];

const headers = {
  Authorization: `Bearer ${INSTATUS_API_KEY}`,
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
function getComponentStatuses(components: string[], status: "MAJOROUTAGE" | "OPERATIONAL") {
  const componentsList = components.map((id) => ({ id, status }));
  return componentsList;
}

// インシデント新規作成
type InstatusOptions = {
  started: string;
  page_id: string;
  components: string[];
  serviceName?: string;
}
export async function createIncidentInstatus(options: InstatusOptions) {
  const { started, page_id, components, serviceName } = options;
  const url = `${instatusURI}/v1/${page_id}/incidents`;
  const name = serviceName ? `${serviceName}にて接続しづらい状況が発生` : "接続しづらい状況が発生";
  const body = {
    name: name,
    message: "一部環境においてアクセスしづらい状況が発生しております",
    components: components,
    started,
    status: "INVESTIGATING",
    notify: true,
    statuses: getComponentStatuses(components, "MAJOROUTAGE"),
  };
  return await sendInstatusRequest(url, body);
}

// インシデント更新
export async function updateIncidentInstatus(incident_id: string, options: InstatusOptions) {
  const { started, page_id, components } = options;
  const url = `${instatusURI}/v1/${page_id}/incidents/${incident_id}/incident-updates`;
  const body = {
    message: "引き続きアクセスしづらい状況が発生しております",
    components: components,
    started,
    status: "MONITORING",
    notify: true,
    statuses: getComponentStatuses(components, "MAJOROUTAGE"),
  };
  return await sendInstatusRequest(url, body);
}

// インシデント終了
export async function resolveIncidentInstatus(incident_id: string, options: InstatusOptions) {
  const { started, page_id, components } = options;
  const url = `${instatusURI}/v1/${page_id}/incidents/${incident_id}/incident-updates`;
  const body = {
    message: "問題が解消されました",
    components: components,
    started,
    status: "RESOLVED",
    notify: true,
    statuses: getComponentStatuses(components, "OPERATIONAL"),
  };
  return await sendInstatusRequest(url, body);
}
