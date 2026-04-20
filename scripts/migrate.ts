import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getDbPool } from "@/lib/server/db";

async function main() {
  const migrationsDir = path.join(process.cwd(), "sql", "migrations");
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const pool = getDbPool();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    console.log(`Running migration: ${file}`);
    await pool.query(sql);
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

