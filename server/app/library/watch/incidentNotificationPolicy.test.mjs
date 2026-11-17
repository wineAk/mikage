import assert from "node:assert/strict";
import test from "node:test";
import { isIncidentNotificationDue } from "./incidentNotificationPolicy.mjs";

test("新しいincidentは通知間隔を待たず通知する", () => {
  assert.equal(isIncidentNotificationDue({
    isNewIncident: true,
    updatedAt: "2026-11-16T16:00:00.000Z",
    now: new Date("2026-11-16T16:00:00.000Z"),
  }), true);
});

test("通知保存が保留中なら間隔を待たず再試行する", () => {
  assert.equal(isIncidentNotificationDue({
    isNewIncident: false,
    isNotificationPending: true,
    updatedAt: "2026-11-16T16:00:00.000Z",
    now: new Date("2026-11-16T16:00:01.000Z"),
  }), true);
});

test("incident更新から5分未満は再通知せず、5分経過した時点で再通知する", () => {
  const updatedAt = "2026-11-16T16:00:00.000Z";

  assert.equal(isIncidentNotificationDue({
    isNewIncident: false,
    updatedAt,
    now: new Date("2026-11-16T16:04:59.999Z"),
  }), false);
  assert.equal(isIncidentNotificationDue({
    isNewIncident: false,
    updatedAt,
    now: new Date("2026-11-16T16:05:00.000Z"),
  }), true);
});

test("通知後のDB保存に失敗してupdated_atが進まなければ次の通知可能tickで再送する", () => {
  const incidentUpdatedAt = "2026-11-16T16:00:00.000Z";
  const nextNotificationTick = new Date("2026-11-16T16:05:00.000Z");

  assert.equal(isIncidentNotificationDue({
    isNewIncident: false,
    updatedAt: incidentUpdatedAt,
    now: nextNotificationTick,
  }), true);
});
