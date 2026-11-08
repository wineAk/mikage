import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { request } from "node:http";
import { gunzipSync, brotliDecompressSync } from "node:zlib";

const server = spawn(process.execPath, ["build/server.js"], { env: { ...process.env, PORT: "3087" }, stdio: ["ignore", "pipe", "pipe"] });
const ready = new Promise((resolve, reject) => {
  server.stdout.on("data", chunk => { if (chunk.toString().includes("サーバー起動")) resolve(); });
  server.once("exit", code => reject(new Error(`server exit ${code}`)));
});

function fetchAsset(asset, encoding, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = request(`http://127.0.0.1:3087/assets/${asset}`, { method, headers: { "accept-encoding": encoding } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

try {
  await ready;
  const files = await readdir("build/client/assets");
  const compressed = files.find(name => name.endsWith(".js.br"));
  assert.ok(compressed, "圧縮済みJavaScriptが必要です。");
  const asset = compressed.slice(0, -3);
  const original = await readFile(`build/client/assets/${asset}`);
  for (const encoding of ["identity", "gzip", "br", "br;q=0,gzip;q=1"]) {
    const response = await fetchAsset(asset, encoding);
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /javascript/);
    assert.match(response.headers["cache-control"], /max-age=31536000.*immutable/);
    assert.match(response.headers.vary, /Accept-Encoding/i);
    const selected = response.headers["content-encoding"];
    const decoded = selected === "br" ? brotliDecompressSync(response.body) : selected === "gzip" ? gunzipSync(response.body) : response.body;
    assert.deepEqual(decoded, original);
    assert.equal(selected, encoding === "identity" ? undefined : encoding === "br" ? "br" : "gzip");
  }
  const head = await fetchAsset(asset, "br", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers["content-encoding"], "br");
  const missing = await fetchAsset("does-not-exist.js", "br");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers["content-encoding"], undefined);
  const unacceptable = await fetchAsset(asset, "identity;q=0,*;q=0");
  assert.equal(unacceptable.status, 406);
  console.log("静的配信: identity/gzip/br/品質指定/HEAD/404/406の7件が通過しました。");
} finally {
  server.kill();
}
