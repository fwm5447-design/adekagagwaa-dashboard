/**
 * app/api/dashboard/[section]/route.js — GET /api/dashboard/<section>
 *
 * Single dynamic route handler for per-section endpoints.  The
 * [section] path parameter is one of:
 *   trades, attribution, calibration, sources, signals, health,
 *   coverage, completeness, vigil
 *
 * Each maps to one of the SECTION_QUERIES entries in lib/queries.js.
 *
 * Why a dynamic route, not 9 separate route files: single source of
 * truth, single auth check, single error-shape contract.  The cost
 * is one dispatch lookup per request which is sub-microsecond.
 *
 * Query string:
 *   ?limit=N    Optional.  Caps to 1000 server-side regardless.
 *               Only meaningful for queries that accept a limit
 *               (TRADES_RECENT, ATTRIBUTION_RECENT).
 *
 * Cache: same 60s edge cache as the composite route.  A drill-down
 * page polling /api/dashboard/trades every 30s gets one DB hit per
 * minute per region.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db.js';
import {
  getSectionQuery,
  buildParams,
} from '../../../../lib/queries.js';
import {
  getSessionCookie,
  verifySessionToken,
} from '../../../../lib/auth.js';

export const runtime = 'nodejs';

const SCHEMA_VERSION = 2;

export async function GET(request, { params }) {
  // Auth (defense in depth — middleware should have redirected).
  const token = getSessionCookie(request);
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    );
  }

  // Resolve section.  Next 16 makes params async — await before use.
  const { section } = await params;
  const queryDef = getSectionQuery(section);
  if (!queryDef) {
    return NextResponse.json(
      { error: `unknown section '${section}'` },
      { status: 404 },
    );
  }

  // Parse optional limit.
  const url = new URL(request.url);
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

  // Run query.
  const startTime = Date.now();
  let rows;
  try {
    rows = await query(queryDef.sql, buildParams(queryDef, limit));
  } catch (e) {
    return NextResponse.json(
      {
        error: e.message ?? String(e),
        section,
      },
      { status: 500 },
    );
  }
  const elapsedMs = Date.now() - startTime;

  const freshness = rows.length > 0 && rows[0]._mv_refreshed_at
    ? rows[0]._mv_refreshed_at
    : null;

  const payload = {
    schema_version: SCHEMA_VERSION,
    section,
    rows,
    meta: {
      freshness,
      elapsed_ms: elapsedMs,
      n_rows: rows.length,
    },
  };

  const response = NextResponse.json(payload);
  response.headers.set(
    'Cache-Control',
    'private, max-age=0, s-maxage=60, stale-while-revalidate=300',
  );
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
