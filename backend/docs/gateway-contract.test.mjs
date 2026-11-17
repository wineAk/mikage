import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderClient = fs.readFileSync(path.join(repositoryRoot, "server/app/lib/mikageApi.server.ts"), "utf8");
const caddyRoutes = fs.readFileSync(path.join(repositoryRoot, "backend/docs/gateway-office-mikage.caddy"), "utf8");

const apiPathsBySource = {
  "watch-targets": ["GET", "/v1/monitoring/targets"],
  "watch-reservations": ["POST", "/v1/watch/reservations"],
  "watch-results": ["POST", "/v1/watch/results"],
  "watch-state": ["GET", "/v1/watch/state"],
  "watch-incidents": ["POST", "/v1/watch/incidents"],
  "view-targets": ["GET", "/v1/view/targets"],
  "view-target-proxy": ["GET", "/v1/view/target-proxy"],
  "view-logs": ["GET", "/v1/view/logs"],
  "view-errors": ["GET", "/v1/view/errors"],
  "view-incidents": ["GET", "/v1/view/incidents"],
  "view-revision": ["GET", "/v1/view/revision"],
};

function parseCaddyRoutes() {
  return caddyRoutes
    .split("\n@office_mikage_")
    .slice(1)
    .map((block) => {
      const methodAndPath = block.match(/method (GET|POST)\s+path \/office\/mikage\/([a-z-]+)/);
      const rewritePath = block.match(/rewrite \* (\/[^\s]+)/);
      assert.ok(methodAndPath, "Caddy route must declare a method and source path");
      assert.ok(rewritePath, `Caddy route ${methodAndPath[2]} must rewrite to an API path`);
      assert.doesNotMatch(block, /rewrite \* [^\r\n]*\?/, `Caddy route ${methodAndPath[2]} must preserve its incoming query string`);
      assert.ok(block.includes("header_up Host {$MIKAGE_API_HOST}"), `Caddy route ${methodAndPath[2]} must preserve Dokploy Host routing`);
      assert.ok(block.includes("tls_server_name {$MIKAGE_API_HOST}"), `Caddy route ${methodAndPath[2]} must verify the Dokploy HTTPS certificate name`);
      assert.ok(block.includes("header_up -X-Origin-Verify"), `Caddy route ${methodAndPath[2]} must remove the CloudFront-only header`);
      return [methodAndPath[2], methodAndPath[1], rewritePath[1]];
    });
}

test("Render Gateway source, method, API path, and Dokploy Host routing stay aligned", () => {
  const sourceList = renderClient.match(/const GATEWAY_SOURCES = \[([\s\S]*?)\] as const;/)?.[1];
  assert.ok(sourceList, "Render Gateway client must declare its source allowlist");
  const renderSources = [...sourceList.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]).sort();
  const routes = parseCaddyRoutes();
  const caddySources = routes.map(([source]) => source).sort();

  assert.deepEqual(renderSources, Object.keys(apiPathsBySource).sort());
  assert.deepEqual(caddySources, Object.keys(apiPathsBySource).sort());
  assert.equal(new Set(caddySources).size, caddySources.length, "Caddy sources must not be duplicated");
  for (const [source, method, apiPath] of routes) {
    assert.deepEqual([method, apiPath], apiPathsBySource[source], `Caddy route ${source} must match its API contract`);
  }
  assert.doesNotMatch(caddyRoutes, /path \/office\/mikage\/(?:admin|v1\/admin)/);
});
