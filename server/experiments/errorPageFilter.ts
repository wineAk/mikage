export function createErrorLogFilter(cursor?: { createdAt: string; id: number }): string {
  const errorFilter = "status_code.neq.200,status_code.is.null,error_code.not.is.null";
  if (!cursor) return errorFilter;
  // 同時刻の行もIDで区別し、ページ境界の欠落や重複を防ぐ。
  const createdAt = cursor.createdAt;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) throw new Error("取得日時が不正です。");
  if (!Number.isSafeInteger(cursor.id)) throw new Error("取得位置が不正です。");
  return `and(or(${errorFilter}),or(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${cursor.id})))`;
}
