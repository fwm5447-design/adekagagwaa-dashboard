'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * DecisionsRendered — mv_signals_funnel_30d.
 *
 * The most analytically valuable view in the dashboard.  Every market
 * the analyzer evaluated produces a row in `signals` (Phase 3 wiring);
 * this MV aggregates the last 30 days into the funnel of decisions
 * actually taken vs withheld, and — critically — what the WITHHELD
 * decisions WOULD have made or lost if the bot had taken them.
 *
 * The latter is the "counterfactual P&L" — the money the bot's
 * conservative thresholds left on the table (positive cf_pnl on
 * skipped signals = under-trading) or saved (negative cf_pnl on
 * skipped = correctly avoided).  This is the primary tuning signal
 * for edge thresholds, confidence thresholds, and skip reasons.
 *
 * Three views, top-to-bottom:
 *
 *   1. Headline tiles — total signals, taken, skipped, and the big
 *      "money left on the table" number (skipped_cf_pnl summed across
 *      all decision codes).
 *
 *   2. Decision×market_type funnel — bar chart of n_signals per
 *      (decision, market_type) combo.  TRADE bars in dawn-gold,
 *      SKIP_* bars in storm-violet shades.  The counterfactual P&L
 *      per skip-bucket renders as a table beneath.
 *
 *   3. Counterfactual P&L decomposition — for each SKIP decision
 *      with cf data, shows what the skipped trades would have done.
 *      Positive = bot was too conservative; negative = bot was right
 *      to skip.  Sortable.
 */
