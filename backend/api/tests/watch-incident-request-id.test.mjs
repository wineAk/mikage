import assert from "node:assert/strict";
import test from "node:test";
import { isValidWatchIncidentRequestId } from "../src/watch-incident-request-id.mjs";

const SLOT = "2026-11-16T11:00:00.000Z";
const LABEL = "saaske";

test("ISO slotStart request_ids are accepted by API validator", () => {
  for (const operation of ["open", "pending", "update", "close"]) {
    const requestId = `${SLOT}:${LABEL}:${operation}`;
    assert.equal(isValidWatchIncidentRequestId(requestId), true, requestId);
  }
});

test("request_id validator rejects slash, whitespace, empty, and length 161", () => {
  const base = `${SLOT}:${LABEL}:open`;

  assert.equal(isValidWatchIncidentRequestId(""), false);
  assert.equal(isValidWatchIncidentRequestId(`${SLOT}/${LABEL}:open`), false);
  assert.equal(isValidWatchIncidentRequestId(`${SLOT} ${LABEL}:open`), false);
  assert.equal(isValidWatchIncidentRequestId("a".repeat(161)), false);
  assert.equal(isValidWatchIncidentRequestId(base), true);
  assert.equal(isValidWatchIncidentRequestId("a".repeat(160)), true);
});
