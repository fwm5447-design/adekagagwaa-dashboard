/**
 * app/api/auth/login/route.js — POST /api/auth/login
 *
 * Request:  { password: string }
 * Response: 204 + Set-Cookie on success
 *           401 on bad password (with constant-time guarantee from
 *               checkSitePassword — no timing oracle)
 *           400 on malformed body
 *
 * Rate limiting is intentionally NOT implemented at this layer.  The
 * Vercel project's WAF rules + the constant-time password comparison
 * + the JWT-based session (no DB lookup per request) together make
 * brute force impractical.  If we later add a per-IP rate limit the
 * cleanest place is Vercel Edge middleware, not here.
 */

import { NextResponse } from 'next/server';
import {
  checkSitePassword,
  issueSessionToken,
  sessionCookieHeader,
} from '../../../../lib/auth.js';

export const runtime = 'nodejs';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'malformed request body' },
      { status: 400 },
    );
  }

  const password = body?.password;
  if (typeof password !== 'string') {
    return NextResponse.json(
      { error: 'password required' },
      { status: 400 },
    );
  }

  const ok = await checkSitePassword(password);
  if (!ok) {
    return NextResponse.json(
      { error: 'invalid credentials' },
      { status: 401 },
    );
  }

  const token = await issueSessionToken();
  const response = new NextResponse(null, { status: 204 });
  response.headers.set('Set-Cookie', sessionCookieHeader(token));
  return response;
}
