import { useCallback, useEffect, useRef } from "react";
import { useMatches, useNavigation, useRevalidator } from "react-router";
import { createRevisionRefreshGate, readLoadedRevision } from "./revisionRefresh";

export function usePageRevalidation() {
  const { revalidate, state } = useRevalidator();
  const navigation = useNavigation();
  const matches = useMatches();
  const loadedRevision = readLoadedRevision(matches.map(match => match.data));
  const isRefreshing = useRef(false);
  const gateRef = useRef<ReturnType<typeof createRevisionRefreshGate> | null>(null);
  if (gateRef.current === null) gateRef.current = createRevisionRefreshGate();
  const gate = gateRef.current;
  const pumpRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => {
    if (document.visibilityState === "hidden" || isRefreshing.current || state !== "idle" || navigation.state !== "idle") return false;
    isRefreshing.current = true;
    gate.markLatestAttempt();
    void Promise.resolve().then(() => revalidate()).catch(() => {}).finally(() => {
      isRefreshing.current = false;
      pumpRef.current();
    });
    return true;
  }, [revalidate, state, navigation.state, gate]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  pumpRef.current = () => {
    const isBusy = document.visibilityState === "hidden" || isRefreshing.current || state !== "idle" || navigation.state !== "idle";
    if (gate.pending(loadedRevision, isBusy)) refreshRef.current();
  };
  useEffect(() => { pumpRef.current(); }, [loadedRevision, state, navigation.state]);
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", restore);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let isUnavailable = false;
    const close = () => { source?.close(); source = null; };
    const connect = () => {
      if (document.visibilityState === "hidden" || source !== null || isUnavailable) return;
      let nextSource: EventSource;
      try {
        nextSource = new EventSource("/api/v1/updates");
      } catch {
        isUnavailable = true;
        return;
      }
      source = nextSource;
      nextSource.addEventListener("revision", event => {
        if (source !== nextSource || !("data" in event) || typeof event.data !== "string") return;
        try {
          const notification = JSON.parse(event.data) as { revision?: unknown } | null;
          gate.observe(notification?.revision);
          pumpRef.current();
        } catch {
          // 不正な通知で表示を変更せず、定期取得による再検証を継続する。
        }
      });
      nextSource.addEventListener("unavailable", () => {
        if (source !== nextSource) return;
        isUnavailable = true;
        close();
      });
      // 通信断はEventSource自身が再接続し、再接続後の初回通知も版を比較する。
    };
    const syncVisibility = () => {
      if (document.visibilityState === "hidden") { close(); isUnavailable = false; }
      else connect();
    };
    document.addEventListener("visibilitychange", syncVisibility);
    // DB側の機能追加や一時障害の復旧後も、開いた画面で通知を再開する。
    const retryInterval = window.setInterval(() => {
      if (!isUnavailable || document.visibilityState === "hidden") return;
      isUnavailable = false;
      connect();
    }, 60_000);
    connect();
    return () => {
      window.clearInterval(retryInterval);
      document.removeEventListener("visibilitychange", syncVisibility);
      close();
    };
  }, [gate]);
  return refresh;
}
