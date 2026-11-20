import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configModuleUrl = pathToFileURL(resolve(apiDirectory, "src/config.mjs")).href;
const minimumLength = "a".repeat(32);

function importConfig({ bearerToken, adminHosts = "admin.example.test", gatewayHosts } = {}) {
  const environment = {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGUSER: "test",
    PGPASSWORD: "test",
    PGDATABASE: "test",
    MIKAGE_API_BEARER_TOKEN: bearerToken,
    MIKAGE_ADMIN_ALLOWED_HOSTS: adminHosts,
  };
  if (gatewayHosts === undefined) delete environment.MIKAGE_GATEWAY_ALLOWED_HOSTS;
  else environment.MIKAGE_GATEWAY_ALLOWED_HOSTS = gatewayHosts;

  return spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(configModuleUrl)})`,
  ], { cwd: apiDirectory, env: environment, encoding: "utf8" });
}

test("Bearerが32文字未満なら起動を拒否し、値と長さをエラーに含めない", () => {
  const shortToken = "b".repeat(31);
  const result = importConfig({ bearerToken: shortToken });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /32文字以上/);
  assert.doesNotMatch(result.stderr, new RegExp(shortToken));
  assert.doesNotMatch(result.stderr, /31/);
});

test("Bearerが32文字ちょうどなら起動できる", () => {
  const result = importConfig({ bearerToken: minimumLength });

  assert.equal(result.status, 0, result.stderr);
});

test("空のBearerは起動時に拒否する", () => {
  const result = importConfig({ bearerToken: "" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MIKAGE_API_BEARER_TOKEN が未設定/);
});

test("GatewayとAdminに同じHostを設定すると起動を拒否する", () => {
  const result = importConfig({
    bearerToken: minimumLength,
    adminHosts: "ADMIN.example.test",
    gatewayHosts: "gateway.example.test,admin.example.test",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /同じHostは設定できません/);
});
