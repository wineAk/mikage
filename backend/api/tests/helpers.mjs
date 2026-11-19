import pg from "pg";

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が未設定のためテストをスキップできません。`);
  }
  return value;
}

const PRODUCTION_DATABASE_NAME = "mikage";

export function assertTestDatabaseIsolated(environment = process.env) {
  if (environment.MIKAGE_TEST_DATABASE_ISOLATED !== "true") {
    throw new Error(
      "MIKAGE_TEST_DATABASE_ISOLATED=true が未設定のため、破壊的 fixture を実行しません。"
    );
  }

  const applicationHost = environment.PGHOST;
  const fixtureHost = environment.TEST_PGHOST;
  const applicationPort = environment.PGPORT ?? "5432";
  const fixturePort = environment.TEST_PGPORT ?? "5432";
  const applicationDatabase = environment.PGDATABASE;
  const fixtureDatabase = environment.TEST_PGDATABASE;

  if (!fixtureHost) {
    throw new Error("TEST_PGHOST が未設定のため、破壊的 fixture を実行しません。");
  }

  if (
    applicationHost !== fixtureHost
    || fixtureHost !== "postgres-test-api"
    || applicationPort !== fixturePort
    || applicationDatabase !== fixtureDatabase
  ) {
    throw new Error(
      "PG* と TEST_PG* は同一の test PostgreSQL（host/port/database）を指す必要があります。"
    );
  }

  if (!applicationDatabase || !applicationDatabase.endsWith("_test")) {
    throw new Error(
      `test 用 DB 名には _test サフィックスが必須です（現在: ${applicationDatabase ?? "(未設定)"}）。`
    );
  }

  if (applicationDatabase === PRODUCTION_DATABASE_NAME || fixtureDatabase === PRODUCTION_DATABASE_NAME) {
    throw new Error("通常 DB 名 mikage への fixture 接続は拒否されます。");
  }
}

export function createTestPool() {
  assertTestDatabaseIsolated();
  return new pg.Pool({
    host: requireEnv("TEST_PGHOST"),
    port: Number(process.env.TEST_PGPORT ?? "5432"),
    user: requireEnv("TEST_PGUSER"),
    password: requireEnv("TEST_PGPASSWORD"),
    database: requireEnv("TEST_PGDATABASE"),
  });
}

export async function resetMonitoringFixture(pool) {
  assertTestDatabaseIsolated();
  await pool.query(`
    TRUNCATE mikage.logs, mikage.watch_result_batches, mikage.incident_transition_batches, mikage.watch_target_states, mikage.watch_scheduler_lock, mikage.incidents, mikage.target_change_audit RESTART IDENTITY;
    DELETE FROM mikage.targets;
    INSERT INTO mikage.targets (key, name, url, headers, is_enabled) VALUES
      ('t-alpha', 'Alpha', 'https://api.example.test/a', NULL, true),
      ('t-beta', 'Beta', 'https://api.example.test/b', NULL, true),
      ('t-off', 'Off', 'https://api.example.test/off', NULL, false);
  `);
}

export async function startTestServer(createApp) {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}
