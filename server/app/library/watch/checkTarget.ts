import axios from "axios";
import got from "got";
import type { Log } from "@/types/watch";

// ネットワーク接続確認（Googleなど3つのドメインにアクセス）
export async function isNetworkAvailable() {
  const domains = ["google.com", "cloudflare.com", "microsoft.com"];
  const checks = await Promise.allSettled(
    domains.map((d) => axios.get(`https://${d}`, { timeout: 3000 }))
  );
  return checks.some((result) => result.status === "fulfilled");
}

type Target = {
  url: string;
  headers?: Record<string, string>;
};

type Error = {
  name: string;
  code: string;
  timings: {
    start: number;
    phases: {
      total: number;
    };
  };
};

// URLをチェックし、レスポンスなどのログを取得
export async function checkTarget({ url, headers }: Target) {
  let log: Log = {
    startDate: Date.now(),
    responseTime: null,
    statusCode: null,
    statusMessage: null,
    errorName: null,
    errorCode: null,
  };
  const options = {
    timeout: 10000,
    retry: 0,
    throwHttpErrors: false,
    timings: true,
    headers: headers ?? {},
  };
  try {
    const response = await got(url, options);
    const { statusCode, statusMessage, timings, body } = response;
    const { start, phases } = timings;
    const { total } = phases;
    log.startDate = start;
    log.responseTime = total ?? null;
    log.statusCode = statusCode;
    log.statusMessage = statusMessage ?? null;
    //const trimBody = body.replace(/\s+/g, " ").trim().slice(0, 140);
    //console.log("🧐 確認の為にBodyを表示\n", trimBody);
    if (/api\.saaske\.com/.test(url)) {
      try {
        const json = JSON.parse(body);
      } catch (error) {
        console.log("APIのエラー", error);
        const message =
          // 標準Error系
          (error instanceof Error) ? error.message : 
          // 文字列throw対策
          (typeof error === 'string') ? error :
          // その他
          String((error as any).message);
        log.errorCode = "INVALID_JSON";
        log.errorName = message;
      }
    }
    const errorMatch = body.match(/\[ ?code[：:]\s*(\d+)\s*\]/i);
    if (errorMatch) {
      log.errorCode = `CODE_${errorMatch[1]}`;
      log.errorName = "InternalServiceError";
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "timings" in error) {
      const { name, code, timings } = error as Error;
      const { start, phases } = timings;
      const { total } = phases;
      log.startDate = start;
      log.responseTime = total;
      log.statusCode = name === "TimeoutError" ? 408 : 520;
      log.statusMessage =
        name === "TimeoutError" ? "Request Timeout" : "Unknown Error";
      log.errorCode = code;
      log.errorName = name;
    }
  }
  return log;
}
