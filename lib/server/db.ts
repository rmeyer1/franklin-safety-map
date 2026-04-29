import { Pool, types } from "pg";

import { getEnv } from "@/lib/config/env";

// Ensure bigint values are returned as JavaScript numbers, not strings
types.setTypeParser(types.builtins.INT8, (val) => Number(val));

let pool: Pool | undefined;

export function getDbPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = getEnv().SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error("SUPABASE_DB_URL is not configured");
  }

  // Prefer the pooler URL if set (IPv4-compatible for Vercel serverless),
  // otherwise use the direct connection URL (works locally with IPv6).
  const poolerUrl = getEnv().SUPABASE_DB_POOLER_URL;
  const resolvedConnectionString = poolerUrl || connectionString;

  pool = new Pool({
    connectionString: resolvedConnectionString,
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