export default function DecisionsRendered({ rows = [], freshness }) {
  // Aggregate roll-ups for the headline tiles.
  const totals = useMemo(() => {
    let n_signals = 0;
    let n_taken = 0;
    let n_skipped = 0;
    let cf_pnl_skipped = 0; // signed; positive = "money left on table"
    let n_skipped_with_cf = 0;
    let cf_wins_skipped = 0;
    let cf_decisive_skipped = 0;

    for (const r of rows) {
      n_signals += Number(r.n_signals) || 0;
      n_taken += Number(r.n_taken) || 0;
      n_skipped += Number(r.n_skipped) || 0;
      const dec = String(r.decision || '');
      if (dec.startsWith('SKIP')) {
        const skippedCf = Number(r.skipped_cf_pnl);
        if (Number.isFinite(skippedCf)) cf_pnl_skipped += skippedCf;
        const nWithCf = Number(r.n_with_cf) || 0;
        n_skipped_with_cf += nWithCf;
        const cfRate = Number(r.cf_win_rate);
        if (Number.isFinite(cfRate) && nWithCf > 0) {
          cf_wins_skipped += cfRate * nWithCf;
          cf_decisive_skipped += nWithCf;
        }
      }
    }
    const skipped_cf_winrate = cf_decisive_skipped > 0
      ? cf_wins_skipped / cf_decisive_skipped
      : null;
    return {
      n_signals,
      n_taken,
      n_skipped,
      take_rate: n_signals > 0 ? n_taken / n_signals : null,
      cf_pnl_skipped,
      n_skipped_with_cf,
      skipped_cf_winrate,
    };
  }, [rows]);

  // Funnel chart data: one bar per (decision, market_type) pair.
  const funnelData = useMemo(() => {
    return [...rows]
      .filter((r) => Number.isFinite(Number(r.n_signals)) && Number(r.n_signals) > 0)
      .map((r) => ({
        label: `${r.decision} · ${r.market_type}`,
        decision: String(r.decision || '?'),
        market_type: String(r.market_type || '?'),
        n: Number(r.n_signals) || 0,
        n_taken: Number(r.n_taken) || 0,
        n_skipped: Number(r.n_skipped) || 0,
        edge: Number(r.mean_edge_pct),
        prob_us: Number(r.mean_our_prob),
        prob_market: Number(r.mean_market_prob),
        skipped_cf_pnl: Number(r.skipped_cf_pnl),
        cf_win_rate: Number(r.cf_win_rate),
        n_with_cf: Number(r.n_with_cf) || 0,
        cf_total_pnl: Number(r.cf_total_pnl),
      }))
      .sort((a, b) => b.n - a.n);
  }, [rows]);

  // Skip-decision breakdown for the counterfactual table.  Only rows
  // where the skip decision had counterfactual outcomes worth
  // inspecting.
  const skipDecisions = useMemo(() => {
    return funnelData
      .filter((d) => d.decision.startsWith('SKIP') && d.n_with_cf > 0)
      .sort((a, b) => {
        // Largest absolute counterfactual P&L first — that's the
        // most-tunable skip reason.
        const aAbs = Math.abs(d_finite(a.skipped_cf_pnl));
        const bAbs = Math.abs(d_finite(b.skipped_cf_pnl));
        return bAbs - aAbs;
      });
  }, [funnelData]);

  const cellColor = (d) => {
    if (d.decision === 'TRADE') return 'var(--dawn-gold)';
    if (d.decision.startsWith('SKIP')) {
      // Stagger storm shades by skip reason for visual differentiation.
      const reasonHash = String(d.decision).slice(5)
        .split('').reduce((a, c) => a + c.charCodeAt(0), 0) || 0;
      const variants = ['var(--storm-violet)', 'var(--storm-deep)', 'var(--sky-mist)'];
      return variants[reasonHash % variants.length];
    }
    return 'var(--cloud-shade)';
  };

  return (
    <SectionFrame
      id="decisions"
      invocation="Decisions Rendered & Withheld"
      title="Decisions Rendered & Withheld"
      subtitle="The analyzer evaluates every market and either trades, refuses, or sets it aside.  For decisions withheld, the counterfactual ledger records what would have happened — the calibration mirror for the threshold logic."
      freshnessAt={freshness}
      freshnessCadenceSec={3600 /* hourly refresh */}
    >
      {/* ── Headline tiles ── */}
      <div style={S.tileGrid}>
        <Tile
          label="signals · 30d"
          value={fmtInt(totals.n_signals)}
          tone="neutral"
        />
        <Tile
          label="taken"
          value={fmtInt(totals.n_taken)}
          sub={pct(totals.take_rate)}
          tone="positive"
        />
        <Tile
          label="withheld"
          value={fmtInt(totals.n_skipped)}
          sub={fmtInt(totals.n_skipped_with_cf) + ' settled'}
          tone="neutral"
        />
        <Tile
          label="counterfactual · skipped"
          value={fmtSignedDollar(totals.cf_pnl_skipped)}
          sub={
            totals.skipped_cf_winrate != null
              ? `${pct(totals.skipped_cf_winrate)} would-have-won`
              : '—'
          }
          tone={
            totals.cf_pnl_skipped > 5 ? 'over-cautious'
            : totals.cf_pnl_skipped < -5 ? 'well-saved'
            : 'neutral'
          }
        />
      </div>

      {/* ── Decision funnel chart ── */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Decisions by reason × market type · last 30 days
        </div>
        <ResponsiveContainer width="100%" height={Math.max(280, funnelData.length * 28)}>
          <BarChart data={funnelData} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-haze)' }}
              stroke="var(--rule-mid)"
              width={220}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ink-deep)',
                border: '1px solid var(--rule-mid)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              formatter={(v, name, item) => {
                if (name === 'n') return [v, 'signals'];
                return [v, name];
              }}
              labelFormatter={(label, payload) => {
                if (!payload?.[0]?.payload) return label;
                const d = payload[0].payload;
                const lines = [
                  label,
                  `mean our_prob: ${Number.isFinite(d.prob_us) ? d.prob_us.toFixed(3) : '—'}`,
                  `mean mkt_prob: ${Number.isFinite(d.prob_market) ? d.prob_market.toFixed(3) : '—'}`,
                  `mean edge: ${Number.isFinite(d.edge) ? d.edge.toFixed(2) + '%' : '—'}`,
                ];
                return lines.join('\n');
              }}
            />
            <Bar dataKey="n" name="signals">
              {funnelData.map((d, i) => (
                <Cell key={i} fill={cellColor(d)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Counterfactual table ── */}
      <div style={S.tableCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Counterfactual outcome · withheld decisions with settled counterfactuals
        </div>
        <table style={S.table}>
          <thead>
            <tr style={S.theadRow}>
              <th style={S.thLeft}>Skip reason</th>
              <th style={S.thLeft}>Market</th>
              <th style={S.thRight}>n withheld</th>
              <th style={S.thRight}>n w/ cf</th>
              <th style={S.thRight}>cf win rate</th>
              <th style={S.thRight}>cf P&amp;L</th>
              <th style={S.thRight}>verdict</th>
            </tr>
          </thead>
          <tbody>
            {skipDecisions.length === 0 && (
              <tr>
                <td colSpan={7} style={S.tdEmpty}>
                  No counterfactual data yet — withheld signals settle as their target dates pass.
                </td>
              </tr>
            )}
            {skipDecisions.map((d, i) => {
              const cf = d.skipped_cf_pnl;
              const verdict = !Number.isFinite(cf)
                ? 'unknown'
                : cf > 5 ? 'over-cautious'
                : cf < -5 ? 'well-saved'
                : 'wash';
              const verdictColor = verdict === 'over-cautious' ? 'var(--dawn-gold)'
                : verdict === 'well-saved' ? '#7da78d'
                : 'var(--cloud-mute)';
              const cfColor = cf > 0 ? 'var(--dawn-gold)'
                : cf < 0 ? 'var(--storm-violet)'
                : 'var(--cloud-mute)';
              return (
                <tr key={i} style={S.tbodyRow}>
                  <td style={S.tdLeft}>
                    <StatusPill value={d.decision} size="compact" />
                  </td>
                  <td style={S.tdLeft}>{d.market_type}</td>
                  <td style={S.tdRight}>{fmtInt(d.n_skipped)}</td>
                  <td style={S.tdRight}>{fmtInt(d.n_with_cf)}</td>
                  <td style={S.tdRight}>
                    {Number.isFinite(d.cf_win_rate) ? pct(d.cf_win_rate) : '—'}
                  </td>
                  <td style={{ ...S.tdRight, color: cfColor, fontWeight: 600 }}>
                    {fmtSignedDollar(cf)}
                  </td>
                  <td style={{ ...S.tdRight, color: verdictColor, fontStyle: 'italic' }}>
                    {verdict}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={S.footnote}>
        <em>cf P&amp;L</em> on a SKIP row is the dollar-realized outcome of the
        positions the bot would have opened had the threshold logic not
        intervened.  Sustained positive cf P&amp;L on a skip reason argues for
        loosening that threshold; sustained negative argues the gate is doing
        its job.
      </p>
    </SectionFrame>
  );
}

// ── Tile primitive (used across multiple sections eventually) ─────────

function Tile({ label, value, sub, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'over-cautious' ? 'var(--dawn-gold)'
    : tone === 'well-saved' ? '#7da78d'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color: valueColor }}>
        {value}
      </div>
      {sub && (
        <div className="numeric" style={S.tileSub}>{sub}</div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function d_finite(v) { return Number.isFinite(v) ? v : 0; }
function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtSignedDollar(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

// ── Styles ────────────────────────────────────────────────────────────

const S = {
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-5)',
  },
  tile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    minHeight: 90,
  },
  tileValue: {
    fontSize: 'var(--type-display)',
    lineHeight: 1.05,
    marginTop: 'var(--space-2)',
  },
  tileSub: {
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-1)',
  },
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-5)',
  },
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
  },
  theadRow: { borderBottom: '1px solid var(--rule-mid)' },
  thLeft: {
    textAlign: 'left', padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-mute)', fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  thRight: {
    textAlign: 'right', padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-mute)', fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  tbodyRow: { borderBottom: '1px solid var(--rule-faint)' },
  tdLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-pearl)',
  },
  tdRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-haze)',
  },
  tdEmpty: {
    textAlign: 'center',
    padding: 'var(--space-5)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
  },
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-4)',
    maxWidth: '70ch',
    lineHeight: 1.6,
  },
};
