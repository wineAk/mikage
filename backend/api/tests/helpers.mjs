import pg from "pg";

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} が未設定のためテストをスキップできません。`);
  }
  return value;
}

export function createTestPool() {
  return new pg.Pool({
    host: requireEnv("TEST_PGHOST"),
    port: Number(process.env.TEST_PGPORT ?? "5432"),
    user: requireEnv("TEST_PGUSER"),
    password: requireEnv("TEST_PGPASSWORD"),
    database: requireEnv("TEST_PGDATABASE"),
  });
}

export async function resetMonitoringFixture(pool) {
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
