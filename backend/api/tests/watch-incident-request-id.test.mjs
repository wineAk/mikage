import assert from "node:assert/strict";
import test from "node:test";
import { parseWatchSlot } from "../../../server/app/library/watch/watchSlot.mjs";
import { isValidWatchIncidentRequestId } from "../src/watch-incident-request-id.mjs";

const SLOT = "2026-11-16T11:00:00.000Z";
const LABEL = "saaske";

test("parseWatchSlot slotStart yields request_ids accepted by API validator", () => {
  const { slotStart } = parseWatchSlot(SLOT);
  assert.equal(slotStart, SLOT);

  for (const operation of ["open", "pending", "update", "close"]) {
    const requestId = `${slotStart}:${LABEL}:${operation}`;
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