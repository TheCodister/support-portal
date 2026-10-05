import pg from "pg";

const { Pool } = pg;
export type DbClient = pg.PoolClient;

export function createPool(connectionString = process.env.DATABASE_URL) {
  const connection = connectionString ? { connectionString } : {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432), database: process.env.DB_NAME ?? "supportdesk",
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined
  };
  if (!connectionString && (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD)) throw new Error("DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD is required");
  return new Pool({ ...connection, max: Number(process.env.DB_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function transaction<T>(pool: pg.Pool, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type Database = ReturnType<typeof createPool>;
