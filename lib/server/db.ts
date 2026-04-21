import { Pool } from "pg";

import { getEnv } from "@/lib/config/env";

let pool: Pool | undefined;

export function getDbPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = getEnv().SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is not configured");
  }

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  return pool;
}

export async function closeDbPool(): Promise<void> {
  if (!pool) {
    return;
  }

  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}
