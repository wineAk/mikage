import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createErrorLogFilter } from "./errorPageFilter.ts";
import { getJstMonthRange as getErrorMonthRange } from "../app/lib/monthRange.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(["./errorPageFilter", "../app/lib/monthRange"].includes(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { readErrorPage } = await import("./errorPageQuery.ts");

test("uses JST month boundaries across UTC date, leap year and year rollover", () => {
  assert.deepEqual(getErrorMonthRange(0, new Date("2024-02-29T15:00:00Z")), {
    start: "2024-02-29T15:00:00.000Z", end: "2024-03-31T15:00:00.000Z",
    previousStart: "2024-01-31T15:00:00.000Z", nextEnd: "2024-04-30T15:00:00.000Z",
  });
  assert.equal(getErrorMonthRange(1, new Date("2026-01-01T00:00:00Z")).start, "2025-11-30T15:00:00.000Z");
  assert.throws(() => getErrorMonthRange(-1));
  assert.throws(() => getErrorMonthRange(0.5));
});

test("preserves microsecond cursors and combines NULL/200-error predicate with keyset", () => {
  assert.equal(createErrorLogFilter(), "status_code.neq.200,status_code.is.null,error_code.not.is.null");
  const filter = createErrorLogFilter({ createdAt: "2026-11-01T00:00:00.123456+00:00", id: 42 });
  assert.match(filter, /created_at\.eq\.2026-11-01T00:00:00\.123456\+00:00,id\.lt\.42/);
  assert.match(filter, /^and\(or\(status_code/);
  assert.throws(() => createErrorLogFilter({ createdAt: "invalid),id.gt.0", id: 2 }));
});

function createClient(responses, requests) {
  return { from(table) {
    const operations = { table };
    const builder = {
      select(columns, options) { Object.assign(operations, { columns, options }); return builder; },
      gte(column, value) { operations.gte = [column, value]; return builder; },
      lt(column, value) { operations.lt = [column, value]; return builder; },
      or(filter) { operations.filter = filter; return builder; },
      order() { return builder; }, limit() { return builder; }, abortSignal(signal) { operations.signal = signal; return builder; },
      then(resolve, reject) { requests.push(operations); return Promise.resolve(responses.shift()).then(resolve, reject); },
    };
    return builder;
  } };
}

function createRow(id, statusCode, errorCode) {
  return { id, target: { name: "Example" }, target_key: "example", created_at: `2026-11-01T00:00:0${id}.123456+00:00`, response_time: id, status_code: statusCode, status_message: null, error_code: errorCode, error_name: errorCode };
}

test("paginates below requested server limit, keeps NULL status/200 errors and exact counts", async () => {
  const requests = [];
  const rows = [createRow(3, null, null), createRow(2, 200, "INVALID_JSON"), createRow(1, 500, null)];
  const client = createClient([
    { data: rows.slice(0, 2), count: 3, error: null },
    { count: 2004, error: null }, { count: 7, error: null },
    { data: rows.slice(2), count: null, error: null },
  ], requests);
  const signal = new AbortController().signal;
  const result = await readErrorPage(client, 0, signal);
  assert.equal(result.logs.length, 3);
  assert.equal(result.logs[0].status_code, null);
  assert.equal(result.logs[1].status_code, 200);
  assert.equal(result.previous_month_count, 2004);
  assert.equal(result.next_month_count, 7);
  assert.equal(requests.length, 4);
  assert.equal(requests.every(item => item.signal === signal), true);
  assert.match(requests[3].filter, /id\.lt\.2/);
  assert.equal("id" in result.logs[0], false);
  assert.equal("target" in result.logs[0], false);
});

test("normalizes empty month to [] and rejects query failures", async () => {
  const result = await readErrorPage(createClient([{ data: [], count: 0 }, { count: 0 }, { count: 0 }], []), 2);
  assert.deepEqual(result, { logs: [], previous_month_count: 0, next_month_count: 0 });
  await assert.rejects(readErrorPage(createClient([{ data: null, error: { code: "denied" } }, { count: 0 }, { count: 0 }], []), 0));
});
