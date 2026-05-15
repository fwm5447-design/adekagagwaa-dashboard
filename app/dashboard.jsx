'use client';

/**
 * app/dashboard.jsx — Dashboard orchestrator.
 *
 * Replaces the 2026-04 monolithic single-file dashboard with a thin
 * orchestrator that fetches /api/dashboard once on mount + every 60s
 * thereafter, and distributes sections.* into the section components
 * that live in components/sections/.
 *
 * Auth: middleware.js gates every /api/dashboard request via the
 * HTTP-only signed JWT cookie.  We send `credentials: 'include'` so
 * the cookie travels.  401 means session expired — we redirect to
 * /login so the user can re-auth.
 *
 * Section composition (top → bottom):
 *   0.  Bankroll             — top-of-page P&L tracker
 *   1.  WeatherMap           — geographic surface for the 20 markets
 *   2.  Oracle               — calibration deciles
 *   3.  CalibrationPipeline  — 4-stage calibration story (sources → EMOS
 *                              → isotonic → station biases).  Replaced
 *                              TributaryEnsemble + Vigil 2026-05-15.
 *   4.  DecisionsRendered    — signal funnel
 *   5.  EdgeAndAttribution   — realized P&L + closing-line capture +
 *                              attribution pipeline (4 tiers).  Replaced
 *                              RealizedEdge + ClosingLineCoverage 2026-05-15.
 *   6.  DataCompleteness     — data-gap monitor
 *   7.  OperationalPulse     — API health
 *   8.  TradeLedger          — trade history (bottom — densest)
 *
 * Each section component contracts on either:
 *   * `rows` (most sections — flat array of MV rows)
 *   * `data` (Vigil, RealizedEdge, WeatherMap, Bankroll — structured)
 * plus a `freshness` timestamp.  See lib/queries.js SECTION_QUERIES
 * for the slug → component mapping.
 */

import { useEffect, useState } from 'react';

// Section components — paths use the @/* alias from jsconfig.json
// pointing at the project root.
import Bankroll            from '@/components/sections/Bankroll';
import WeatherMap          from '@/components/sections/WeatherMap';
import Oracle              from '@/components/sections/Oracle';
import CalibrationPipeline from '@/components/sections/CalibrationPipeline';
import DecisionsRendered   from '@/components/sections/DecisionsRendered';
import EdgeAndAttribution  from '@/components/sections/EdgeAndAttribution';
import DataCompleteness    from '@/components/sections/DataCompleteness';
import OperationalPulse    from '@/components/sections/OperationalPulse';
import TradeLedger         from '@/components/sections/TradeLedger';


