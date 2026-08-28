import pg from "pg";

const { Client } = pg;

export async function createPostgresTestContext(name) {
  const baseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!baseUrl) return { skipped: true, reason: "POSTGRES_URL or DATABASE_URL is not set" };

  const schema = `vigilai_${slug(name)}_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: baseUrl });
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  } catch (error) {
    await admin.end().catch(() => {});
    return { skipped: true, reason: `PostgreSQL unavailable: ${error.message}` };
  }

  return {
    skipped: false,
    schema,
    connectionString: withSearchPath(baseUrl, schema),
    async cleanup() {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      } finally {
        await admin.end().catch(() => {});
      }
    }
  };
}

function withSearchPath(connectionString, schema) {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "test";
}
