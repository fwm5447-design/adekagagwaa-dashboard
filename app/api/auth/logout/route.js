/**
 * app/api/auth/logout/route.js — POST /api/auth/logout
 *
 * Clears the session cookie unconditionally.  No body, no params.
 * Always returns 204 (idempotent — calling logout when not logged
 * in is a no-op success).
 */

import { NextResponse } from 'next/server';
import { clearSessionCookieHeader } from '../../../../lib/auth.js';

export const runtime = 'nodejs';

export async function POST() {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set('Set-Cookie', clearSessionCookieHeader());
  return response;
}
