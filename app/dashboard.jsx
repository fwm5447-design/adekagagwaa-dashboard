'use client';

/**
 * app/dashboard.jsx — Adekagagwaa, Lord of the Weather (Phase 6 dashboard handler)
 *
 * The orchestrator.  Replaces the Railway-polling v1 dashboard with a
 * Vercel-route-handler consumer that reads:
 *
 *   - v1 payload (pass-through Railway state) → live operational widgets
 *   - v2 sections (Phase 6 materialized views) → analytical insight panels
 *
 * Both layers render simultaneously during cutover.  The v1 widgets are
 * the live-state surface (running NAV, scan mode, recent signals); the
 * v2 sections are the data layer telescope (calibration, source skill,
 * counterfactual P&L, attribution, burn-in vigil, completeness, pulse,
 * trade ledger).
 *
 * Lifecycle:
 *   1. On mount → fetch /api/dashboard.
 *   2. If 401 → redirect to /login?from=current-path.
 *   3. On success → render with the data; poll every 60s.
 *   4. On error → keep last-known-good payload; show stream error banner.
 *   5. Logout button → POST /api/auth/logout, redirect to /login.
 *
 * Visual frame:
 *   - Fixed left rail: section anchors with per-section freshness lamps.
 *   - Main content: status band → hero KPIs → P&L curve → 9 sections.
 *   - Atmospheric parallax cumulus background drifts on a 60s loop.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

import LeftRail from '../components/layout/LeftRail';
import SectionFrame from '../components/layout/SectionFrame';
import StatusPill from '../components/primitives/StatusPill';
import FreshnessLamp from '../components/primitives/FreshnessLamp';

import Oracle               from '../components/sections/Oracle';
import TributaryEnsemble    from '../components/sections/TributaryEnsemble';
import DecisionsRendered    from '../components/sections/DecisionsRendered';
import RealizedEdge         from '../components/sections/RealizedEdge';
import Vigil                from '../components/sections/Vigil';
import ClosingLineCoverage  from '../components/sections/ClosingLineCoverage';
import DataCompleteness     from '../components/sections/DataCompleteness';
import OperationalPulse     from '../components/sections/OperationalPulse';
import TradeLedger          from '../components/sections/TradeLedger';

const POLL_INTERVAL_MS = 60_000;

// Section catalog used by both the LeftRail and the body — single source of truth.
const SECTIONS = [
  { id: 'oracle',       label: 'The Oracle',          dataKey: 'calibration' },
  { id: 'tributary',    label: 'Tributary Ensemble',  dataKey: 'sources' },
  { id: 'decisions',    label: 'Decisions',           dataKey: 'signals' },
  { id: 'edge',         label: 'Realized Edge',       dataKey: 'attribution' },
  { id: 'vigil',        label: 'Vigil',               dataKey: 'vigil' },
  { id: 'coverage',     label: 'Closing Line',        dataKey: 'coverage' },
  { id: 'completeness', label: 'Data Completeness',   dataKey: 'completeness' },
  { id: 'pulse',        label: 'Operational Pulse',   dataKey: 'health' },
  { id: 'ledger',       label: 'Trade Ledger',        dataKey: 'trades' },
];

export default function Dashboard() {
  const [data, setData]       = useState(null);
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        const from = encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/');
        window.location.replace(`/login?from=${from}`);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
      // Keep stale data on error.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  // IntersectionObserver to track which section is in view.
  useEffect(() => {
    if (typeof window === 'undefined' || !data) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveId(e.target.id);
          }
        }
      },
      {
        rootMargin: '-30% 0px -50% 0px',
        threshold: 0,
      },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [data]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Even if the request fails, redirect — the user wants to be out.
    }
    window.location.href = '/login';
  };

  // Compute per-section freshness map for the left rail.
  const freshness = useMemo(() => {
    const out = {};
    if (data?.sections) {
      for (const s of SECTIONS) {
        const sec = data.sections[s.dataKey];
        // Use the first row's _mv_refreshed_at as the section freshness.
        if (Array.isArray(sec) && sec.length > 0 && sec[0]?._mv_refreshed_at) {
          out[s.id] = sec[0]._mv_refreshed_at;
        }
      }
    }
    return out;
  }, [data]);

  // Loading splash.
  if (loading && !data) {
    return (
      <div style={S.splash}>
        <div className="atmosphere-cumulus" aria-hidden />
        <div style={{ position: 'relative', textAlign: 'center', zIndex: 1 }}>
          <div className="inscription" style={{ marginBottom: 'var(--space-3)' }}>
            Adekagagwaa
          </div>
          <div style={S.splashTitle}>Lord of the Weather</div>
          <div className="numeric" style={S.splashSub}>summoning observations…</div>
        </div>
      </div>
    );
  }

  const v1 = data?.v1?.payload ?? null;
  const v1Error = data?.v1?.error ?? null;

  return (
    <div style={S.app}>
      <div className="atmosphere-cumulus" aria-hidden />

      {/* Left navigator rail */}
      <LeftRail
        sections={SECTIONS}
        activeId={activeId}
        freshness={freshness}
        onLogout={handleLogout}
      />

      {/* Main content column */}
      <main style={S.main}>
        {/* Stream error banner */}
        {error && data && (
          <div style={S.errorBanner}>
            <span>⚠ Stream error: {error} — showing last-known state</span>
            <span style={{ color: 'var(--cloud-mute)' }}>
              {data.generated_at ? new Date(data.generated_at).toLocaleTimeString() : ''}
            </span>
          </div>
        )}

        {/* Status band — pulled from v1 pass-through */}
        {v1?.status && <StatusBand status={v1.status} schemaVersion={data.schema_version} v1Error={v1Error} />}

        {/* Hero KPIs from v1 performance */}
        {v1?.performance && <HeroKPIs perf={v1.performance} />}

        {/* P&L curve from v1 */}
        {Array.isArray(v1?.pnl_curve) && v1.pnl_curve.length > 0 && (
          <PnLCurve points={v1.pnl_curve} />
        )}

        {/* The 9 sections */}
        <Oracle              rows={data?.sections?.calibration   ?? []} freshness={freshness.oracle} />
        <TributaryEnsemble   rows={data?.sections?.sources       ?? []} freshness={freshness.tributary} />
        <DecisionsRendered   rows={data?.sections?.signals       ?? []} freshness={freshness.decisions} />
        <RealizedEdge        rows={data?.sections?.attribution   ?? []} freshness={freshness.edge} />
        <Vigil               rows={data?.sections?.vigil         ?? []} freshness={freshness.vigil} />
        <ClosingLineCoverage rows={data?.sections?.coverage      ?? []} freshness={freshness.coverage} />
        <DataCompleteness    rows={data?.sections?.completeness  ?? []} freshness={freshness.completeness} />
        <OperationalPulse    rows={data?.sections?.health        ?? []} freshness={freshness.pulse} />
        <TradeLedger         rows={data?.sections?.trades        ?? []} freshness={freshness.ledger} />

        {/* Footer */}
        <footer style={S.footer}>
          <div className="inscription" style={{ marginBottom: 'var(--space-1)' }}>
            Adekagagwaa
          </div>
          <div style={S.footerBlurb}>
            Lord of the Weather · schema v{data?.schema_version ?? '?'} · last refresh{' '}
            {data?.generated_at ? new Date(data.generated_at).toLocaleString() : '—'}
          </div>
        </footer>
      </main>
    </div>
  );
}

