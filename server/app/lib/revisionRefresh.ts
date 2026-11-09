const MAX_REVISION_LENGTH = 512;
const MAX_ATTEMPTED_REVISIONS = 256;

function isRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_REVISION_LENGTH;
}

export function readLoadedRevision(matches: unknown[]): string | null {
  for (let index = matches.length - 1; index >= 0; index--) {
    const data = matches[index];
    if (data && typeof data === "object" && "cacheRevision" in data) {
      return isRevision(data.cacheRevision) ? data.cacheRevision : null;
    }
  }
  return null;
}

// 通知は再取得のきっかけだけに使い、通知された版を表示済みとは扱わない。
export function createRevisionRefreshGate() {
  let latestRevision: string | null = null;
  const attemptedRevisions = new Set<string>();

  function observe(value: unknown) {
    if (isRevision(value)) latestRevision = value;
  }

  function pending(loadedRevision: string | null, isBusy: boolean): string | null {
    return !isBusy && latestRevision !== null && latestRevision !== loadedRevision && !attemptedRevisions.has(latestRevision)
      ? latestRevision
      : null;
  }

  function markLatestAttempt() {
    if (latestRevision === null) return;
    attemptedRevisions.add(latestRevision);
    // 古い通知が再送されても再検証するだけなので、長時間開いたタブの記憶量を制限する。
    if (attemptedRevisions.size > MAX_ATTEMPTED_REVISIONS) {
      const oldest = attemptedRevisions.values().next().value;
      if (oldest !== undefined) attemptedRevisions.delete(oldest);
    }
  }

  return { observe, pending, markLatestAttempt };
}
