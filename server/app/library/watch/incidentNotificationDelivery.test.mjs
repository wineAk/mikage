import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverActiveIncidentNotifications,
  deliverResolvedIncidentNotifications,
} from "./incidentNotificationDelivery.mjs";
import {
  PreviewNotificationAbortError,
  PreviewNotificationApiFailureError,
  buildPreviewGoogleChatThreadName,
  buildPreviewInstatusId,
} from "./previewNotification.mjs";
import { isIncidentNotificationDue } from "./incidentNotificationPolicy.mjs";

const previewEnv = {
  IS_PULL_REQUEST: "true",
  MIKAGE_PREVIEW_NOTIFICATION_MOCK: "true",
};

const productionEnv = {
  IS_PULL_REQUEST: "false",
};

const prWithoutMockEnv = {
  IS_PULL_REQUEST: "true",
};

const incident = {
  instatus_id: null,
  googlechat_name: null,
  created_at: "2026-11-19T05:00:00.000Z",
};

function createTrackingClients() {
  const calls = [];
  return {
    calls,
    instatusClients: {
      async createIncident(options) {
        calls.push(["instatus.create", options]);
        return { incident: { id: "live-instatus" } };
      },
      async updateIncident(incidentId, options) {
        calls.push(["instatus.update", incidentId, options]);
        return { incident: { id: incidentId } };
      },
      async resolveIncident(incidentId, options) {
        calls.push(["instatus.resolve", incidentId, options]);
        return { ok: true };
      },
    },
    googleChatClients: {
      async createThread(errors, instatusUrl) {
        calls.push(["googlechat.create", errors.length, instatusUrl]);
        return { thread: { name: "spaces/live/threads/live-thread" } };
      },
      async updateThread(errors, name) {
        calls.push(["googlechat.update", errors.length, name]);
        return { ok: true };
      },
      async resolveThread(errors, name) {
        calls.push(["googlechat.resolve", errors.length, name]);
        return { ok: true };
      },
    },
  };
}

test("通常serviceは本番クライアントへ外部通知を委譲する", async () => {
  const { calls, instatusClients, googleChatClients } = createTrackingClients();
  const errors = [{ key: "saaske1", name: "Saaske", log: { startDate: 0, responseTime: 1, statusCode: 500, statusMessage: "ERR", errorName: "E", errorCode: "1" } }];
  const now = new Date("2026-11-19T05:05:00.000Z");

  const delivery = await deliverActiveIncidentNotifications({
    environment: productionEnv,
    label: "saaske",
    errors,
    incident,
    pageId: "page-1",
    component: "comp-1",
    serviceName: "サスケ",
    now,
    instatusClients,
    googleChatClients,
  });

  assert.equal(delivery.mode, "production");
  assert.equal(delivery.instatusId, "live-instatus");
  assert.equal(delivery.googleChatName, "spaces/live/threads/live-thread");
  assert.deepEqual(calls.map((call) => call[0]), [
    "instatus.create",
    "googlechat.create",
    "googlechat.update",
  ]);
});

test("Render Previewでmockを有効にしない場合は通知を送らない", async () => {
  const { calls, instatusClients, googleChatClients } = createTrackingClients();

  const delivery = await deliverActiveIncidentNotifications({
    environment: prWithoutMockEnv,
    label: "saaske",
    errors: [],
    incident,
    pageId: "page-1",
    component: "comp-1",
    serviceName: "サスケ",
    now: new Date(),
    instatusClients,
    googleChatClients,
  });

  assert.equal(delivery.delivered, false);
  assert.equal(calls.length, 0);
});

