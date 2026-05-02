/**
 * app/api/dashboard/route.js — GET /api/dashboard
 *
 * The composite endpoint.  Single GET fires:
 *   - All 9 analytics MV queries in parallel (queryMany)
 *   - Railway /dashboard.json pass-through in parallel
 * Returns the SCHEMA_VERSION = 2 payload: backward-compat superset of
 * the v1 JSONL shape, with the existing v1 keys nested under .v1 for
 * pass-through clarity, plus 9 new analytics sections at the top
 * level.
 *
 * Cache headers: per audit § D6, edge-cached for 60 seconds with
 * stale-while-revalidate up to 5 minutes.  This caps DB load to
 * roughly 1 hit per minute per Vercel region under steady state.
 *
 * Auth: session cookie required.  Middleware handles the redirect
 * for unauthenticated requests; this handler defends in depth by
 * also rejecting if the cookie is missing.
 */

import { NextResponse } from 'next/server';
import { queryMany } from '../../../lib/db.js';
import { buildCompositeQueries } from '../../../lib/queries.js';
import { fetchV1Snapshot } from '../../../lib/passthrough.js';
import {
  getSessionCookie,
  verifySessionToken,
} from '../../../lib/auth.js';

export const runtime = 'nodejs';

const SCHEMA_VERSION = 2;

export async function GET(request) {
  // Defense in depth: middleware should have redirected unauthenticated
  // requests, but the handler verifies the cookie anyway.
  const token = getSessionCookie(request);
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    );
  }

  const startTime = Date.now();

  // Fire MV reads + Railway fetch in parallel.  Promise.allSettled
  // wraps queryMany so a failure in one doesn't kill the other.
  const [analyticsResult, v1Result] = await Promise.allSettled([
    queryMany(buildCompositeQueries()),
    fetchV1Snapshot(),
  ]);

  const elapsedMs = Date.now() - startTime;

  // Unpack analytics.
  const analytics = analyticsResult.status === 'fulfilled'
    ? analyticsResult.value
    : null;
  const analyticsErrors = {};
  const sections = {};
  if (analytics) {
    for (const [name, result] of Object.entries(analytics)) {
      if (result.ok) {
        sections[name] = result.rows;
      } else {
        sections[name] = [];
        analyticsErrors[name] = result.error;
      }
    }
  } else {
    analyticsErrors._all = analyticsResult.reason instanceof Error
      ? analyticsResult.reason.message
      : String(analyticsResult.reason);
  }

  // Unpack v1.
  let v1Payload = null;
  let v1Error = null;
  if (v1Result.status === 'fulfilled') {
    if (v1Result.value.ok) {
      v1Payload = v1Result.value.payload;
    } else {
      v1Error = v1Result.value.error;
    }
  } else {
    v1Error = v1Result.reason instanceof Error
      ? v1Result.reason.message
      : String(v1Result.reason);
  }

  // Build per-section freshness summary.  The dashboard's left-rail
  // freshness lamps read this — staleness coloring is computed JSX-
  // side from the timestamps.
  const freshness = {};
  for (const [name, rows] of Object.entries(sections)) {
    if (rows.length > 0 && rows[0]._mv_refreshed_at) {
      freshness[name] = rows[0]._mv_refreshed_at;
    } else {
      freshness[name] = null;
    }
  }

  const payload = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),

    // v1 pass-through.  All the keys the existing JSX reads
    // continue to be present nested under .v1.  When v1 fetch
    // failed, v1.payload is null and v1.error carries the reason.
    v1: {
      payload: v1Payload,
      error: v1Error,
    },

    // v2 analytics surfaces.  Each section is an array of MV rows.
    // _mv_refreshed_at on row 0 is the freshness timestamp.
    sections,

    // Meta: per-section freshness, errors, response timing.
    meta: {
      freshness,
      analytics_errors: analyticsErrors,
      elapsed_ms: elapsedMs,
    },
  };

  const response = NextResponse.json(payload);

  // Edge cache: 60s fresh, 5min stale-while-revalidate.  This is the
  // audit § D6 contract.  Tighter than 60s would mean most requests
  // hit the DB; looser than 60s would mean stale data on a heavily-
  // visited dashboard (which yours is not, but the shape matters).
  response.headers.set(
    'Cache-Control',
    'private, max-age=0, s-maxage=60, stale-while-revalidate=300',
  );

  // Defensive: never index a private dashboard.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');

  return response;
}
