/**
 * lib/passthrough.js — fetch the bot's v1 dashboard.json from Railway
 * so the v2 composite payload is a backward-compatible superset.
 *
 * The bot still writes data/dashboard.json every scan cycle and
 * dashboard_server.py still serves it on /dashboard.json with Bearer
 * auth.  Phase 6's audit explicitly preserved this — live-state
 * widgets (open positions, scan_mode, NAV, recent_signals) keep
 * reading their existing keys from the v1 surface during cutover.
 *
 * The Vercel handler fetches /dashboard.json server-side so:
 *   - The Railway Bearer token never reaches the browser.
 *   - The composite v2 payload arrives as a single response, edge-
 *     cached together (rather than the JSX issuing two separate
 *     fetches).
 *   - When Railway is down (which is the failure mode that
 *     motivates Phase 6 in the first place), the v2 keys still ship
 *     and the dashboard renders the analytics surface even with the
 *     v1 surface absent.
 */

const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetch the v1 payload from Railway.  Returns:
 *   { ok: true, payload }
 *   { ok: false, error, status? }
 *
 * Never throws — the composite endpoint depends on this completing
 * one way or the other.
 */
export async function fetchV1Snapshot() {
  const url = process.env.RAILWAY_DASHBOARD_URL;
  const token = process.env.RAILWAY_DASHBOARD_TOKEN;

  if (!url) {
    return {
      ok: false,
      error: 'RAILWAY_DASHBOARD_URL not configured',
      status: null,
    };
  }

  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      // No-cache: we want the latest live state; the v2 outer
      // response is what gets edge-cached.
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `Railway returned HTTP ${res.status}`,
        status: res.status,
      };
    }
    const payload = await res.json();
    return { ok: true, payload };
  } catch (e) {
    return {
      ok: false,
      error: e.name === 'AbortError'
        ? `Railway timeout after ${FETCH_TIMEOUT_MS}ms`
        : (e.message ?? String(e)),
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
