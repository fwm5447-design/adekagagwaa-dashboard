'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * Bankroll — top-of-page P&L tracker.
 *
 * The single most important number on the dashboard.  Renders the
 * running equity curve from a configurable tracking epoch, plus
 * five hero tiles for the headline numbers and a thin stat strip
 * for the second-tier metrics.
 *
 * Data contract:
 *   data.summary  — single-row aggregate (the [0] of the query result)
 *   data.curve    — array of settled trades, ordered by settled_at ASC
 *
 * Live readiness:
 *   When trades with mode='live' enter the population, the hero NET
 *   tile splits into stacked PAPER / LIVE numbers and the equity
 *   curve renders two series.  Until then everything renders as
 *   single-series paper.
 *
 * The tracking epoch and starting bankroll are constants in
 * lib/queries.js.  Bumping TRACKING_EPOCH_START and redeploying is
 * the supported reset mechanism.
 */
export default function Bankroll({ data, freshness }) {
  const summary = data?.summary || null;
  const curve   = Array.isArray(data?.curve) ? data.curve : [];

  // ── Derived stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!summary) {
      return {
        starting:     500,
        nav:          500,
        pnlNet:       0,
        pnlGross:     0,
        pnlPaper:     0,
        pnlLive:      0,
        fees:         0,
        roi:          0,
        nSettled:     0,
        nOpen:        0,
        nWon:         0,
        nLost:        0,
        winRate:      null,
        atRisk:       0,
        wagered:      0,
        liveActive:   false,
        epochStart:   null,
      };
    }
    const starting = num(summary.starting_bankroll, 500);
    const pnlNet   = num(summary.total_pnl_net,     0);
    const pnlGross = num(summary.total_pnl_gross,   0);
    const fees     = num(summary.total_fees,        0);
    const pnlPaper = num(summary.pnl_paper,         0);
    const pnlLive  = num(summary.pnl_live,          0);
    const nSettled = num(summary.n_settled,         0);
    const nOpen    = num(summary.n_open,            0);
    const nWon     = num(summary.n_won,             0);
    const nLost    = num(summary.n_lost,            0);
    const wagered  = num(summary.total_size_settled, 0);
    const atRisk   = num(summary.total_size_open,   0);
    const decisive = nWon + nLost;
    const winRate  = decisive > 0 ? nWon / decisive : null;
    const nav      = starting + pnlNet;
    const roi      = starting > 0 ? pnlNet / starting : 0;
    const liveActive = num(summary.n_live, 0) > 0;

    return {
      starting, nav, pnlNet, pnlGross, pnlPaper, pnlLive, fees,
      roi, nSettled, nOpen, nWon, nLost, winRate, atRisk, wagered,
      liveActive,
      epochStart: summary.tracking_epoch_start,
    };
  }, [summary]);

  // ── Equity-curve series ────────────────────────────────────────
  // Postgres returned the curve sorted ASC by settled_at, so we just
  // walk it once accumulating cumulative P&L per mode.
  const chartData = useMemo(() => {
    const out = [];
    let cumPaper = 0;
    let cumLive  = 0;
    out.push({
      ts:        stats.epochStart ? Date.parse(stats.epochStart) : Date.now() - 1,
      navTotal:  stats.starting,
      navPaper:  stats.starting,
      navLive:   stats.starting,
    });
    for (const r of curve) {
      const pnl = num(r.pnl, 0);
      if (r.mode === 'live') cumLive += pnl;
      else                   cumPaper += pnl;
      out.push({
        ts:       Date.parse(r.settled_at),
        navTotal: stats.starting + cumPaper + cumLive,
        navPaper: stats.starting + cumPaper,
        navLive:  stats.starting + cumLive,
      });
    }
    return out;
  }, [curve, stats.starting, stats.epochStart]);

  const yDomain = useMemo(() => {
    if (chartData.length <= 1) return [stats.starting * 0.9, stats.starting * 1.1];
    const navs = chartData.map((d) => d.navTotal);
    const lo = Math.min(...navs, stats.starting);
    const hi = Math.max(...navs, stats.starting);
    const pad = Math.max((hi - lo) * 0.08, stats.starting * 0.02);
    return [lo - pad, hi + pad];
  }, [chartData, stats.starting]);

  return (
    <SectionFrame
      id="bankroll"
      invocation="Bankroll"
      title="Bankroll"
      subtitle={
        stats.epochStart
          ? `Tracking from ${fmtDate(stats.epochStart)}.  Starting bankroll $${fmtMoney(stats.starting)}.`
          : 'Tracking from deployment.'
      }
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {/* ── Hero tiles ── */}
      <div style={S.heroGrid}>
        <HeroTile
          label="net P&L"
          value={fmtSignedMoney(stats.pnlNet)}
          tone={stats.pnlNet > 0 ? 'positive' : stats.pnlNet < 0 ? 'negative' : 'neutral'}
          sub={
            stats.liveActive
              ? `paper ${fmtSignedMoney(stats.pnlPaper)} · live ${fmtSignedMoney(stats.pnlLive)}`
              : 'paper only · live mode dormant'
          }
          big
        />
        <HeroTile
          label="NAV"
          value={`$${fmtMoney(stats.nav)}`}
          tone={stats.nav >= stats.starting ? 'positive' : 'negative'}
          sub={`from $${fmtMoney(stats.starting)}`}
        />
        <HeroTile
          label="ROI"
          value={fmtPct(stats.roi)}
          tone={stats.roi > 0 ? 'positive' : stats.roi < 0 ? 'negative' : 'neutral'}
          sub="net of fees"
        />
        <HeroTile
          label="win rate"
          value={stats.winRate == null ? '—' : fmtPct(stats.winRate)}
          tone="neutral"
          sub={`${fmtInt(stats.nWon)} W · ${fmtInt(stats.nLost)} L`}
        />
        <HeroTile
          label="at risk"
          value={`$${fmtMoney(stats.atRisk)}`}
          tone="neutral"
          sub={`${fmtInt(stats.nOpen)} open`}
        />
      </div>

      {/* ── Equity curve ── */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)', color: 'var(--cloud-mute)' }}>
          equity curve · NAV by settlement time
        </div>
        {chartData.length <= 1 ? (
          <div style={S.empty}>
            <div style={S.emptyTitle}>Awaiting first settlement</div>
            <div style={S.emptySub}>
              Tracking began {stats.epochStart ? fmtDate(stats.epochStart) : 'recently'}.
              The curve will draw as trades settle.
              {stats.nOpen > 0 && (
                <> {fmtInt(stats.nOpen)} {stats.nOpen === 1 ? 'trade is' : 'trades are'} open.</>
              )}
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="bankrollGoldGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--dawn-gold)"   stopOpacity={0.55} />
                  <stop offset="100%" stopColor="var(--dawn-gold)"   stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="bankrollVioletGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--storm-violet)" stopOpacity={0.04} />
                  <stop offset="100%" stopColor="var(--storm-violet)" stopOpacity={0.55} />
                </linearGradient>
                <linearGradient id="bankrollLiveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="var(--sky-azure)"   stopOpacity={0.45} />
                  <stop offset="100%" stopColor="var(--sky-azure)"   stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
                stroke="var(--rule-mid)"
                tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
                stroke="var(--rule-mid)"
                tickFormatter={(v) => `$${Math.round(v)}`}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--ink-deep)',
                  border: '1px solid var(--rule-mid)',
                  borderRadius: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                }}
                labelFormatter={(v) => new Date(v).toLocaleString()}
                formatter={(v, name) => [`$${fmtMoney(v)}`, name]}
              />
              <ReferenceLine
                y={stats.starting}
                stroke="var(--cloud-mute)"
                strokeDasharray="3 3"
                label={{
                  value: `start $${fmtMoney(stats.starting)}`,
                  position: 'right',
                  style: { fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--cloud-mute)' },
                }}
              />
              {stats.liveActive ? (
                <>
                  <Area
                    type="monotone"
                    dataKey="navPaper"
                    name="paper"
                    stroke="var(--dawn-gold)"
                    fill="url(#bankrollGoldGrad)"
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="navLive"
                    name="live"
                    stroke="var(--sky-azure)"
                    fill="url(#bankrollLiveGrad)"
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                  <Legend
                    wrapperStyle={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      paddingTop: 4,
                    }}
                  />
                </>
              ) : (
                <Area
                  type="monotone"
                  dataKey="navTotal"
                  name="NAV"
                  stroke={stats.pnlNet >= 0 ? 'var(--dawn-gold)' : 'var(--storm-violet)'}
                  fill={stats.pnlNet >= 0 ? 'url(#bankrollGoldGrad)' : 'url(#bankrollVioletGrad)'}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Stat strip ── */}
      <div style={S.statStrip}>
        <Stat label="settled" value={fmtInt(stats.nSettled)} />
        <Stat label="open"    value={fmtInt(stats.nOpen)} />
        <Stat label="wagered" value={`$${fmtMoney(stats.wagered)}`} />
        <Stat label="fees"    value={fmtSignedMoney(-Math.abs(stats.fees))} negative={stats.fees > 0} />
        <Stat label="gross"   value={fmtSignedMoney(stats.pnlGross)} positive={stats.pnlGross > 0} negative={stats.pnlGross < 0} />
        <Stat label="W·L"     value={`${fmtInt(stats.nWon)}·${fmtInt(stats.nLost)}`} />
        <Stat label="mode"    value={stats.liveActive ? 'paper + live' : 'paper'} sub />
      </div>

      <div style={S.footnote}>
        NAV = starting bankroll + cumulative net P&L on settled trades since the tracking epoch.
        Open positions are <em>at risk</em> but not yet realized — they roll into the curve as they settle.
      </div>
    </SectionFrame>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────

