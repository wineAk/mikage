import assert from "node:assert/strict";
import test from "node:test";

import { isRequestIpAllowed } from "./ipRestriction.mjs";

test("許可IPは完全一致で判定し、未設定時は拒否する", () => {
  assert.equal(isRequestIpAllowed("203.0.113.10", ["203.0.113.10"]), true);
  assert.equal(isRequestIpAllowed("203.0.113.10, 198.51.100.20", ["198.51.100.20"]), false);
  assert.equal(isRequestIpAllowed("203.0.113.10", []), false);
  assert.equal(isRequestIpAllowed("203.0.113.10", null), false);
  assert.equal(isRequestIpAllowed(undefined, ["203.0.113.10"]), false);
});
