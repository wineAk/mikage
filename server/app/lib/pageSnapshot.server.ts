import { getJstMonthRange } from "./monthRange";
import { hasPageVersionConflict, PageSnapshotConflictError, resetPageQueries } from "./pageQueries.server";

export async function readConsistentPage<T>(request: Request, load: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const month = getJstMonthRange(0).start;
    try {
      const value = await load();
      if (!hasPageVersionConflict(request) && getJstMonthRange(0).start === month) return value;
    } catch (error) {
      if (!(error instanceof PageSnapshotConflictError)) throw error;
    }
    resetPageQueries(request);
  }
  // 異なる版の表を混ぜた画面を、更新済みとして確定しない。
  throw new Error("監視データが更新されたため、再取得が必要です。");
}