// ─── Data-fetching hook ─────────────────────────────────────────
function useDashboardPayload() {
  const [payload,   setPayload]   = useState(null);
  const [error,     setError]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch('/api/dashboard', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (res.status === 401) {
          if (typeof window !== 'undefined') {
            const here = encodeURIComponent(window.location.pathname);
            window.location.href = `/login?from=${here}`;
          }
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setPayload(json);
        setError(null);
        setLastFetch(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    tick();
    const id = setInterval(tick, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { payload, error, loading, lastFetch };
}


// ─── Loading / error states ─────────────────────────────────────
function SplashScreen({ kind, message }) {
  return (
    <div style={S.splash}>
      <div style={S.splashInner}>
        <div className="eyebrow" style={{ color: 'var(--cloud-mute)', marginBottom: 8 }}>
          {kind}
        </div>
        <div style={S.splashTitle}>Adekagagwaa</div>
        <div style={S.splashSub}>{message}</div>
      </div>
    </div>
  );
}


// ─── Main orchestrator ──────────────────────────────────────────
export default function Dashboard() {
  const { payload, error, loading, lastFetch } = useDashboardPayload();

  if (loading && !payload) {
    return <SplashScreen kind="Connecting" message="Lord of the Weather" />;
  }

  if (!payload) {
    return (
      <SplashScreen
        kind="Stream error"
        message={error ? `${error} — retrying every 60s` : 'awaiting /api/dashboard'}
      />
    );
  }

  const sections = payload.sections || {};
  const meta     = payload.meta     || {};
  const fresh    = (slug) => meta?.freshness?.[slug];

  const mapMarkets    = extractLiveMarkets(payload);
  const mapThresholds = extractThresholds(payload);

  return (
    <div style={S.page}>
      <Header
        generatedAt={payload.generated_at}
        lastFetch={lastFetch}
        error={error}
        v1Error={payload?.v1?.error}
      />

      <div style={S.sectionStack}>

        {/* 0. Bankroll — headline P&L tracker (top of stack) */}
        <Bankroll
          data={{
            summary: (sections.bankroll_summary && sections.bankroll_summary[0]) || null,
            curve:    sections.bankroll_curve || [],
          }}
          freshness={fresh('bankroll_summary')}
        />

        {/* 1. Geographic anchor */}
        <WeatherMap
          data={{
            forecasts:  sections.map || [],
            markets:    mapMarkets,
            thresholds: mapThresholds,
          }}
          freshness={fresh('map')}
        />

        {/* 2. Model honesty (calibration deciles) */}
        <Oracle
          rows={sections.calibration || []}
          freshness={fresh('calibration')}
        />

        {/* 3. Four-stage calibration pipeline (sources → EMOS → isotonic → biases) */}
        <CalibrationPipeline
          data={{
            sources:        sections.sources        || [],
            emos:           sections.vigil_emos     || [],
            isotonic:       sections.vigil_isotonic || [],
            station_biases: sections.vigil_biases   || [],
          }}
          freshness={fresh('sources')}
        />

        {/* 4. Decision funnel */}
        <DecisionsRendered
          rows={sections.signals || []}
          freshness={fresh('signals')}
        />

        {/* 5. Realized P&L + closing-line capture + attribution pipeline */}
        <EdgeAndAttribution
          data={{
            realized_summary: sections.realized_summary || [],
            coverage:         sections.coverage         || [],
            pipeline_counts:  (sections.pipeline_counts && sections.pipeline_counts[0]) || null,
            attribution:      sections.attribution      || [],
          }}
          freshness={fresh('attribution')}
        />

        {/* 6-7. Data + ops health */}
        <DataCompleteness
          rows={sections.completeness || []}
          freshness={fresh('completeness')}
        />
        <OperationalPulse
          rows={sections.health || []}
          freshness={fresh('health')}
        />

        {/* 10. Trade ledger — densest, bottom */}
        <TradeLedger
          rows={sections.trades || []}
          freshness={fresh('trades')}
        />
      </div>

      <Footer payload={payload} />
    </div>
  );
}


// ─── Header ─────────────────────────────────────────────────────
function Header({ generatedAt, lastFetch, error, v1Error }) {
  return (
    <header style={S.header}>
      <div>
        <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
          Adekagagwaa
        </div>
        <h1 style={S.headerTitle}>Lord of the Weather</h1>
      </div>

      <div style={S.headerMeta}>
        <div style={S.headerMetaRow}>
          <span style={S.statusDot(error ? 'error' : 'ok')} />
          <span className="numeric">
            {error ? 'stream error' : 'live'}
          </span>
        </div>
        <div className="numeric" style={S.headerTime}>
          {generatedAt ? new Date(generatedAt).toLocaleTimeString() : '—'}
        </div>
        {error && (
          <div style={S.errorChip}>{error}</div>
        )}
        {v1Error && !error && (
          <div style={S.warnChip}>v1: {v1Error}</div>
        )}
      </div>
    </header>
  );
}


// ─── Footer ─────────────────────────────────────────────────────
function Footer({ payload }) {
  const errors = payload?.meta?.analytics_errors || {};
  const errorEntries = Object.entries(errors);
  return (
    <footer style={S.footer}>
      <div className="numeric" style={S.footerLine}>
        schema v{payload.schema_version} · generated{' '}
        {payload.generated_at
          ? new Date(payload.generated_at).toLocaleString()
          : '—'}
        {' · '}
        elapsed {payload?.meta?.elapsed_ms ?? '—'} ms
      </div>
      {errorEntries.length > 0 && (
        <div style={S.footerErrors}>
          <span className="eyebrow" style={{ color: 'var(--storm-violet)' }}>
            section errors
          </span>
          {errorEntries.map(([k, v]) => (
            <code key={k} style={S.footerErrorCode}>{k}: {v}</code>
          ))}
        </div>
      )}
    </footer>
  );
}


// ─── Live-market extraction helpers ─────────────────────────────
function extractLiveMarkets(payload) {
  const v1 = payload?.v1?.payload;
  if (!v1) return null;

  const positions = v1.open_positions || v1.positions || null;
  if (!Array.isArray(positions) || positions.length === 0) return null;

  const out = {};
  for (const p of positions) {
    const city = p.city;
    if (!city) continue;
    const mt = String(p.market_type || 'high').toLowerCase();
    out[city] ??= {};
    out[city][mt] = {
      yes_bid:   p.market_yes_bid != null ? Number(p.market_yes_bid) : null,
      yes_ask:   p.market_yes_ask != null ? Number(p.market_yes_ask) : null,
      threshold: p.threshold_low ?? p.threshold_high ?? p.threshold ?? null,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

function extractThresholds(payload) {
  const markets = extractLiveMarkets(payload);
  if (!markets) return null;
  const out = {};
  for (const [city, mts] of Object.entries(markets)) {
    out[city] = {};
    for (const [mt, m] of Object.entries(mts)) {
      out[city][mt] = m?.threshold ?? null;
    }
  }
  return out;
}


// ─── Styles ─────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: 'var(--ink-deep, #0a0e14)',
    color: 'var(--cloud-pearl, #f5f5f0)',
    fontFamily: 'var(--font-body, "JetBrains Mono", monospace)',
  },

  splash: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--ink-deep, #0a0e14)',
    color: 'var(--cloud-pearl, #f5f5f0)',
  },
  splashInner: {
    textAlign: 'center',
    fontFamily: 'var(--font-body, "JetBrains Mono", monospace)',
  },
  splashTitle: {
    fontFamily: 'var(--font-display, Fraunces, serif)',
    fontSize: 36,
    letterSpacing: '-0.01em',
    color: 'var(--cloud-pearl)',
    marginBottom: 6,
  },
  splashSub: {
    fontStyle: 'italic',
    fontFamily: 'var(--font-display, Fraunces, serif)',
    color: 'var(--cloud-mute)',
    fontSize: 12,
  },

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    padding: '32px 32px 24px',
    borderBottom: '1px solid var(--rule-faint)',
  },
  headerTitle: {
    fontFamily: 'var(--font-display, Fraunces, serif)',
    fontStyle: 'italic',
    fontSize: 32,
    letterSpacing: '-0.01em',
    color: 'var(--cloud-pearl)',
    margin: 0,
    fontWeight: 400,
  },
  headerMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
  },
  headerMetaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--cloud-haze)',
  },
  headerTime: {
    fontSize: 11,
    color: 'var(--cloud-mute)',
  },
  statusDot: (state) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: state === 'ok' ? 'var(--dawn-gold, #d4a93c)' : 'var(--storm-violet, #7e4fa8)',
    boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 18%, transparent)',
  }),
  errorChip: {
    fontSize: 11,
    color: 'var(--storm-violet)',
    background: 'color-mix(in srgb, var(--storm-violet) 12%, transparent)',
    padding: '2px 8px',
    borderRadius: 999,
    fontFamily: 'var(--font-mono)',
  },
  warnChip: {
    fontSize: 11,
    color: 'var(--sky-azure)',
    background: 'color-mix(in srgb, var(--sky-azure) 12%, transparent)',
    padding: '2px 8px',
    borderRadius: 999,
    fontFamily: 'var(--font-mono)',
  },

  sectionStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 32,
    padding: '32px',
    maxWidth: 1400,
    margin: '0 auto',
  },

  footer: {
    padding: '24px 32px 32px',
    borderTop: '1px solid var(--rule-faint)',
    fontSize: 10,
    color: 'var(--cloud-mute)',
  },
  footerLine: {
    fontSize: 10,
  },
  footerErrors: {
    marginTop: 8,
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  footerErrorCode: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    background: 'color-mix(in srgb, var(--storm-violet) 8%, transparent)',
    color: 'var(--cloud-haze)',
    padding: '2px 8px',
    borderRadius: 3,
  },
};