function HeroTile({ label, value, sub, tone = 'neutral', big = false }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={{ ...S.heroTile, gridColumn: big ? 'span 2' : 'span 1' }}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="display-numeric" style={{
        ...S.heroValue,
        color: valueColor,
        fontSize: big ? 'var(--type-jumbo, 44px)' : 'var(--type-display)',
      }}>
        {value}
      </div>
      {sub && <div style={S.heroSub}>{sub}</div>}
    </div>
  );
}

function Stat({ label, value, sub = false, positive = false, negative = false }) {
  const color =
    positive ? 'var(--dawn-gold)'
    : negative ? 'var(--storm-violet)'
    : sub ? 'var(--cloud-mute)'
    : 'var(--cloud-haze)';
  return (
    <div style={S.stat}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)', fontSize: 9 }}>{label}</div>
      <div className="numeric" style={{ ...S.statValue, color }}>{value}</div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function num(v, fallback = 0) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtSignedMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '$0.00';
  const sign = n > 0 ? '+' : '−';
  return `${sign}$${fmtMoney(Math.abs(n))}`;
}
function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v) * 100;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

// ── Styles ────────────────────────────────────────────────────────

const S = {
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-5)',
  },
  heroTile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    minHeight: 110,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  heroValue: {
    lineHeight: 1.0,
    marginTop: 'var(--space-2)',
    marginBottom: 'var(--space-1)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },
  heroSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
  },
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  empty: {
    height: 320,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--cloud-mute)',
    textAlign: 'center',
  },
  emptyTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-h3)',
    color: 'var(--cloud-haze)',
    marginBottom: 'var(--space-2)',
  },
  emptySub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    maxWidth: '46ch',
    lineHeight: 1.6,
  },
  statStrip: {
    display: 'flex',
    gap: 'var(--space-5)',
    flexWrap: 'wrap',
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 80,
  },
  statValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-body)',
    fontWeight: 500,
  },
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '70ch',
    lineHeight: 1.6,
  },
};
