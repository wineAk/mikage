import type { LogResult } from "@/types/watch";

const googleChatWebhookUrl = process.env.VITE_GOOGLE_WEBHOOK_URL || "";
const headers = { "Content-Type": "application/json" };

// エラー内容をcardsV2化
function createCardsV2(errors: LogResult[]) {
  const widgets = errors.flatMap((error) => {
    const { name, log } = error;
    const { responseTime, statusCode, statusMessage, errorCode, errorName } = log;
    // ICON: https://developers.google.com/workspace/chat/add-text-image-card-dialog#add-icon
    const widget = [
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
      {
        "divider": {}
      },
    ];
    return widget;
  });
  const cards = {
    "header": {
      "title": "サスケ 監視ツール - ミカゲ",
      "subtitle": new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
      "imageUrl": "https://mikage.onrender.com/android-chrome-192x192.png",
      "imageType": "CIRCLE"
    },
    "sections": [
      {
        "widgets": [
          ...widgets,
          {
            "buttonList": {
              "buttons": [
                {
                  "color": {
                    "red": 0.3686274509803922,
                    "green": 0.6470588235294118,
                    "blue": 0,
                    "alpha": 1
                  },
                  "icon": {
                    "materialIcon": {
                      "name": "open_in_new"
                    }
                  },
                  "onClick": {
                    "openLink": {
                      "url": "https://mikage.onrender.com/"
                    }
                  },
                  "text": "サスケ 監視ツール - ミカゲ"
                }
              ]
            }
          }
        ],
      }
    ]
  }
  return [cards];
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
  const text = [
    "🚨インシデント 発生",
    "",
    ...errors.map((error) =>  `- *${error.name}* `),
  ].join("\n");
  const body = { text };
  return await sendGoogleChatRequest(url, body);
}

// スレッド更新
export async function updateThreadGoogleChat(errors: LogResult[], name: string) {
  const url = `${googleChatWebhookUrl}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`;
  const cardsV2 = createCardsV2(errors);
  const text = "⚠️インシデント 発生中";
  const body = { text, cardsV2, thread: { name } };
  return await sendGoogleChatRequest(url, body);
}

// スレッド終了
export async function resolveThreadGoogleChat(errors: LogResult[], name: string) {
  const url = `${googleChatWebhookUrl}&messageReplyOption=REPLY_MESSAGE_OR_FAIL`;
  const text = "✅インシデント 終了";
  const body = { text, thread: { name } };
  return await sendGoogleChatRequest(url, body);
}
