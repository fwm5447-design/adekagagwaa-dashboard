'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';

/**
 * Mentions — Kalshi mentions-markets observability section.
 *
 * Sources 8 queries from lib/queries.js:
 *   mentions_universe          — series/events/markets snapshot counts
 *   mentions_daily             — per-strategy daily PnL roll-up
 *   mentions_priors            — Beta-Binomial posteriors leaderboard
 *   mentions_recent_decisions  — last 200 strategy decisions
 *   mentions_trades            — paper trades (mode='paper')
 *   mentions_brands            — Trump-branded nouns detected
 *   mentions_calibration       — current 30d reliability bins
 *   mentions_corpus_freshness  — Truth Social poll lag
 *
 * The whole stack defaults to mode=paper until the 7-day / 5-winning-days
 * gate trips (see bot repo docs/mentions_markets_plan.md §6.0).  When
 * empty (runner not yet started) the section renders an empty-state
 * banner with the deploy hint.
 */

const STRATEGY_LABELS = {
  nqe_sweep_v1:       'NQE sweep',
  sports_bandit_v1:   'Sports bandit (small)',
  sports_bandit_v2:   'Sports bandit (big)',
  trump_recurring_v1: 'Trump recurring',
  hannity_cover_v1:   'Hannity cover',
  brand_launch_v1:    'Brand launch',
  trump_poisson_v1:   'Trump Poisson',
  trump_wide_no_v1:   'Trump wide-NO',
  trump_dip_yes_v1:   'Trump dip-YES',
};

const STRATEGY_ORDER = [
  'nqe_sweep_v1',
  'sports_bandit_v1',
  'sports_bandit_v2',
  'trump_recurring_v1',
  'trump_wide_no_v1',
  'trump_dip_yes_v1',
  'hannity_cover_v1',
  'brand_launch_v1',
  'trump_poisson_v1',
];

