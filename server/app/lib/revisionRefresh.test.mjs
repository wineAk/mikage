import assert from "node:assert/strict";
import test from "node:test";
import { createRevisionRefreshGate, readLoadedRevision } from "./revisionRefresh.ts";

test("reads the deepest loader revision and does not reuse a parent's revision after failure", () => {
  assert.equal(readLoadedRevision([undefined, { cacheRevision: "parent" }, { cacheRevision: "child" }]), "child");
  assert.equal(readLoadedRevision([{ cacheRevision: "parent" }, { cacheRevision: null }]), null);
  assert.equal(readLoadedRevision([{ cacheRevision: "parent" }, { unrelated: true }]), "parent");
  assert.equal(readLoadedRevision([{ cacheRevision: "" }]), null);
  assert.equal(readLoadedRevision([{ cacheRevision: 12 }]), null);
  assert.equal(readLoadedRevision([]), null);
});

test("ignores matching initial notifications and processes the newest queued revision once idle", () => {
  const gate = createRevisionRefreshGate();
  gate.observe("version-1");
  assert.equal(gate.pending("version-1", false), null);
  gate.observe("version-2");
  assert.equal(gate.pending("version-1", true), null);
  gate.observe("version-3");
  assert.equal(gate.pending("version-1", true), null);
  assert.equal(gate.pending("version-1", false), "version-3");
  gate.markLatestAttempt();
  assert.equal(gate.pending("version-1", false), null);
  assert.equal(gate.pending("version-3", false), null);
});

test("does not loop after failed revalidation, including replay of an older attempted revision", () => {
  const gate = createRevisionRefreshGate();
  gate.observe("version-1");
  assert.equal(gate.pending(null, false), "version-1");
  gate.markLatestAttempt();
  assert.equal(gate.pending(null, false), null);
  gate.observe("version-2");
  assert.equal(gate.pending(null, false), "version-2");
  gate.markLatestAttempt();
  gate.observe("version-1");
  assert.equal(gate.pending(null, false), null);
  // 手動更新や定期更新はpendingの判定を通さず、改めて取得できる。
  gate.markLatestAttempt();
  gate.observe("version-3");
  assert.equal(gate.pending(null, false), "version-3");
});

test("ignores malformed notification values without discarding the pending revision", () => {
  const gate = createRevisionRefreshGate();
  gate.observe("valid");
  for (const value of [null, undefined, 42, {}, "", "x".repeat(513)]) gate.observe(value);
  assert.equal(gate.pending(null, false), "valid");
});

test("bounds attempted revision memory while retaining deduplication for recent versions", () => {
  const gate = createRevisionRefreshGate();
  for (let index = 0; index < 257; index++) {
    gate.observe(`version-${index}`);
    gate.markLatestAttempt();
  }
  gate.observe("version-256");
  assert.equal(gate.pending(null, false), null);
  gate.observe("version-1");
  assert.equal(gate.pending(null, false), null);
  gate.observe("version-0");
  assert.equal(gate.pending(null, false), "version-0");
});
