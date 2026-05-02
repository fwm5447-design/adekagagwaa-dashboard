/**
 * lib/auth.js — server-side cookie auth using jose (JWT).
 *
 * Pattern:
 *   POST /api/auth/login  body: { password }  →  HTTP-only cookie set on success
 *   POST /api/auth/logout                     →  HTTP-only cookie cleared
 *   middleware.js verifies the cookie on every protected route
 *
 * Why HTTP-only cookies, not Bearer tokens in localStorage:
 * - Tokens in localStorage are visible to any script on the page (XSS).
 * - HTTP-only cookies can't be read by JS at all.
 * - SameSite=Strict prevents CSRF on auth-state changes.
 * - The JSX never sees the token; it just checks "am I authenticated?"
 *   by checking whether a protected fetch returned 401.
 *
 * Why jose (not jsonwebtoken or next-auth):
 * - jose is Edge-runtime compatible.  Next.js middleware runs on Edge
 *   so jose's Web Crypto-based implementation is the right choice.
 *   jsonwebtoken depends on Node crypto and breaks in middleware.
 * - jose is small, audited, RFC-compliant.
 * - next-auth is overkill for a single-password personal dashboard.
 *
 * Token shape:
 *   { sub: 'dashboard-user', iat, exp }
 *   exp = iat + 7 days.  Long enough that you don't re-login every
 *   day on your iPhone home-screen icon; short enough that a stolen
 *   cookie has finite damage potential.
 */

import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'adekagagwaa_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const ALG = 'HS256';

function getSecretKey() {
  const secret = process.env.DASHBOARD_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'DASHBOARD_JWT_SECRET not configured.  Generate with: ' +
      'python3 -c "import secrets; print(secrets.token_urlsafe(48))"'
    );
  }
  // jose expects a Uint8Array key for HMAC.
  return new TextEncoder().encode(secret);
}

/**
 * Issue a session JWT.  Returns the cookie value string (the JWT
 * itself; the route handler wraps it in a Set-Cookie header).
 */
export async function issueSessionToken() {
  const secretKey = getSecretKey();
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject('dashboard-user')
    .setIssuedAt(now)
    .setExpirationTime(now + COOKIE_MAX_AGE)
    .sign(secretKey);
}

/**
 * Verify a JWT string.  Returns the payload on success, null on any
 * failure (expired, malformed, wrong signature, missing secret).
 *
 * Failure logs at debug level only — auth failure paths are
 * adversarial and we don't want to flood logs.
 */
export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [ALG],
    });
    return payload;
  } catch (_e) {
    return null;
  }
}

/**
 * Validate a login attempt.  Returns true on success, false otherwise.
 * Constant-time comparison to prevent timing oracle.
 *
 * The "site password" is a single shared secret, not a username/
 * password matrix.  This is a personal dashboard; per-user accounts
 * are out of scope.
 */
export async function checkSitePassword(submitted) {
  const expected = process.env.DASHBOARD_SITE_PASSWORD;
  if (!expected) {
    // Misconfiguration: if no password is set, REFUSE all logins
    // rather than letting an empty string through.
    return false;
  }
  if (typeof submitted !== 'string' || submitted.length === 0) {
    return false;
  }
  // Constant-time string compare.  Web Crypto's timingSafeEqual would
  // require equal-length buffers; we pad both to a fixed length.
  const a = new TextEncoder().encode(submitted);
  const b = new TextEncoder().encode(expected);
  const len = Math.max(a.length, b.length, 64);
  const aBuf = new Uint8Array(len);
  const bBuf = new Uint8Array(len);
  aBuf.set(a);
  bBuf.set(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= aBuf[i] ^ bBuf[i];
  }
  return diff === 0;
}

/**
 * Build the Set-Cookie header value for issuing the session.
 */
export function sessionCookieHeader(token) {
  // Production: Secure (HTTPS only), HttpOnly (no JS access),
  // SameSite=Strict (no cross-site sends).
  // Path=/ so middleware matches all routes.
  return [
    `${COOKIE_NAME}=${token}`,
    `Path=/`,
    `Max-Age=${COOKIE_MAX_AGE}`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
  ].join('; ');
}

/**
 * Build the Set-Cookie header value for clearing the session.
 */
export function clearSessionCookieHeader() {
  return [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `Max-Age=0`,
    `HttpOnly`,
    `Secure`,
    `SameSite=Strict`,
  ].join('; ');
}

/**
 * Read the session cookie from a Next.js request.  Works for both
 * Edge middleware (request.cookies.get) and Node route handlers
 * (request.cookies.get returns the same shape on App Router).
 */
export function getSessionCookie(request) {
  const cookie = request.cookies?.get?.(COOKIE_NAME);
  if (!cookie) return null;
  // request.cookies.get returns { name, value } in App Router.
  return typeof cookie === 'string' ? cookie : cookie.value;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
