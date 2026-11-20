import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEW_ALLOWED_HOSTS, isAllowedPreviewTargetUrl } from "./previewTargetUrl.mjs";
import { PREVIEW_ALLOWED_HOSTS as apiPreviewAllowedHosts } from "../../../../backend/api/src/preview-target-hosts.mjs";

test("preview proxy allows exact HTTPS target hosts", () => {
  for (const url of [
    "https://api.saaske.com/", "https://my.saaske.com/", "https://www.saaske.com/",
    "https://works.saaske.com/", "https://secure-link.jp/", "https://script.secure-link.jp/",
    "https://www.interpark.co.jp/", "https://kensyo-tes.works.app/", "https://kensyo-tes2.works.app/",
  ]) assert.equal(isAllowedPreviewTargetUrl(url), true, url);
});

test("preview proxy rejects spoofed, malformed, and unsafe URLs", () => {
  for (const url of [
    "https://www.interpark.co.jp.attacker.example/", "https://api.saaske.com.attacker.example/",
    "http://api.saaske.com/", "https://user@api.saaske.com/", "https://api.saaske.com/#fragment", "not a URL",
    `https://api.saaske.com/${"x".repeat(2048)}`,
  ]) assert.equal(isAllowedPreviewTargetUrl(url), false, url);
});

test("Render and API preview allowlists stay in sync", () => {
  assert.deepEqual([...PREVIEW_ALLOWED_HOSTS].sort(), [...apiPreviewAllowedHosts].sort());
});
