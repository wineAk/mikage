import assert from "node:assert/strict";
import test from "node:test";
import { isIpRestrictionExemptPath } from "./ipRestrictionExemptPath.mjs";

test("IP制限例外はwatch execute endpointの完全一致だけ", () => {
  assert.equal(isIpRestrictionExemptPath("/api/v1/watch"), true);
  for (const requestPath of [
    "/api/v1/watch/",
    "/api/v1/watch/extra",
    "/other/api/v1/watch",
    "/api/v1/watch-admin",
  ]) {
    assert.equal(isIpRestrictionExemptPath(requestPath), false, requestPath);
  }
});
