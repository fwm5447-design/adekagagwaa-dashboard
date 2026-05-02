/**
 * middleware.js — Next.js Edge middleware for route protection.
 *
 * Runs on every request matched by `config.matcher` BEFORE the route
 * handler.  Verifies the session cookie; redirects unauthenticated
 * requests to /login (for page routes) or returns 401 (for API
 * routes).
 *
 * Why Edge: middleware runs at the edge before the route handler
 * spins up.  Auth check is sub-millisecond and avoids cold-starting
 * a Node serverless function just to return a redirect.  jose is
 * Edge-compatible (Web Crypto under the hood).
 *
 * Matched routes:
 *   /            — main dashboard
 *   /api/dashboard/* — all analytics endpoints
 *   /login        — explicitly EXEMPTED (would loop)
 *   /api/auth/*   — explicitly EXEMPTED (login/logout themselves)
 *   /_next/*      — Next.js internals, exempted by config.matcher
 *   /favicon.ico  — exempted
 *
 * Unauthenticated handling:
 *   /api/* paths return 401 JSON.  The JSX detects 401 and triggers
 *   a redirect to /login client-side.
 *   Page paths get a 307 redirect to /login with ?from=<original
 *   path> so post-login lands the user where they tried to go.
 */

import { NextResponse } from 'next/server';
import {
  getSessionCookie,
  verifySessionToken,
} from './lib/auth.js';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Verify session cookie.
  const token = getSessionCookie(request);
  const session = await verifySessionToken(token);

  if (session) {
    // Authenticated.  Pass through.
    return NextResponse.next();
  }

  // Unauthenticated.  API paths get 401, pages redirect to /login.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match all routes EXCEPT:
  //   /login              — the login page itself
  //   /api/auth/*         — login/logout endpoints
  //   /_next/static/*     — Next.js bundled assets
  //   /_next/image/*      — Next.js image optimizer
  //   /favicon.ico        — site icon
  //   /public/*           — public assets
  //
  // The negative-lookahead pattern is the documented Next.js way to
  // exclude paths from middleware.
  matcher: [
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
