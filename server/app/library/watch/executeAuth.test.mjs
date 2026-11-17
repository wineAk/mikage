import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedWatchExecuteRequest } from "./executeAuth.mjs";

test("watch executeはAuthorization Bearerだけを許可する", () => {
  const token = "test-watch-token";
  assert.equal(isAuthorizedWatchExecuteRequest(new Request("https://example.test"), token), false);
  assert.equal(isAuthorizedWatchExecuteRequest(new Request("https://example.test?key=test-watch-token"), token), false);
  assert.equal(isAuthorizedWatchExecuteRequest(new Request("https://example.test", { headers: { Authorization: "Bearer wrong" } }), token), false);
  assert.equal(isAuthorizedWatchExecuteRequest(new Request("https://example.test", { headers: { Authorization: `Bearer ${token}` } }), token), true);
  assert.equal(isAuthorizedWatchExecuteRequest(new Request("https://example.test", { headers: { Authorization: "Bearer test-watch-token-extra" } }), token), false);
  assert.equal(isAuthorizedWatchExecuteRequest(new Request("https://example.test", { headers: { Authorization: `Bearer ${token}` } }), undefined), false);
});
