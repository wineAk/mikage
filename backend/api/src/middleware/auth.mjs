import { timingSafeEqual } from "node:crypto";
import { config } from "../config.mjs";

export function requireBearerAuth(request, response, next) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    response.status(401).json({ error: "認証が必要です。" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(config.bearerToken);
  if (
    tokenBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(tokenBuffer, expectedBuffer)
  ) {
    response.status(401).json({ error: "認証に失敗しました。" });
    return;
  }

  next();
}
