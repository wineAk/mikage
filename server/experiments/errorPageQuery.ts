import type { Error as ErrorPageData, ErrorLog } from "@/types/api";
import { createErrorLogFilter } from "./errorPageFilter";
import { getJstMonthRange as getErrorMonthRange } from "../app/lib/monthRange";

const PAGE_SIZE = 1000;
const errorColumns = "id,target_key,created_at,response_time,status_code,status_message,error_code,error_name,target:targets(name)";

// 各要求のSupabaseクライアントを使用し、共有キャッシュを作らない。
export async function readErrorPage(supabase: any, offset: number, signal?: AbortSignal): Promise<ErrorPageData> {
  const range = getErrorMonthRange(offset);

  async function readCount(start: string, end: string): Promise<number> {
    let query = supabase.from("logs").select("id", { count: "exact", head: true })
      .gte("created_at", start).lt("created_at", end).or(createErrorLogFilter());
    if (signal) query = query.abortSignal(signal);
    const { count, error } = await query;
    if (error || typeof count !== "number") throw new Error("エラー件数の取得に失敗しました。");
    return count;
  }

  async function readRows(): Promise<ErrorLog[]> {
    const logs: ErrorLog[] = [];
    let cursor: { createdAt: string; id: number } | undefined;
    let expectedCount: number | undefined;
    while (true) {
      // 最初の件数でAPI側の行数上限を検出し、上限が1000未満でも続きを取得する。
      let query = supabase.from("logs").select(errorColumns, cursor ? undefined : { count: "exact" })
        .gte("created_at", range.start).lt("created_at", range.end).or(createErrorLogFilter(cursor))
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);
      if (signal) query = query.abortSignal(signal);
      const { data, count, error } = await query;
      if (error || !Array.isArray(data)) throw new Error("エラー情報の取得に失敗しました。");
      if (!cursor) {
        if (typeof count !== "number") throw new Error("エラー件数の取得に失敗しました。");
        expectedCount = count;
      }
      for (const row of data) {
        if (typeof row.target?.name !== "string") throw new Error("エラー情報の環境名を取得できませんでした。");
        const { id, target, ...log } = row;
        logs.push({ ...log, name: target.name } as ErrorLog);
      }
      if (data.length === 0 || logs.length >= expectedCount!) return logs;
      const last = data.at(-1);
      const nextCursor = { createdAt: last.created_at, id: last.id };
      if (cursor && cursor.createdAt === nextCursor.createdAt && cursor.id === nextCursor.id) throw new Error("エラー情報の取得位置を更新できませんでした。");
      cursor = nextCursor;
    }
  }

  const [logs, previousMonthCount, nextMonthCount] = await Promise.all([
    readRows(),
    readCount(range.previousStart, range.start),
    readCount(range.end, range.nextEnd),
  ]);
  return { logs, previous_month_count: previousMonthCount, next_month_count: nextMonthCount };
}
