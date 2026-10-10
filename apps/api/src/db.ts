import { db, pool } from '@aglotrends/database';

export { db, pool };
export * as schema from '@aglotrends/database';

/** The root Drizzle client type. */
export type Db = typeof db;
/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the root client or a transaction — for helpers usable in both. */
export type DbLike = Db | Tx;
