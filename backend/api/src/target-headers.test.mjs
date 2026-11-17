import assert from "node:assert/strict";
import test from "node:test";

import { isValidTargetHeaders } from "./target-headers.mjs";

test("target headers accept null and valid header objects", () => {
  assert.equal(isValidTargetHeaders(null), true);
  assert.equal(isValidTargetHeaders({ Authorization: "Bearer secret" }), true);
});

test("target headers reject malformed structures, names, values, and oversized payloads", () => {
  assert.equal(isValidTargetHeaders(undefined), false);
  assert.equal(isValidTargetHeaders(["x"]), false);
  assert.equal(isValidTargetHeaders({ "Bad Name": "x" }), false);
  assert.equal(isValidTargetHeaders({ Authorization: "Bearer\r\nInjected: yes" }), false);
  assert.equal(isValidTargetHeaders(Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`X-${index}`, "x"]))), false);
  assert.equal(isValidTargetHeaders({ Authorization: "x".repeat(8193) }), false);
});
