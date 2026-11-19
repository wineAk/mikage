export function assertTestDatabaseIsolated(expectedHost, environment = process.env) {
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
    || fixtureHost !== expectedHost
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

  if (applicationDatabase === "mikage" || fixtureDatabase === "mikage") {
    throw new Error("通常 DB 名 mikage への fixture 接続は拒否されます。");
  }
}
