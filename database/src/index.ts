import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

/**
 * Shared Drizzle client. Import `db` for queries, or the `schema` for table refs.
 * Connection string comes from DATABASE_URL. The fallback is deliberately
 * passwordless — no credential lives in source; set DATABASE_URL in `.env`.
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgres://aglotrends@localhost:5433/aglotrends';

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from './schema.js';
export * from './password.js';
