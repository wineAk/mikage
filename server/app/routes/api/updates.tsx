import type { Route } from "./+types/updates";
import { getPageCacheScope, readPageRevision } from "~/lib/pageRevision.server";

type Subscriber = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  signal: AbortSignal;
  onAbort: () => void;
  isClosed: boolean;
};

type Producer = {
  scope: string;
  request: Request;
  abortController: AbortController;
  subscribers: Set<Subscriber>;
  revision: string | null;
  lastHeartbeat: number;
  timer?: ReturnType<typeof setTimeout>;
  isPolling: boolean;
  isClosed: boolean;
};

const encoder = new TextEncoder();
const MAX_PRODUCERS = 32;
const MAX_SUBSCRIBERS_PER_SCOPE = 128;
const MAX_SUBSCRIBERS = 512;
const producers = new Map<string, Producer>();
let subscriberCount = 0;

function stopProducer(producer: Producer) {
  if (producer.isClosed) return;
  producer.isClosed = true;
  if (producer.timer) clearTimeout(producer.timer);
  if (producers.get(producer.scope) === producer) producers.delete(producer.scope);
  producer.abortController.abort();
  for (const subscriber of producer.subscribers) {
    if (subscriber.isClosed) continue;
    subscriber.isClosed = true;
    subscriber.signal.removeEventListener("abort", subscriber.onAbort);
    subscriberCount--;
    try { subscriber.controller.close(); } catch {}
  }
  producer.subscribers.clear();
}

function removeSubscriber(producer: Producer, subscriber: Subscriber) {
  if (subscriber.isClosed) return;
  subscriber.isClosed = true;
  subscriber.signal.removeEventListener("abort", subscriber.onAbort);
  producer.subscribers.delete(subscriber);
  subscriberCount--;
  try { subscriber.controller.close(); } catch {}
  if (producer.subscribers.size === 0) stopProducer(producer);
}

function send(producer: Producer, subscriber: Subscriber, bytes: Uint8Array) {
  if (subscriber.isClosed) return;
  try {
    // 読まれない接続へ通知を蓄積し続けない。再接続後は再びDBの版を確認する。
    if ((subscriber.controller.desiredSize ?? 1) <= -8) { removeSubscriber(producer, subscriber); return; }
    subscriber.controller.enqueue(bytes);
  } catch { removeSubscriber(producer, subscriber); }
}

function encodeEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(producer: Producer, bytes: Uint8Array) {
  for (const subscriber of producer.subscribers) send(producer, subscriber, bytes);
}

async function pollProducer(producer: Producer) {
  if (producer.isClosed || producer.isPolling || producer.subscribers.size === 0) return;
  producer.isPolling = true;
  try {
    const revision = await readPageRevision(producer.request);
    if (producer.isClosed) return;
    if (revision === null) {
      broadcast(producer, encodeEvent("unavailable", {}));
      stopProducer(producer);
      return;
    }
    if (revision !== producer.revision) {
      producer.revision = revision;
      broadcast(producer, encodeEvent("revision", { revision }));
    } else if (Date.now() - producer.lastHeartbeat >= 15_000) {
      broadcast(producer, encoder.encode(": heartbeat\n\n"));
      producer.lastHeartbeat = Date.now();
    }
  } catch {
    if (!producer.isClosed) {
      broadcast(producer, encodeEvent("unavailable", {}));
      stopProducer(producer);
    }
  } finally {
    producer.isPolling = false;
    if (!producer.isClosed && producer.subscribers.size > 0) producer.timer = setTimeout(() => { void pollProducer(producer); }, 1000);
  }
}

function createProducer(scope: string, request: Request): Producer {
  const abortController = new AbortController();
  const headers = new Headers();
  const cookie = request.headers.get("Cookie");
  if (cookie !== null) headers.set("Cookie", cookie);
  return {
    scope,
    // 共有処理の中断を、最初の接続の切断へ結び付けない。
    request: new Request(request.url, { headers, signal: abortController.signal }),
    abortController,
    subscribers: new Set(),
    revision: null,
    lastHeartbeat: Date.now(),
    isPolling: false,
    isClosed: false,
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const signal = context.connectionSignal instanceof AbortSignal ? context.connectionSignal : request.signal;
  const headers = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Accel-Buffering": "no",
    "Vary": "Cookie",
  };
  const scope = getPageCacheScope(request);
  const unavailable = () => new Response("event: unavailable\ndata: {}\n\n", { headers });
  if (scope === null || signal.aborted || subscriberCount >= MAX_SUBSCRIBERS) return unavailable();
  let producer = producers.get(scope);
  if (!producer) {
    if (producers.size >= MAX_PRODUCERS) return unavailable();
    producer = createProducer(scope, request);
    producers.set(scope, producer);
  }
  if (producer.subscribers.size >= MAX_SUBSCRIBERS_PER_SCOPE) return unavailable();
  const shared = producer;
  let subscriber: Subscriber | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => { if (subscriber) removeSubscriber(shared, subscriber); };
      subscriber = { controller, signal, onAbort: close, isClosed: false };
      shared.subscribers.add(subscriber);
      subscriberCount++;
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) { close(); return; }
      send(shared, subscriber, encoder.encode("retry: 1500\n\n"));
      // これは変更通知用のヒント。データ応答側のDB再検証は省略しない。
      if (shared.revision !== null) send(shared, subscriber, encodeEvent("revision", { revision: shared.revision }));
      if (!shared.isPolling && !shared.timer) void pollProducer(shared);
    },
    cancel() { if (subscriber) removeSubscriber(shared, subscriber); },
  });
  return new Response(stream, { headers });
}
