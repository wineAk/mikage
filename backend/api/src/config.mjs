const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が未設定です。`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? "3100"),
  database: {
    host: required("PGHOST"),
    port: Number(process.env.PGPORT ?? "5432"),
    database: required("PGDATABASE"),
    user: required("PGUSER"),
    password: required("PGPASSWORD"),
  },
  bearerToken: required("MIKAGE_API_BEARER_TOKEN"),
  maxTargetKeys: Number(process.env.MAX_TARGET_KEYS ?? "500"),
  allowedAdminHosts: new Set((required("MIKAGE_ADMIN_ALLOWED_HOSTS")).split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)),
  allowedTargetHosts: new Set((process.env.MIKAGE_TARGET_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)),
};