test("Preview mockは決定的なIDを返しnetwork I/Oを使わない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not run in preview mock mode");
  };
  try {
    const { calls, instatusClients, googleChatClients } = createTrackingClients();
    const delivery = await deliverActiveIncidentNotifications({
      environment: previewEnv,
      label: "saaske_api",
      errors: [{ key: "saaske_api", name: "API", log: { startDate: 0, responseTime: 1, statusCode: 500, statusMessage: "ERR", errorName: "E", errorCode: "1" } }],
      incident,
      pageId: "",
      component: "",
      serviceName: "サスケAPI",
      now: new Date(),
      instatusClients,
      googleChatClients,
    });

    assert.equal(delivery.mode, "preview_mock");
    assert.equal(delivery.instatusId, buildPreviewInstatusId("saaske_api"));
    assert.equal(delivery.googleChatName, buildPreviewGoogleChatThreadName("saaske_api"));
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Preview mockのapi_failureはDB更新前に失敗する", async () => {
  await assert.rejects(
    () => deliverActiveIncidentNotifications({
      environment: {
        ...previewEnv,
        MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE: "api_failure",
      },
      label: "works",
      errors: [],
      incident,
      pageId: "page",
      component: "comp",
      serviceName: "Works",
      now: new Date(),
      instatusClients: createTrackingClients().instatusClients,
      googleChatClients: createTrackingClients().googleChatClients,
    }),
    PreviewNotificationApiFailureError,
  );
});

test("Preview mockのafter_notification_before_dbは送信後に503相当へabortする", async () => {
  await assert.rejects(
    () => deliverActiveIncidentNotifications({
      environment: {
        ...previewEnv,
        MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE: "after_notification_before_db",
      },
      label: "works",
      errors: [],
      incident,
      pageId: "page",
      component: "comp",
      serviceName: "Works",
      now: new Date(),
      instatusClients: createTrackingClients().instatusClients,
      googleChatClients: createTrackingClients().googleChatClients,
    }),
    PreviewNotificationAbortError,
  );
});

test("PR以外ではfailure injection modeを無効にする", async () => {
  const { calls, instatusClients, googleChatClients } = createTrackingClients();
  const delivery = await deliverActiveIncidentNotifications({
    environment: {
      IS_PULL_REQUEST: "false",
      MIKAGE_PREVIEW_NOTIFICATION_FAILURE_MODE: "api_failure",
    },
    label: "saaske",
    errors: [{ key: "saaske1", name: "Saaske", log: { startDate: 0, responseTime: 1, statusCode: 500, statusMessage: "ERR", errorName: "E", errorCode: "1" } }],
    incident,
    pageId: "page-1",
    component: "comp-1",
    serviceName: "サスケ",
    now: new Date(),
    instatusClients,
    googleChatClients,
  });

  assert.equal(delivery.mode, "production");
  assert.ok(calls.length > 0);
});

test("通知失敗後のretry収束はpending通知が即時dueになる", async () => {
  const pendingIncident = {
    ...incident,
    updated_at: "2026-11-19T05:00:00.000Z",
    notification_pending: true,
  };
  const now = new Date("2026-11-19T05:01:00.000Z");

  assert.equal(
    isIncidentNotificationDue({
      isNewIncident: false,
      isNotificationPending: pendingIncident.notification_pending,
      updatedAt: pendingIncident.updated_at,
      now,
    }),
    true,
  );

  const { instatusClients, googleChatClients } = createTrackingClients();
  const retryDelivery = await deliverActiveIncidentNotifications({
    environment: previewEnv,
    label: "saaske",
    errors: [{ key: "saaske1", name: "Saaske", log: { startDate: 0, responseTime: 1, statusCode: 500, statusMessage: "ERR", errorName: "E", errorCode: "1" } }],
    incident: pendingIncident,
    pageId: "",
    component: "",
    serviceName: "サスケ",
    now,
    instatusClients,
    googleChatClients,
  });

  assert.equal(retryDelivery.instatusId, buildPreviewInstatusId("saaske"));
  assert.equal(retryDelivery.googleChatName, buildPreviewGoogleChatThreadName("saaske"));
});

test("Preview mockは解決通知もnetwork I/Oを使わない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch must not run in preview mock mode");
  };
  try {
    const { calls, instatusClients, googleChatClients } = createTrackingClients();
    const delivery = await deliverResolvedIncidentNotifications({
      environment: previewEnv,
      incident: {
        instatus_id: buildPreviewInstatusId("works"),
        googlechat_name: buildPreviewGoogleChatThreadName("works"),
      },
      pageId: "page",
      component: "comp",
      now: new Date(),
      instatusClients,
      googleChatClients,
    });

    assert.equal(delivery.mode, "preview_mock");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});