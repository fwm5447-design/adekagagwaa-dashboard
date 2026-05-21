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
  // Live-Fill v2 row from the live_fill_v2 query.  Null when v2 hasn't
  // been activated yet OR the query returned no rows (= no v2 account
  // seeded).  All downstream renderers treat null as "v2 dormant".
  const v2      = data?.v2 || null;
  const v2Rejects = Array.isArray(data?.v2Rejects) ? data.v2Rejects : [];

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

      {/* ── Live-Fill v2 panel ─────────────────────────────────── */}
      <LiveFillV2Panel v2={v2} rejects={v2Rejects} />
    </SectionFrame>
  );
}

// ── Live-Fill v2 subpanel ─────────────────────────────────────────
//
// Renders the v2 stack's state inside the Bankroll section.  Surfaces:
//   * Account/mode/env header + safety markers
//   * Simulated cash + caps utilization
//   * Trade counts (open / settled)
//   * CLV alpha-test stats (Phase 1 exit criterion 3)
//   * Rejection breakdown over the last 24h
//   * "Last heard from" heartbeat
//
// Renders an "inactive" notice when the v2 query returns no row.

function LiveFillV2Panel({ v2, rejects }) {
  if (!v2) {
    return (
      <div style={V2.frame}>
        <div style={V2.header}>
          <span style={V2.title}>Live-Fill v2</span>
          <span style={V2.muted}>dormant — set V2_ENABLED to activate</span>
        </div>
      </div>
    );
  }

  const cash         = num(v2.cash_cents) / 100;
  const bankrollCfg  = num(v2.bankroll_config_usd);
  const cashDelta    = cash - bankrollCfg;
  const openExp      = num(v2.open_exposure_cents) / 100;
  const restingOrder = num(v2.resting_order_cents) / 100;
  const pnlToday     = num(v2.realized_pnl_today_cents) / 100;
  const nOpen        = num(v2.v2_n_open);
  const nWon         = num(v2.v2_n_won);
  const nLost        = num(v2.v2_n_lost);
  const nSettled     = nWon + nLost + num(v2.v2_n_void);
  const pnlTotal     = num(v2.v2_pnl_total);
  const wageredOpen  = num(v2.v2_wagered_open);
  const wageredSetl  = num(v2.v2_wagered_settled);
  const clvN         = num(v2.v2_clv_n_with_mid);
  const clvAvg       = v2.v2_clv_avg == null ? null : Number(v2.v2_clv_avg);
  const clvPosRate   = clvN > 0 ? num(v2.v2_clv_n_positive) / clvN : null;
  const nRejected    = num(v2.v2_n_rejected_24h);
  const lastEventAt  = v2.v2_last_lifecycle_at;

  // Cap utilization — what % of each cap has been consumed?
  const expCapUsed    = bankrollCfg > 0
    ? openExp / num(v2.max_open_exposure_usd) : 0;
  const dailyLossCap  = num(v2.max_daily_loss_usd);
  const dailyLossUsed = dailyLossCap > 0
    ? Math.max(0, -pnlToday) / dailyLossCap : 0;

  const lowFundHard   = num(v2.low_fund_hard_usd);
  const lowFundFloor  = num(v2.low_fund_floor_usd);
  const cashStatus    =
    cash < lowFundHard  ? 'critical'
    : cash < lowFundFloor ? 'warning'
    : 'healthy';
  const cashStatusColor = {
    healthy:  'var(--dawn-gold)',
    warning:  'var(--cloud-haze)',
    critical: 'var(--storm-violet)',
  }[cashStatus];

  return (
    <div style={V2.frame}>
      <div style={V2.header}>
        <span style={V2.title}>Live-Fill v2</span>
        <span style={V2.subtitle}>
          {v2.account_id} · {v2.fill_mode} · env={v2.environment} · status={v2.account_status}
        </span>
        <span style={V2.heartbeat} title={`last lifecycle event ${lastEventAt}`}>
          {lastEventAt ? `heartbeat ${ago(lastEventAt)}` : 'no events yet'}
        </span>
      </div>

      {/* Row 1: cash + caps */}
      <div style={V2.tileRow}>
        <V2Tile
          label="simulated cash"
          value={`$${fmtMoney(cash)}`}
          sub={
            cashDelta === 0
              ? `from $${fmtMoney(bankrollCfg)}`
              : `${fmtSignedMoney(cashDelta)} from $${fmtMoney(bankrollCfg)}`
          }
          tone={cashStatus === 'healthy' ? 'neutral' : cashStatus === 'warning' ? 'caution' : 'negative'}
          accent={cashStatusColor}
        />
        <V2Tile
          label="open exposure"
          value={`$${fmtMoney(openExp)}`}
          sub={`${fmtPct(expCapUsed)} of $${fmtMoney(num(v2.max_open_exposure_usd))} cap`}
          tone={expCapUsed > 0.9 ? 'caution' : 'neutral'}
        />
        <V2Tile
          label="P&L today"
          value={fmtSignedMoney(pnlToday)}
          sub={`${fmtPct(dailyLossUsed)} of $${fmtMoney(dailyLossCap)} loss cap`}
          tone={pnlToday > 0 ? 'positive' : pnlToday < 0 ? 'caution' : 'neutral'}
        />
        <V2Tile
          label="resting orders"
          value={`$${fmtMoney(restingOrder)}`}
          sub="reserved cash"
          tone="neutral"
        />
      </div>

      {/* Row 2: trades + CLV */}
      <div style={V2.tileRow}>
        <V2Tile
          label="v2 trades"
          value={`${fmtInt(nOpen)} open · ${fmtInt(nSettled)} settled`}
          sub={
            nSettled > 0
              ? `${fmtInt(nWon)}W · ${fmtInt(nLost)}L · ${fmtSignedMoney(pnlTotal)}`
              : 'awaiting settler'
          }
          tone={pnlTotal > 0 ? 'positive' : pnlTotal < 0 ? 'negative' : 'neutral'}
        />
        <V2Tile
          label="v2 wagered"
          value={`$${fmtMoney(wageredOpen + wageredSetl)}`}
          sub={`open $${fmtMoney(wageredOpen)} · settled $${fmtMoney(wageredSetl)}`}
          tone="neutral"
        />
        <V2Tile
          label="CLV alpha"
          value={clvN === 0 ? '—' : fmtSignedMoney(clvAvg ?? 0)}
          sub={
            clvN === 0
              ? 'awaiting close-window captures'
              : `n=${fmtInt(clvN)} · ${fmtPct(clvPosRate ?? 0)} positive`
          }
          tone={clvAvg == null ? 'neutral' : clvAvg > 0 ? 'positive' : 'negative'}
        />
        <V2Tile
          label="rejected 24h"
          value={fmtInt(nRejected)}
          sub={
            nRejected > 0
              ? `${fmtInt(num(v2.v2_reject_reasons))} distinct reasons`
              : 'no rejections'
          }
          tone={nRejected > 100 ? 'caution' : 'neutral'}
        />
      </div>

      {/* Rejection breakdown */}
      {rejects.length > 0 && (
        <div style={V2.rejectList}>
          <div className="eyebrow" style={V2.rejectHeader}>
            rejection reasons (24h)
          </div>
          <table style={V2.rejectTable}>
            <thead>
              <tr>
                <th style={V2.rejectTh}>reason</th>
                <th style={{ ...V2.rejectTh, textAlign: 'right' }}>n</th>
                <th style={{ ...V2.rejectTh, textAlign: 'right' }}>most recent</th>
              </tr>
            </thead>
            <tbody>
              {rejects.slice(0, 8).map((r) => (
                <tr key={r.rejection_reason}>
                  <td style={V2.rejectTd}>{r.rejection_reason}</td>
                  <td style={{ ...V2.rejectTd, textAlign: 'right' }}>{fmtInt(r.n)}</td>
                  <td style={{ ...V2.rejectTd, textAlign: 'right', color: 'var(--cloud-mute)' }}>
                    {ago(r.last_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={V2.footnote}>
        v2 is in <strong>{v2.fill_mode}</strong> mode — fills are simulated, not real Kalshi orders.
        Phase 1 exit criteria (plan §22.6): plumbing stable for 14 days, CLV positive on grade A-C
        trades for ≥7 days, every rejection rule fires at least once.
      </div>
    </div>
  );
}

function V2Tile({ label, value, sub, tone = 'neutral', accent }) {
  const color = accent || ({
    positive: 'var(--dawn-gold)',
    negative: 'var(--storm-violet)',
    caution:  'var(--cloud-haze)',
    neutral:  'var(--cloud-pearl)',
  }[tone]);
  return (
    <div style={V2.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="numeric" style={{ ...V2.tileValue, color }}>{value}</div>
      {sub && <div style={V2.tileSub}>{sub}</div>}
    </div>
  );
}

function ago(iso) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const dt = (Date.now() - t) / 1000;
  if (dt < 60)    return `${Math.round(dt)}s ago`;
  if (dt < 3600)  return `${Math.round(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.round(dt / 3600)}h ago`;
  return `${Math.round(dt / 86400)}d ago`;
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

const V2 = {
  frame: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginTop: 'var(--space-5)',
  },
  header: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
    marginBottom: 'var(--space-4)',
    paddingBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-h3)',
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    flex: 1,
  },
  heartbeat: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
  },
  muted: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
  },
  tileRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
  },
  tile: {
    background: 'var(--ink-night, #0c0c0c)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-3)',
    minHeight: 80,
  },
  tileValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-h3)',
    fontWeight: 500,
    marginTop: 'var(--space-1)',
    marginBottom: 'var(--space-1)',
    letterSpacing: '-0.01em',
  },
  tileSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
  },
  rejectList: {
    marginTop: 'var(--space-3)',
    background: 'var(--ink-night, #0c0c0c)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-3)',
  },
  rejectHeader: {
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-2)',
  },
  rejectTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
  },
  rejectTh: {
    textAlign: 'left',
    fontWeight: 400,
    color: 'var(--cloud-mute)',
    fontSize: 'var(--type-micro)',
    padding: '2px 8px',
    borderBottom: '1px solid var(--rule-faint)',
  },
  rejectTd: {
    padding: '4px 8px',
    color: 'var(--cloud-haze)',
  },
  footnote: {
    marginTop: 'var(--space-3)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '78ch',
    lineHeight: 1.6,
  },
};
