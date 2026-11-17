import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const apiDbPassword = process.env.MIKAGE_API_DB_PASSWORD;
const maintenanceDbPassword = process.env.MIKAGE_MAINTENANCE_DB_PASSWORD;
if (!apiDbPassword || !maintenanceDbPassword) {
  console.error("APIまたはmaintenance DB passwordが未設定です。");
  process.exit(1);
}

const client = new pg.Client();

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(1651470451, 1)");

  const { rows: roleRows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mikage_api') AS role_exists"
  );
  const roleCommand = roleRows[0].role_exists ? "ALTER ROLE" : "CREATE ROLE";
  const { rows: commandRows } = await client.query(
    `SELECT format('${roleCommand} mikage_api WITH LOGIN PASSWORD %L', $1::text) AS command`,
    [apiDbPassword]
  );
  await client.query(commandRows[0].command);

  const { rows: maintenanceRoleRows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mikage_maintenance') AS role_exists"
  );
  const maintenanceRoleCommand = maintenanceRoleRows[0].role_exists ? "ALTER ROLE" : "CREATE ROLE";
  const { rows: maintenanceCommandRows } = await client.query(
    `SELECT format('${maintenanceRoleCommand} mikage_maintenance WITH LOGIN PASSWORD %L', $1::text) AS command`,
    [maintenanceDbPassword]
  );
  await client.query(maintenanceCommandRows[0].command);

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows: appliedRows } = await client.query(
    "SELECT version FROM public.schema_migrations ORDER BY version"
  );
  const applied = new Set(appliedRows.map((row) => row.version));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      console.log(`skip ${version}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO public.schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      console.log(`applied ${version}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
