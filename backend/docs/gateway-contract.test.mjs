import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gatewayRouteContracts } from "../api/src/routes/gateway-contracts.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderClient = fs.readFileSync(path.join(repositoryRoot, "server/app/lib/mikageApi.server.ts"), "utf8");
const gatewaySetup = fs.readFileSync(path.join(repositoryRoot, "backend/docs/gateway-setup.md"), "utf8");
const apiContract = fs.readFileSync(path.join(repositoryRoot, "backend/docs/api-contract.md"), "utf8");

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
  assert.match(gatewaySetup, /`\/office\/mikage\/<source>`/);
  assert.match(gatewaySetup, /`https:\/\/mikage\.inter\.dedyn\.io\/gw\//);
  assert.match(gatewaySetup, /`\/office\/mikage-staging\/<source>`/);
  assert.match(renderClient, /MIKAGE_GATEWAY_APP/);
  assert.match(renderClient, /IS_PULL_REQUEST/);
  assert.match(renderClient, /resolveMikageGatewayApp/);
  assert.match(gatewaySetup, /未設定時は `mikage`/);
  assert.match(apiContract, /`MIKAGE_GATEWAY_APP=mikage-staging`/);
  assert.match(apiContract, /IS_PULL_REQUEST=true.*fail closed/s);
  assert.match(gatewaySetup, /`\/office\/mikage-staging\/<source>`/);
  assert.match(apiContract, /Preview[^\n]+watch[^\n]+Staging API/);
  assert.match(gatewaySetup, /query.*POST bodyを保ち/);
  assert.match(gatewaySetup, /`X-Origin-Verify` はupstreamへ渡しません/);
  assert.match(apiContract, /Caddyはpathだけで転送先を決め/);
  assert.match(gatewaySetup, /Caddyfileの変更はClaudeが行います/);
  assert.match(gatewaySetup, /tokenの文字列形式や接頭辞にrouting上の意味はありません/);
  assert.match(gatewaySetup, /`DATABASE_URL`/);
  assert.match(gatewaySetup, /`VITE_GOOGLE_WEBHOOK_URL`/);
  assert.match(apiContract, /`X-Origin-Verify` はCaddyからAPIへ転送しない/);
  assert.doesNotMatch(gatewaySetup, /MIKAGE_API_(?:UPSTREAM|HOST)|100\.68\.1\.223|Tailscale/i);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "backend/docs/gateway-office-mikage.caddy")), false);
});
