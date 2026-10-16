import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const pool = new Pool({ connectionString });

const migrationName = "001_initial_schema.sql";
const requiredTables = [
  "accounts",
  "plans",
  "users",
  "usage_periods",
  "usage_requests",
];

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const recorded = await client.query(
      "SELECT name FROM schema_migrations WHERE name = $1",
      [migrationName],
    );

    if (recorded.rowCount > 0) {
      console.log(`Migration already recorded: ${migrationName}`);
      return;
    }

    const existing = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [requiredTables],
    );

    const existingNames = existing.rows.map((row) => row.table_name);

    if (existingNames.length === requiredTables.length) {
      const plans = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM plans
         WHERE is_builtin = TRUE
           AND (
             (scope = 'account' AND name IN ('Starter', 'Pro'))
             OR
             (scope = 'user' AND name IN ('Basic', 'Premium'))
           )`,
      );

      if (plans.rows[0].count !== 4) {
        throw new Error(
          "Existing schema detected, but built-in plans are incomplete. No migration was applied.",
        );
      }

      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
        [migrationName],
      );

      console.log(
        "Existing schema and built-in plans detected; recorded migration without changing application data.",
      );
      return;
    }

    if (existingNames.length > 0) {
      throw new Error(
        `Partial schema detected (${existingNames.join(", ")}). Refusing to apply migration automatically.`,
      );
    }

    const sql = await readFile(
      new URL("../migrations/001_initial_schema.sql", import.meta.url),
      "utf8",
    );

    await client.query(sql);

    await client.query(
      "INSERT INTO schema_migrations (name) VALUES ($1)",
      [migrationName],
    );

    console.log(`Migration applied: ${migrationName}`);
  } finally {
    client.release();
  }
}

try {
  await migrate();
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
