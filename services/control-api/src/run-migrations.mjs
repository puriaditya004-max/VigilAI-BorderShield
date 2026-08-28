import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../migrations");

export async function runMigrations({
  connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL || "postgres://vigilai:vigilai@localhost:5433/vigilai",
  directory = migrationsDir
} = {}) {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version));
    const migrationFiles = fs.readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const appliedVersions = [];
    for (const file of migrationFiles) {
      const version = path.basename(file, ".sql");
      if (applied.has(version)) continue;
      const sql = fs.readFileSync(path.join(directory, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      appliedVersions.push(version);
      console.log(`applied ${version}`);
    }

    await client.query("COMMIT");
    console.log("postgres migrations complete");
    return { applied: appliedVersions };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
