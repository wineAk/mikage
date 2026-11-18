import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gatewayRouteContracts } from "../api/src/routes/gateway-contracts.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderClient = fs.readFileSync(path.join(repositoryRoot, "server/app/lib/mikageApi.server.ts"), "utf8");
const gatewaySetup = fs.readFileSync(path.join(repositoryRoot, "backend/docs/gateway-setup.md"), "utf8");

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

test("Render source allowlist and API /gw routes stay aligned", () => {
  const sourceList = renderClient.match(/const GATEWAY_SOURCES = \[([\s\S]*?)\] as const;/)?.[1];
  assert.ok(sourceList, "Render Gateway client must declare its source allowlist");
  const renderSources = [...sourceList.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]).sort();
  const routeSources = gatewayRouteContracts.map(({ source }) => source).sort();

  assert.deepEqual(renderSources, Object.keys(apiPathsBySource).sort());
  assert.deepEqual(routeSources, Object.keys(apiPathsBySource).sort());
  assert.equal(new Set(routeSources).size, routeSources.length, "Gateway sources must not be duplicated");
  for (const route of gatewayRouteContracts) {
    assert.equal(route.path, `/gw/${route.source}`, `Gateway path for ${route.source}`);
    assert.deepEqual([route.method, route.apiPath], apiPathsBySource[route.source], `Gateway route ${route.source} must match its API contract`);
  }
  assert.ok(gatewayRouteContracts.every(({ path: routePath }) => !/(?:^|\/)admin(?:\/|\.|$)/i.test(routePath)));
  assert.match(gatewaySetup, /`\/office\/mikage\/` prefixを `\/gw\/` に置き換えて/);
  assert.match(gatewaySetup, /`https:\/\/mikage\.inter\.dedyn\.io`/);
  assert.doesNotMatch(gatewaySetup, /MIKAGE_API_(?:UPSTREAM|HOST)|100\.68\.1\.223/);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "backend/docs/gateway-office-mikage.caddy")), false);
});
