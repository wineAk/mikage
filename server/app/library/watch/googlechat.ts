import type { LogResult } from "@/types/watch";

const googleChatWebhookUrl = process.env.VITE_GOOGLE_WEBHOOK_URL || "";
const headers = { "Content-Type": "application/json" };

// エラー内容をテキスト化
function formatErrorText(errors: LogResult[], prefix: string): string {
  return [
    prefix,
    errors
      .map((error) => {
        const { name, log } = error;
        const { responseTime } = log;
        const txt = [
          "",
          `*${name}* `,
          `レスポンス時間: ${responseTime} ms`,
          `\`\`\`${JSON.stringify(log, null, 2)}\`\`\``,
        ].join("\n");
        return txt;
      })
      .join("\n"),
  ].join("\n");
}

// Google Chat APIリクエスト送信
export async function sendGoogleChatRequest(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return await res.json();
}

// スレッド新規作成
export async function createThreadGoogleChat(errors: LogResult[]) {
  const url = `${googleChatWebhookUrl}`;
  const text = formatErrorText(errors, "🚨新規インシデント");
  const body = { text };
  return await sendGoogleChatRequest(url, body);
}

// スレッド更新
export async function updateThreadGoogleChat(errors: LogResult[], name: string) {
  const url = `${googleChatWebhookUrl}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`;
  const text = formatErrorText(errors, "⚠️引き続き発生中");
  const body = { text, thread: { name } };
  return await sendGoogleChatRequest(url, body);
}

// スレッド終了
export async function resolveThreadGoogleChat(errors: LogResult[], name: string) {
  const url = `${googleChatWebhookUrl}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`;
  const text = formatErrorText(errors, "✅インシデント終了");
  const body = { text, thread: { name } };
  return await sendGoogleChatRequest(url, body);
}