// ── Status band ──────────────────────────────────────────────────────

function StatusBand({ status, schemaVersion, v1Error }) {
  const stateStyle =
    status.errors > 0 ? { color: 'var(--coral-flare)' }
    : status.warnings > 0 ? { color: 'var(--dawn-amber)' }
    : { color: 'var(--dawn-gold)' };
  return (
    <div style={S.statusBand}>
      <div style={S.statusBandLeft}>
        <span style={{ ...S.statusState, ...stateStyle }}>
          {String(status.state || '?').toUpperCase()}
        </span>
        <span className="eyebrow">scan</span>
        <span className="numeric" style={{ color: 'var(--cloud-pearl)' }}>
          {String(status.scan_mode || '?')}
        </span>
        <span className="eyebrow">cycle</span>
        <span className="numeric" style={{ color: 'var(--cloud-pearl)' }}>
          {fmtInt(status.cycles)}
        </span>
        <span className="eyebrow">last cycle</span>
        <span className="numeric" style={{ color: 'var(--cloud-haze)' }}>
          {Number.isFinite(status.last_cycle_seconds) ? `${status.last_cycle_seconds.toFixed(2)}s` : '—'}
        </span>
        <span className="eyebrow">next in</span>
        <span className="numeric" style={{ color: 'var(--cloud-haze)' }}>
          {Number.isFinite(status.next_cycle_in) ? `${Math.round(status.next_cycle_in)}s` : '—'}
        </span>
      </div>
      <div style={S.statusBandRight}>
        {v1Error && (
          <StatusPill value="missing">v1 link down</StatusPill>
        )}
        {status.errors > 0 && (
          <StatusPill value="missing">{status.errors} err</StatusPill>
        )}
        {status.warnings > 0 && (
          <StatusPill value="stale">{status.warnings} warn</StatusPill>
        )}
        <span className="inscription" style={{ color: 'var(--dawn-gold)' }}>
          schema v{schemaVersion ?? '?'}
        </span>
      </div>
    </div>
  );
}

