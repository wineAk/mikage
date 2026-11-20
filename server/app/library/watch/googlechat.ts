import type { LogResult } from "@/types/watch";
import { parseSuccessfulNotificationResponse } from "./notificationResponse.mjs";
import { areExternalNotificationsEnabled } from "./notificationEnvironment.mjs";

function assertRealGoogleChatNetworkAllowed() {
  if (!areExternalNotificationsEnabled(process.env)) {
    throw new Error("Google Chat notifications are disabled in this environment.");
  }
}

const googleChatWebhookUrl = process.env.VITE_GOOGLE_WEBHOOK_URL || "";
const headers = { "Content-Type": "application/json" };

type GoogleChatResponse = {
  thread?: { name?: string };
};

// エラー内容をcardsV2化
// CARD: https://addons.gsuite.google.com/uikit/builder?hl=ja
// ICON: https://developers.google.com/workspace/chat/add-text-image-card-dialog#add-icon
function createCardsV2(errors: LogResult[]) {
  const sections = errors.flatMap((error) => {
    const { name, log } = error;
    const { responseTime, statusCode, statusMessage, errorCode, errorName } = log;
    const widgets = [
      {
        "decoratedText": {
          "icon": {
            "knownIcon": "BOOKMARK"
          },
          "topLabel": "対象",
          "text": name
        }
      },
      {
        "decoratedText": {
          "icon": {
            "knownIcon": "CLOCK"
          },
          "topLabel": "レスポンス時間",
          "text": `${responseTime} ms`
        }
      },
      {
        "decoratedText": {
          "icon": {
            "knownIcon": "DESCRIPTION"
          },
          "topLabel": "ステータス",
          "text": `${statusCode} ${statusMessage}`
          
        }
      },
      {
        "decoratedText": {
          "icon": {
            "knownIcon": "DESCRIPTION"
          },
          "topLabel": "エラー",
          "text": `${errorCode} ${errorName}`
          
        }
      },
    ];
    const section = {
      //"collapsible": true,
      //"uncollapsibleWidgetsCount": 1,
      "widgets": widgets,
    }
    return section;
  });
  const card = {
    "header": {
      "title": "サスケ 監視ツール - ミカゲ",
      "subtitle": new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
      "imageUrl": "https://cldup.com/VM41agw9eH.png",
      "imageType": "CIRCLE"
    },
    "sections": [
      ...sections,
    ]
  }
  return [{
    cardId: Math.random().toString(32).substring(2),
    card
  }];
}

// Google Chat APIリクエスト送信
export async function sendGoogleChatRequest(url: string, body: any) {
  assertRealGoogleChatNetworkAllowed();
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return await parseSuccessfulNotificationResponse<GoogleChatResponse>(res, "Google Chat");
}

// スレッド新規作成
export async function createThreadGoogleChat(errors: LogResult[], instatusUrl: string | null) {
  const url = `${googleChatWebhookUrl}`;
  const widgets = [
    {
      buttonList: {
        buttons: {
          color: {
            // #b0cf75
            red: 176 / 255,
            green: 207 / 255,
            blue: 117 / 255,
            alpha: 1,
          },
          icon: { materialIcon: { name: "open_in_new" } },
          onClick: { openLink: { url: "https://mikage.onrender.com/" } },
          text: "サスケ 監視ツール - ミカゲ",
        },
      },
    },
  ];
  if (instatusUrl) {
    const textService = /works\.instatus\.com/.test(instatusUrl) ? "Works" : "Saaske";
    widgets.push({
      buttonList: {
        buttons: {
          color: {
            // rgb(187, 255, 246)
            red: 187 / 255,
            green: 255 / 255,
            blue: 246 / 255,
            alpha: 1,
          },
          icon: { materialIcon: { name: "open_in_new" } },
          onClick: { openLink: { url: instatusUrl } },
          text: `${textService}のInstatusを開く`,
        },
      },
    });
  }
  const cardsV2 = [
    {
      cardId: Math.random().toString(32).substring(2),
      card: { sections: [{ widgets }] },
    },
  ];
  const text = [
    "🚨インシデント 発生",
    "",
    ...errors.map((error) =>  `- *${error.name}* `),
  ].join("\n");
  const body = { text, cardsV2 };
  console.log("createThreadGoogleChat:", JSON.stringify(body));
  return await sendGoogleChatRequest(url, body);
}

// スレッド更新
export async function updateThreadGoogleChat(errors: LogResult[], name: string) {
  const url = `${googleChatWebhookUrl}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`;
  const cardsV2 = createCardsV2(errors);
  const text = "⚠️インシデント 発生中";
  const body = { text, cardsV2, thread: { name } };
  console.log("updateThreadGoogleChat:", JSON.stringify(body));
  return await sendGoogleChatRequest(url, body);
}

// スレッド終了
export async function resolveThreadGoogleChat(errors: LogResult[], name: string) {
  const url = `${googleChatWebhookUrl}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`;
  const text = "✅インシデント 終了";
  const body = { text, thread: { name } };
  console.log("resolveThreadGoogleChat:", JSON.stringify(body));
  return await sendGoogleChatRequest(url, body);
}
