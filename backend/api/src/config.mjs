const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が未設定です。`);
  }
  return value;
};

const parseAllowedHosts = (value) => new Set((value ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean));

const bearerToken = required("MIKAGE_API_BEARER_TOKEN");
if (bearerToken.length < 32) {
  throw new Error("MIKAGE_API_BEARER_TOKEN は32文字以上で設定してください。");
}

const allowedAdminHosts = parseAllowedHosts(required("MIKAGE_ADMIN_ALLOWED_HOSTS"));
const configuredGatewayHosts = process.env.MIKAGE_GATEWAY_ALLOWED_HOSTS;
export const parseGatewayAllowedHosts = (value) => {
  const hosts = parseAllowedHosts(value);
  return hosts.size > 0 ? hosts : null;
};

const allowedGatewayHosts = parseGatewayAllowedHosts(configuredGatewayHosts);

if (allowedGatewayHosts && [...allowedGatewayHosts].some((host) => allowedAdminHosts.has(host))) {
  throw new Error("MIKAGE_GATEWAY_ALLOWED_HOSTS と MIKAGE_ADMIN_ALLOWED_HOSTS に同じHostは設定できません。");
}

export const config = {
  port: Number(process.env.PORT ?? "3100"),
  database: {
    host: required("PGHOST"),
    port: Number(process.env.PGPORT ?? "5432"),
    database: required("PGDATABASE"),
    user: required("PGUSER"),
    password: required("PGPASSWORD"),
  },
  bearerToken,
  maxTargetKeys: Number(process.env.MAX_TARGET_KEYS ?? "500"),
  allowedAdminHosts,
  allowedGatewayHosts,
  allowedTargetHosts: new Set((process.env.MIKAGE_TARGET_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)),
};