// ── Hero KPIs ────────────────────────────────────────────────────────

function HeroKPIs({ perf }) {
  const pnl = Number(perf.total_pnl);
  const pnlColor = !Number.isFinite(pnl) ? 'var(--cloud-pearl)'
    : pnl > 0 ? 'var(--dawn-gold)'
    : pnl < 0 ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.heroGrid}>
      <HeroTile
        label="net asset value"
        value={fmtDollar(perf.nav_current)}
        sub={`bankroll start · ${fmtDollar(perf.bankroll_start)}`}
        color="var(--cloud-pearl)"
      />
      <HeroTile
        label="total P&L"
        value={fmtSignedDollar(perf.total_pnl)}
        sub={Number.isFinite(perf.roi_pct) ? `ROI · ${perf.roi_pct.toFixed(2)}%` : 'ROI · —'}
        color={pnlColor}
      />
      <HeroTile
        label="win rate"
        value={Number.isFinite(perf.win_rate) ? `${(perf.win_rate * 100).toFixed(1)}%` : '—'}
        sub={`${fmtInt(perf.wins)}-${fmtInt(perf.losses)} · ${fmtInt(perf.decisive)} decisive`}
        color="var(--cloud-pearl)"
      />
      <HeroTile
        label="positions"
        value={fmtInt(perf.open_count)}
        sub={`open · ${fmtInt(perf.settled_count)} settled · ${fmtDollar(perf.wagered_open)} risk`}
        color="var(--cloud-pearl)"
      />
    </div>
  );
}

function HeroTile({ label, value, sub, color }) {
  return (
    <div style={S.heroTile}>
      <div className="inscription" style={{ color: 'var(--dawn-gold)' }}>{label}</div>
      <div className="display-numeric" style={{ ...S.heroValue, color }}>
        {value}
      </div>
      {sub && (
        <div className="numeric" style={S.heroSub}>{sub}</div>
      )}
    </div>
  );
}

// ── P&L curve ─────────────────────────────────────────────────────────

function PnLCurve({ points }) {
  const data = points
    .map((p) => ({ t: p.t, pnl: Number(p.pnl) }))
    .filter((p) => Number.isFinite(p.pnl));
  if (data.length === 0) return null;
  return (
    <SectionFrame
      id="pnl"
      invocation="Cumulative Realized"
      title="Cumulative P&L"
      subtitle="Each settled trade marks a step.  Rising curves mean the threshold is calibrated; falling curves mean the calibration story is incomplete."
    >
      <div style={S.chartCard}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="var(--dawn-gold)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--dawn-gold)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
            <XAxis
              dataKey="t"
              tickFormatter={(t) => {
                try {
                  const d = new Date(t);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                } catch { return t; }
              }}
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
            />
            <YAxis
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ink-deep)',
                border: '1px solid var(--rule-mid)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              formatter={(v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : v)}
              labelFormatter={(t) => {
                try { return new Date(t).toLocaleString(); } catch { return t; }
              }}
            />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="var(--dawn-gold)"
              strokeWidth={2}
              fill="url(#pnlGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionFrame>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtDollar(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSignedDollar(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const num = Number(v);
  const sign = num >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Styles ────────────────────────────────────────────────────────────

const S = {
  app: {
    display: 'flex',
    minHeight: '100vh',
    position: 'relative',
  },
  main: {
    flex: '1 1 auto',
    marginLeft: 'var(--rail-width)',
    padding: 'var(--space-6) var(--space-7)',
    maxWidth: 1280,
    width: '100%',
    position: 'relative',
    zIndex: 1,
  },
  splash: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  splashTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-display)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
    fontStyle: 'italic',
    marginBottom: 'var(--space-3)',
  },
  splashSub: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.04em',
  },
  errorBanner: {
    background: 'rgba(194, 84, 80, 0.10)',
    border: '1px solid rgba(194, 84, 80, 0.35)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-2) var(--space-4)',
    marginBottom: 'var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--coral-flare)',
    display: 'flex',
    justifyContent: 'space-between',
  },
  statusBand: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-4)',
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
  },
  statusBandLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
  },
  statusBandRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
  },
  statusState: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: 'var(--type-large)',
    letterSpacing: '0.04em',
  },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-6)',
  },
  heroTile: {
    background: 'var(--ink-mid)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5)',
    boxShadow: 'var(--shadow-card)',
  },
  heroValue: {
    fontSize: 'var(--type-oracle)',
    lineHeight: 1.0,
    marginTop: 'var(--space-3)',
  },
  heroSub: {
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-2)',
  },
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
  },
  footer: {
    marginTop: 'var(--space-7)',
    paddingTop: 'var(--space-5)',
    borderTop: '1px solid var(--rule-faint)',
    textAlign: 'center',
  },
  footerBlurb: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
  },
};
