import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.PGHOST ??= "127.0.0.1";
process.env.PGUSER ??= "test";
process.env.PGPASSWORD ??= "test";
process.env.PGDATABASE ??= "test";
process.env.MIKAGE_API_BEARER_TOKEN ??= "test-admin-bearer-token-dummy-value";
process.env.MIKAGE_ADMIN_ALLOWED_HOSTS ??= "admin.example.test";

const [{ createApp }, { pool }] = await Promise.all([
  import("../src/app.mjs"),
  import("../src/db.mjs"),
]);

test("許可外Hostのadmin requestはdatabase migration gateより前に404になる", async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    for (const requestPath of ["/admin", "/admin/", "/admin.js/", "/v1/admin/targets/"]) {
      const response = await new Promise((resolve, reject) => {
        const request = http.get({
          hostname: "127.0.0.1",
          port: server.address().port,
          path: requestPath,
          headers: { Host: "public-gateway.example" },
        }, resolve);
        request.once("error", reject);
      });
      response.resume();
      assert.equal(response.statusCode, 404, requestPath);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
