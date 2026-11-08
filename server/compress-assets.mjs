import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

// ビルド時に圧縮し、配信時のCPU負荷と転送量を抑える。
async function compressAssets(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const assetPath = join(directory, entry.name);
    if (entry.isDirectory()) await compressAssets(assetPath);
    else if (/\.(js|css|svg|json)$/.test(entry.name)) {
      const content = await readFile(assetPath);
      if (content.length < 1024) continue;
      await Promise.all([
        writeFile(`${assetPath}.gz`, gzipSync(content, { level: 9 })),
        writeFile(`${assetPath}.br`, brotliCompressSync(content, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } })),
      ]);
    }
  }
}

await compressAssets(fileURLToPath(new URL("./build/client/assets/", import.meta.url)));
