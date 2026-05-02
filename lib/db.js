/**
 * lib/db.js — postgres connection pool for the Phase 6 analytics reads.
 *
 * Why a singleton: Vercel serverless instances persist across invocations
 * when warm.  Re-creating the pool on every request would (a) miss the
 * connection-reuse benefit and (b) leak idle connections faster than
 * the pooler can close them.  By stashing the pool on `globalThis` we
 * get one pool per warm instance, automatically GC'd when the instance
 * is recycled.
 *
 * Why `pg` (node-postgres) and not `@supabase/postgres-js` (porsager):
 * pg has wider Vercel ecosystem coverage, better TypeScript ecosystem
 * support, and is the boring choice with 15 years of production use.
 * porsager is faster for streaming workloads but the analytics reads
 * here are small (kilobytes) so it doesn't matter.
 *
 * Why analytics_reader role and DATABASE_URL_READER, not service_role:
 * least privilege.  See bot repo migration 025 header for the full
 * argument.  The short version: if Vercel env leaks, blast radius is
 * "scrape analytics MVs" rather than "delete every trade row."
 *
 * Pool sizing: max=5 per instance.  Vercel scales horizontally; under
 * load we get many instances each with a small pool.  Aggregate
 * concurrent connections cap at the role's CONNECTION LIMIT 25
 * (mig 025) which is well below the Pro pooler's 60-connection
 * ceiling.
 */

import pg from 'pg';

const { Pool } = pg;

const GLOBAL_KEY = '__adekagagwaa_dashboard_pg_pool__';

function buildPool() {
  const url = process.env.DATABASE_URL_READER;
  if (!url) {
    // Don't throw at module-load time; throw lazily so the route
    // handler can return a clean 500 with a useful message.  Throwing
    // here would crash the entire serverless instance at import.
    return null;
  }
  return new Pool({
    connectionString: url,
    // Supabase pooler: SSL required.  rejectUnauthorized:false is the
    // standard Supabase pattern — they self-sign with a CA chain not
    // in Node's default bundle.  Connection over TLS is still
    // encrypted; we just don't pin the cert.
    ssl: { rejectUnauthorized: false },
    // Per-instance pool sizing.  Small because Vercel's instance
    // concurrency model means many instances each issue a few queries
    // at most — large per-instance pools waste connections.
    max: 5,
    // Idle: close connections that sit unused for 30s.  Pooler is
    // session-mode-tolerant but instance recycle is faster than
    // idle holds.
    idleTimeoutMillis: 30_000,
    // Connection acquisition: 10s before erroring out.  Anything
    // longer is a failure, not a wait.
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * Return the singleton pool.  Returns null when DATABASE_URL_READER
 * is not configured — callers must handle that case explicitly
 * (typically by returning a 500 with a configuration-missing error).
 */
export function getPool() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = buildPool();
  }
  return globalThis[GLOBAL_KEY];
}

/**
 * Execute a parameterized query and return rows.  Wraps a connection
 * acquisition + query + release in a single function.
 *
 * @param {string} sql
 * @param {Array<unknown>} [params]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function query(sql, params = []) {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      'DATABASE_URL_READER not configured — see bot repo migration 025'
    );
  }
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Run multiple queries in parallel.  Each query is independent;
 * failures on one don't cancel the others (Promise.allSettled).
 * Used by the composite /api/dashboard endpoint to fire all 9 MV
 * reads simultaneously.
 *
 * @param {Record<string, {sql: string, params?: Array<unknown>}>} queries
 * @returns {Promise<Record<string, {ok: true, rows: Array<Record<string, unknown>>} | {ok: false, error: string}>>}
 */
export async function queryMany(queries) {
  const entries = Object.entries(queries);
  const settled = await Promise.allSettled(
    entries.map(([, { sql, params }]) => query(sql, params))
  );
  const out = {};
  for (let i = 0; i < entries.length; i++) {
    const [name] = entries[i];
    const r = settled[i];
    if (r.status === 'fulfilled') {
      out[name] = { ok: true, rows: r.value };
    } else {
      out[name] = {
        ok: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    }
  }
  return out;
}
