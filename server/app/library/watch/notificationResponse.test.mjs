import assert from "node:assert/strict";
import test from "node:test";
import { parseSuccessfulNotificationResponse } from "./notificationResponse.mjs";

test("通知APIの成功応答をJSONとして返す", async () => {
  const response = new Response(JSON.stringify({ id: "notification-1" }), { status: 201 });

  assert.deepEqual(await parseSuccessfulNotificationResponse(response, "test service"), { id: "notification-1" });
});

test("通知APIのHTTPエラーは機密本文を含めず例外にする", async () => {
  const response = new Response("sensitive response body", { status: 503 });

  await assert.rejects(
    parseSuccessfulNotificationResponse(response, "test service"),
    (error) => {
      assert.equal(error.message, "test service notification failed with HTTP 503.");
      assert.equal(error.message.includes("sensitive response body"), false);
      return true;
    }
  );
});
