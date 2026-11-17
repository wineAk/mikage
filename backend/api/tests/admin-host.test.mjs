import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import test from "node:test";
import { isAdminRequestPath, isAllowedAdminHost } from "../src/admin-host.mjs";

test("admin hostは許可名へ完全一致させ、portを正規化する", () => {
  const allowedHosts = new Set(["admin.example.test", "127.0.0.1"]);
  assert.equal(isAllowedAdminHost("admin.example.test", allowedHosts), true);
  assert.equal(isAllowedAdminHost("ADMIN.EXAMPLE.TEST:8443", allowedHosts), true);
  assert.equal(isAllowedAdminHost("127.0.0.1", allowedHosts), false);
  assert.equal(isAllowedAdminHost("localhost", new Set(["localhost"])), false);
  assert.equal(isAllowedAdminHost("[::1]", new Set(["::1"])), false);
  assert.equal(isAllowedAdminHost("[::1]:3100", new Set(["[::1]"])), false);
  assert.equal(isAllowedAdminHost("127.0.0.2:3100", new Set(["127.0.0.2"])), false);
  assert.equal(isAllowedAdminHost("localhost.", new Set(["localhost."])), false);
  assert.equal(isAllowedAdminHost("dashboard.localhost", new Set(["dashboard.localhost"])), false);
  assert.equal(isAllowedAdminHost("public-gateway.example", allowedHosts), false);
  assert.equal(isAllowedAdminHost("admin.example.test.evil", allowedHosts), false);
  assert.equal(isAllowedAdminHost("", allowedHosts), false);
  assert.equal(isAllowedAdminHost(undefined, allowedHosts), false);
});

test("DB gateより前に拒否する管理pathだけを判定する", () => {
  for (const requestPath of ["/admin", "/admin/", "/admin.js", "/admin.js/", "/v1/admin", "/v1/admin/", "/v1/admin/targets"]) {
    assert.equal(isAdminRequestPath(requestPath), true, requestPath);
  }
  for (const requestPath of ["/health", "/v1/watch/state", "/admin/extra", "/v1/administer/targets"]) {
    assert.equal(isAdminRequestPath(requestPath), false, requestPath);
  }
});

test("LAN hostでのみadmin routeを通し、public Gateway/loopbackを404にする", async () => {
  const admin = express.Router();
  const hostGate = express.Router();
  const allow = (request, response, next) => {
    if (!isAllowedAdminHost(request.get("host"), new Set(["admin.example.test"]))) {
      response.status(404).end();
      return;
    }
    next();
  };
  hostGate.use("/admin", allow, (_request, _response, next) => next());
  admin.get("/admin", allow, (_request, response) => response.status(200).end());
  hostGate.get("/admin", (_request, response) => response.status(200).end());
  const app = express().use(hostGate);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    for (const [host, status] of [
      ["admin.example.test", 200],
      ["gw.inter.dedyn.io", 404],
      ["127.0.0.1", 404],
    ]) {
      const request = http.get({
        hostname: "127.0.0.1",
        port: server.address().port,
        path: "/admin",
        headers: { Host: host },
      });
      const actualStatus = await new Promise((resolve, reject) => {
        request.once("response", (response) => {
          response.resume();
          resolve(response.statusCode);
        });
        request.once("error", reject);
      });
      assert.equal(actualStatus, status);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
