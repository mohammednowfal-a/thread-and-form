import { readdirSync, readFileSync } from "fs";
import path from "path";
import pg from "pg";

// Applies the versioned SQL migrations to a clean test database (same SQL that `prisma migrate deploy` runs).
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://tf:tf_dev_pw@localhost:5432/threadform_test";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const dir = path.resolve(__dirname, "../prisma/migrations");
  for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
    await client.query(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
  }
  await client.end();
}