export default function Mentions({ data, freshness }) {
  const universe        = data?.universe?.[0]    || null;
  const dailyRows       = data?.daily            || [];
  const priorsRows      = data?.priors           || [];
  const decisionsRows   = data?.decisions        || [];
  const tradesRows      = data?.trades           || [];
  const brandsRows      = data?.brands           || [];
  const calibrationRows = data?.calibration      || [];
  const corpusRows      = data?.corpus_freshness || [];

  // ── Headline tiles: snapshot of everything ──────────────────────
  const headline = useMemo(() => {
    const snapshotsToday = Number(universe?.snapshots_total) || 0;
    const lastSnap       = universe?.last_snapshot_ts ? new Date(universe.last_snapshot_ts) : null;
    const activeMarkets  = Number(universe?.markets_n) || 0;
    const seriesN        = Number(universe?.series_n) || 0;
    const eventsN        = Number(universe?.events_n) || 0;

    // Total paper PnL last 7 days
    const pnl7d = dailyRows.reduce((s, r) => s + (Number(r.pnl_usd) || 0), 0);
    const trades7d = dailyRows.reduce((s, r) => s + (Number(r.n_trades) || 0), 0);

    // Active priors count + per-strategy
    const priorsByStrategy = {};
    for (const p of priorsRows) {
      const k = p.strategy;
      priorsByStrategy[k] ??= { active: 0, shrunk: 0, killed: 0, total: 0 };
      priorsByStrategy[k].total += 1;
      if (p.status === 'active') priorsByStrategy[k].active += 1;
      else if (p.status === 'shrunk') priorsByStrategy[k].shrunk += 1;
      else if (p.status === 'killed') priorsByStrategy[k].killed += 1;
    }
    const totalActive = Object.values(priorsByStrategy).reduce((s, x) => s + x.active, 0);
    const totalShrunk = Object.values(priorsByStrategy).reduce((s, x) => s + x.shrunk, 0);
    const totalKilled = Object.values(priorsByStrategy).reduce((s, x) => s + x.killed, 0);

    return {
      snapshotsToday, lastSnap, activeMarkets, seriesN, eventsN,
      pnl7d, trades7d,
      priorsByStrategy, totalActive, totalShrunk, totalKilled,
      runnerLikelyDown: !lastSnap || (Date.now() - lastSnap.getTime() > 30 * 60 * 1000),
    };
  }, [universe, dailyRows, priorsRows]);

  // ── Per-strategy aggregates over the dailyRows window ───────────
  const perStrategy = useMemo(() => {
    const m = {};
    for (const r of dailyRows) {
      const k = r.strategy;
      m[k] ??= { trades: 0, settled: 0, pnl: 0, winningDays: 0, daysActive: new Set() };
      m[k].trades  += Number(r.n_trades) || 0;
      m[k].settled += Number(r.n_settled) || 0;
      m[k].pnl     += Number(r.pnl_usd) || 0;
      m[k].daysActive.add(String(r.day || '').slice(0, 10));
      if ((Number(r.pnl_usd) || 0) > 0) m[k].winningDays += 1;
    }
    return Object.fromEntries(
      Object.entries(m).map(([k, v]) => [k, {
        ...v, daysActive: v.daysActive.size,
      }])
    );
  }, [dailyRows]);

  // ── Top + bottom priors by posterior_mean ───────────────────────
  const priorsSorted = useMemo(() => {
    return [...priorsRows].sort(
      (a, b) => Number(b.posterior_mean) - Number(a.posterior_mean),
    );
  }, [priorsRows]);
  const topPriors = priorsSorted.slice(0, 10);
  const bottomPriors = priorsSorted.slice(-5).reverse();

  return (
    <SectionFrame
      id="mentions"
      invocation="Mentions Markets"
      title="Mentions Bandit"
      subtitle={
        headline.runnerLikelyDown
          ? "Runner not yet writing snapshots — see docs/mentions_ops.md to start it."
          : "Per-strike Beta-Binomial bandit across 6 strategies × 8 Kalshi mention series. Paper-mode until 7-day / 5-winning-days gate trips."
      }
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {/* Headline tiles row */}
      <div style={S.tileGrid}>
        <Tile
          label="Active priors"
          value={String(headline.totalActive)}
          sub={`${headline.totalShrunk} shrunk · ${headline.totalKilled} killed`}
          tone={headline.totalKilled > 0 ? 'warn' : 'ok'}
        />
        <Tile
          label="Paper PnL 14d"
          value={fmtUsd(headline.pnl7d)}
          sub={`${headline.trades7d} trades`}
          tone={headline.pnl7d > 0 ? 'good' : headline.pnl7d < 0 ? 'bad' : null}
        />
        <Tile
          label="Snapshots 24h"
          value={String(headline.snapshotsToday)}
          sub={
            headline.lastSnap
              ? `last ${ageStr(headline.lastSnap)} ago`
              : 'runner offline'
          }
          tone={headline.runnerLikelyDown ? 'bad' : 'ok'}
        />
        <Tile
          label="Markets watched"
          value={String(headline.activeMarkets)}
          sub={`${headline.seriesN} series · ${headline.eventsN} events`}
        />
        <Tile
          label="Brands detected"
          value={String(brandsRows.length)}
          sub={
            brandsRows.length > 0
              ? `latest: ${brandsRows[0]?.brand_phrase || '—'}`
              : 'awaiting Trump brand launches'
          }
          tone={brandsRows.length > 0 ? 'ok' : null}
        />
        <Tile
          label="Corpus freshness"
          value={
            corpusRows[0]?.last_posted_at
              ? ageStr(new Date(corpusRows[0].last_posted_at))
              : '—'
          }
          sub={
            corpusRows[0]
              ? `${corpusRows[0].n_posts_24h} posts/24h ${corpusRows[0].source}`
              : 'no corpus rows yet'
          }
        />
      </div>

      {/* Per-strategy roll-up */}
      <div style={S.subhead}>Per-strategy (last 14 days)</div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thLeft}>Strategy</th>
              <th style={S.th}>Days active</th>
              <th style={S.th}>Winning days</th>
              <th style={S.th}>Trades</th>
              <th style={S.th}>Settled</th>
              <th style={S.th}>PnL (USD)</th>
              <th style={S.th}>Priors</th>
              <th style={S.th}>Gate</th>
            </tr>
          </thead>
          <tbody>
            {STRATEGY_ORDER.map((k) => {
              const s = perStrategy[k] || { trades: 0, settled: 0, pnl: 0, winningDays: 0, daysActive: 0 };
              const p = headline.priorsByStrategy[k] || { active: 0, shrunk: 0, killed: 0, total: 0 };
              const gateState = gateLabel(s);
              return (
                <tr key={k} style={S.tr}>
                  <td style={S.tdLeft}>{STRATEGY_LABELS[k] || k}</td>
                  <td style={S.td}>{s.daysActive}</td>
                  <td style={S.td}>{s.winningDays}/{s.daysActive}</td>
                  <td style={S.td}>{s.trades}</td>
                  <td style={S.td}>{s.settled}</td>
                  <td style={{ ...S.tdMono, color: pnlColor(s.pnl) }}>
                    {fmtUsd(s.pnl)}
                  </td>
                  <td style={S.tdMono}>
                    {p.active}
                    {p.shrunk > 0 && <span style={S.muted}> +{p.shrunk}↓</span>}
                    {p.killed > 0 && <span style={S.bad}> +{p.killed}†</span>}
                  </td>
                  <td style={{ ...S.tdMono, color: gateState.color, fontWeight: 600 }}>
                    {gateState.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Top + bottom priors */}
      <div style={S.subhead}>Strongest priors (top 10 by posterior mean)</div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thLeft}>Strategy</th>
              <th style={S.thLeft}>Strike</th>
              <th style={S.th}>Side</th>
              <th style={S.th}>α</th>
              <th style={S.th}>β</th>
              <th style={S.th}>n</th>
              <th style={S.th}>Mean</th>
              <th style={S.th}>95% CI</th>
              <th style={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {topPriors.length === 0 && (
              <tr><td colSpan={9} style={S.empty}>No priors seeded yet.</td></tr>
            )}
            {topPriors.map((p) => (
              <tr key={`${p.strategy}|${p.strike_key}|${p.side}`} style={S.tr}>
                <td style={S.tdLeft}>{STRATEGY_LABELS[p.strategy] || p.strategy}</td>
                <td style={S.tdLeft}><span className="numeric">{p.strike_key}</span></td>
                <td style={{ ...S.td, color: p.side === 'YES' ? 'var(--good, #6f6)' : 'var(--bad, #f86)' }}>
                  {p.side}
                </td>
                <td style={S.tdMono}>{Number(p.alpha).toFixed(1)}</td>
                <td style={S.tdMono}>{Number(p.beta).toFixed(1)}</td>
                <td style={S.tdMono}>{p.n_observations}</td>
                <td style={S.tdMono}>{Number(p.posterior_mean).toFixed(3)}</td>
                <td style={S.tdMono}>
                  [{Number(p.ci_lo).toFixed(2)}, {Number(p.ci_hi).toFixed(2)}]
                </td>
                <td style={{ ...S.td, color: statusColor(p.status) }}>
                  {p.status}{p.shrink < 1.0 ? ` ×${Number(p.shrink).toFixed(2)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bottomPriors.length > 0 && (
        <>
          <div style={S.subhead}>Weakest priors (bottom 5 — drift candidates)</div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thLeft}>Strategy</th>
                  <th style={S.thLeft}>Strike</th>
                  <th style={S.th}>Side</th>
                  <th style={S.th}>n</th>
                  <th style={S.th}>Mean</th>
                  <th style={S.th}>95% CI</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {bottomPriors.map((p) => (
                  <tr key={`b|${p.strategy}|${p.strike_key}|${p.side}`} style={S.tr}>
                    <td style={S.tdLeft}>{STRATEGY_LABELS[p.strategy] || p.strategy}</td>
                    <td style={S.tdLeft}>{p.strike_key}</td>
                    <td style={S.td}>{p.side}</td>
                    <td style={S.tdMono}>{p.n_observations}</td>
                    <td style={S.tdMono}>{Number(p.posterior_mean).toFixed(3)}</td>
                    <td style={S.tdMono}>
                      [{Number(p.ci_lo).toFixed(2)}, {Number(p.ci_hi).toFixed(2)}]
                    </td>
                    <td style={{ ...S.td, color: statusColor(p.status) }}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Brand inventory */}
      {brandsRows.length > 0 && (
        <>
          <div style={S.subhead}>Trump brand inventory (latest detections)</div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thLeft}>Phrase</th>
                  <th style={S.th}>First seen</th>
                  <th style={S.thLeft}>Source</th>
                  <th style={S.th}>Sustained YES p</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {brandsRows.slice(0, 20).map((b) => (
                  <tr key={b.id} style={S.tr}>
                    <td style={S.tdLeft}><strong>{b.brand_phrase}</strong></td>
                    <td style={S.tdMono}>{b.first_seen_ts ? ageStr(new Date(b.first_seen_ts)) : '—'}</td>
                    <td style={S.tdLeft}>{b.first_source}</td>
                    <td style={S.tdMono}>{b.sustained_yes_p != null ? Number(b.sustained_yes_p).toFixed(2) : '—'}</td>
                    <td style={{ ...S.td, color: b.status === 'live' ? 'var(--good, #6f6)' : 'var(--cloud-mute)' }}>
                      {b.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Recent decisions */}
      <div style={S.subhead}>Recent decisions (last 25)</div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>When</th>
              <th style={S.thLeft}>Strategy</th>
              <th style={S.thLeft}>Strike</th>
              <th style={S.th}>Model p</th>
              <th style={S.th}>Mkt p</th>
              <th style={S.th}>Edge</th>
              <th style={S.th}>Side</th>
              <th style={S.th}>Size $</th>
              <th style={S.thLeft}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {decisionsRows.length === 0 && (
              <tr>
                <td colSpan={9} style={S.empty}>
                  No decisions yet — start the runner: <span className="numeric">python -m scripts.mentions_runner --mode paper</span>
                </td>
              </tr>
            )}
            {decisionsRows.slice(0, 25).map((d) => {
              const side = d.bet_side || '—';
              const edge = d.edge_pct != null ? (Number(d.edge_pct) * 100).toFixed(1) + '%' : '—';
              return (
                <tr key={d.id} style={S.tr}>
                  <td style={S.tdMono}>{d.decided_at ? ageStr(new Date(d.decided_at)) : '—'}</td>
                  <td style={S.tdLeft}>{STRATEGY_LABELS[d.strategy] || d.strategy}</td>
                  <td style={S.tdLeft}>{d.strike_word || d.strike_key}</td>
                  <td style={S.tdMono}>{d.model_p_yes != null ? Number(d.model_p_yes).toFixed(2) : '—'}</td>
                  <td style={S.tdMono}>{d.market_implied_p != null ? Number(d.market_implied_p).toFixed(2) : '—'}</td>
                  <td style={S.tdMono}>{edge}</td>
                  <td style={{ ...S.td, color: side === 'YES' ? 'var(--good, #6f6)' : side === 'NO' ? 'var(--bad, #f86)' : 'var(--cloud-mute)' }}>
                    {side}
                  </td>
                  <td style={S.tdMono}>{d.size_usd != null ? '$' + Number(d.size_usd).toFixed(0) : '—'}</td>
                  <td style={S.tdLeft}>
                    {d.bet_side ? <span style={{ color: 'var(--good, #6f6)' }}>TRADED</span>
                                : <span style={{ color: 'var(--cloud-mute)' }}>{d.pass_reason || 'pass'}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Calibration bins (if any) */}
      {calibrationRows.length > 0 && (
        <>
          <div style={S.subhead}>Calibration bins (current 30-day window)</div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thLeft}>Strategy</th>
                  <th style={S.th}>Bin</th>
                  <th style={S.th}>Predicted</th>
                  <th style={S.th}>Empirical</th>
                  <th style={S.th}>|Δ|</th>
                  <th style={S.th}>n</th>
                  <th style={S.th}>Brier</th>
                </tr>
              </thead>
              <tbody>
                {calibrationRows.map((r, i) => {
                  const delta = Math.abs(Number(r.mean_predicted) - Number(r.empirical_rate));
                  const drift = delta > 0.15 && r.n_settled >= 20;
                  return (
                    <tr key={i} style={S.tr}>
                      <td style={S.tdLeft}>{STRATEGY_LABELS[r.strategy] || r.strategy}</td>
                      <td style={S.tdMono}>[{Number(r.bin_lo).toFixed(1)}, {Number(r.bin_hi).toFixed(1)})</td>
                      <td style={S.tdMono}>{Number(r.mean_predicted).toFixed(3)}</td>
                      <td style={S.tdMono}>{Number(r.empirical_rate).toFixed(3)}</td>
                      <td style={{ ...S.tdMono, color: drift ? 'var(--bad, #f86)' : 'inherit', fontWeight: drift ? 600 : 400 }}>
                        {delta.toFixed(3)}{drift ? ' ⚠' : ''}
                      </td>
                      <td style={S.tdMono}>{r.n_settled}</td>
                      <td style={S.tdMono}>{r.brier_score != null ? Number(r.brier_score).toFixed(4) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionFrame>
  );
}


// ─── Helpers ───────────────────────────────────────────────────────

function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const v = Math.abs(n);
  return `${sign}$${v.toFixed(2)}`;
}

function pnlColor(n) {
  if (n > 0)  return 'var(--good, #6f6)';
  if (n < 0)  return 'var(--bad, #f86)';
  return 'var(--cloud-mute, #888)';
}

function statusColor(s) {
  if (s === 'active') return 'var(--good, #6f6)';
  if (s === 'shrunk') return 'var(--warn, #fc6)';
  if (s === 'killed') return 'var(--bad, #f86)';
  return 'inherit';
}

function ageStr(date) {
  if (!date) return '—';
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function gateLabel({ daysActive, winningDays }) {
  // 7-day, 5-winning-days gate (docs/mentions_markets_plan.md §6.0)
  if (daysActive < 7) {
    return { label: `paper · day ${daysActive}/7`, color: 'var(--cloud-mute, #888)' };
  }
  if (winningDays >= 5) {
    return { label: `gate PASSED (${winningDays} wins) — promote?`, color: 'var(--good, #6f6)' };
  }
  return { label: `paper · ${winningDays}/5 wins (need 5)`, color: 'var(--warn, #fc6)' };
}


// ─── Tile sub-component ────────────────────────────────────────────

function Tile({ label, value, sub, tone }) {
  const toneColor = (
    tone === 'good' ? 'var(--good, #6f6)' :
    tone === 'bad'  ? 'var(--bad, #f86)'  :
    tone === 'warn' ? 'var(--warn, #fc6)' :
    tone === 'ok'   ? 'var(--cloud-mute, #888)' :
    'inherit'
  );
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={S.tileLabel}>{label}</div>
      <div style={{ ...S.tileValue, color: toneColor }}>{value}</div>
      {sub && <div style={S.tileSub}>{sub}</div>}
    </div>
  );
}


// ─── Styles ────────────────────────────────────────────────────────
const S = {
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-3, 10px)',
    marginBottom: 'var(--space-5, 18px)',
  },
  tile: {
    background: 'var(--ink-soft, #14181f)',
    padding: 'var(--space-3, 10px) var(--space-4, 14px)',
    borderRadius: 6,
    border: '1px solid var(--cloud-mute-faded, #2a2f38)',
  },
  tileLabel: {
    fontSize: 11,
    letterSpacing: '0.08em',
    color: 'var(--cloud-mute, #888)',
  },
  tileValue: {
    fontSize: 22,
    fontWeight: 600,
    marginTop: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  tileSub: {
    fontSize: 11,
    color: 'var(--cloud-mute, #888)',
    marginTop: 4,
  },
  subhead: {
    fontSize: 12,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--cloud-mute, #888)',
    marginTop: 'var(--space-5, 18px)',
    marginBottom: 'var(--space-2, 8px)',
  },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid var(--cloud-mute-faded, #2a2f38)',
    borderRadius: 6,
    background: 'var(--ink-soft, #14181f)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    padding: '8px 12px',
    textAlign: 'right',
    borderBottom: '1px solid var(--cloud-mute-faded, #2a2f38)',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--cloud-mute, #888)',
  },
  thLeft: {
    padding: '8px 12px',
    textAlign: 'left',
    borderBottom: '1px solid var(--cloud-mute-faded, #2a2f38)',
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--cloud-mute, #888)',
  },
  tr: {
    borderBottom: '1px solid var(--cloud-mute-faded, #1f2229)',
  },
  td: {
    padding: '6px 12px',
    textAlign: 'right',
  },
  tdLeft: {
    padding: '6px 12px',
    textAlign: 'left',
  },
  tdMono: {
    padding: '6px 12px',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  empty: {
    padding: '16px 12px',
    textAlign: 'center',
    color: 'var(--cloud-mute, #888)',
    fontStyle: 'italic',
  },
  muted: {
    color: 'var(--cloud-mute, #888)',
    marginLeft: 4,
  },
  bad: {
    color: 'var(--bad, #f86)',
    marginLeft: 4,
  },
};
