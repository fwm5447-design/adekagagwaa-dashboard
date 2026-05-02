'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * RealizedEdge — mv_pnl_attribution.
 *
 * Decomposes realized P&L into its four contributing terms so you can
 * see WHERE the money came from (or went):
 *
 *   realized_pnl = edge - variance_penalty - fees - slippage
 *
 * Each term is averaged per-contract across the trade population, so
 * a market with many small bets and a market with few large bets
 * remain comparable at the per-contract level.
 *
 * Three views, top-to-bottom:
 *
 *   1. Per-market-type waterfall — the headline visualization.  Each
 *      bar shows: starting edge → fees deducted → slippage deducted
 *      → variance penalty → realized P&L per contract.  Reading
 *      left-to-right is the path from theoretical to actual.
 *
 *   2. Aggregate tile row — total realized P&L, total fees paid,
 *      total slippage cost, and the gross "edge captured" sum.
 *
 *   3. Per (market_type × grade) table — the most analytically useful
 *      drill-down.  If grade-A trades show ~zero slippage and grade-B
 *      trades show -2c/contract, the slippage discipline gates need
 *      to differ by grade.
 */
export default function RealizedEdge({ rows = [], freshness }) {
  // Aggregate per market_type for the waterfall.
  const byMarketType = useMemo(() => {
    const buckets = new Map();
    for (const r of rows) {
      const mt = String(r.market_type || '?');
      if (!buckets.has(mt)) {
        buckets.set(mt, {
          market_type: mt,
          n_trades: 0,
          n_contracts_sum: 0,
          edge_sum: 0,
          variance_sum: 0,
          fees_sum: 0,
          slippage_sum: 0,
          realized_sum: 0,
          total_fees: 0,
          total_realized: 0,
        });
      }
      const b = buckets.get(mt);
      const n_contracts = Number(r.n_contracts) || 0;
      b.n_trades += 1;
      b.n_contracts_sum += n_contracts;
      // weight each per-contract metric by n_contracts
      const wedge = (Number(r.edge_per_contract)     || 0) * n_contracts;
      const wvar  = (Number(r.variance_per_contract) || 0) * n_contracts;
      const wfee  = (Number(r.fees_per_contract)     || 0) * n_contracts;
      const wslip = (Number(r.slippage_per_contract) || 0) * n_contracts;
      const wreal = (Number(r.realized_pnl_per_contract) || 0) * n_contracts;
      b.edge_sum     += wedge;
      b.variance_sum += wvar;
      b.fees_sum     += wfee;
      b.slippage_sum += wslip;
      b.realized_sum += wreal;
      b.total_fees     += Number(r.fees_paid) || 0;
      b.total_realized += Number(r.realized_pnl_per_contract) * n_contracts;
    }
    // Compute weighted means and signs.
    const out = [];
    for (const b of buckets.values()) {
      const denom = Math.max(b.n_contracts_sum, 1);
      out.push({
        market_type: b.market_type,
        n_trades: b.n_trades,
        n_contracts: b.n_contracts_sum,
        edge: b.edge_sum / denom,
        variance: b.variance_sum / denom,
        fees: b.fees_sum / denom,
        slippage: b.slippage_sum / denom,
        realized: b.realized_sum / denom,
        total_fees: b.total_fees,
        total_realized: b.total_realized,
      });
    }
    out.sort((a, b) => a.market_type.localeCompare(b.market_type));
    return out;
  }, [rows]);

  // Aggregate totals across all market_types for the headline tiles.
  const totals = useMemo(() => {
    let n_trades = 0;
    let n_contracts = 0;
    let total_edge = 0;
    let total_variance = 0;
    let total_fees = 0;
    let total_slippage = 0;
    let total_realized = 0;
    for (const b of byMarketType) {
      n_trades += b.n_trades;
      n_contracts += b.n_contracts;
      total_edge     += b.edge     * b.n_contracts;
      total_variance += b.variance * b.n_contracts;
      total_fees     += b.fees     * b.n_contracts;
      total_slippage += b.slippage * b.n_contracts;
      total_realized += b.realized * b.n_contracts;
    }
    return {
      n_trades,
      n_contracts,
      total_edge,
      total_variance,
      total_fees,
      total_slippage,
      total_realized,
    };
  }, [byMarketType]);

  // Build per-market-type waterfall data.  Each entry is a bar in the
  // chart with a "running cumulative" semantic.  We show component
  // contributions positive or negative as colored bars.
  const waterfallData = useMemo(() => {
    return byMarketType.map((b) => ({
      market_type: b.market_type,
      'edge': b.edge,
      'fees': -Math.abs(b.fees),
      'slippage': -Math.abs(b.slippage),
      'variance': -Math.abs(b.variance),
      'realized': b.realized,
    }));
  }, [byMarketType]);

  return (
    <SectionFrame
      id="edge"
      invocation="Realized Edge Decomposition"
      title="Realized Edge Decomposition"
      subtitle="Theoretical edge erodes through fees, slippage, and variance before settling as realized P&L per contract.  Reading left-to-right, the chart shows the path from what the model promised to what the bookie actually paid."
      freshnessAt={freshness}
      freshnessCadenceSec={300 /* 5-minute refresh */}
    >
      {/* ── Headline tiles ── */}
      <div style={S.tileGrid}>
        <Tile
          label="contracts · all-time"
          value={fmtInt(totals.n_contracts)}
          sub={`${fmtInt(totals.n_trades)} trades`}
          tone="neutral"
        />
        <Tile
          label="theoretical edge"
          value={fmtCents(totals.total_edge)}
          sub="¢ / contract weighted mean"
          tone="positive"
        />
        <Tile
          label="frictions · fees + slip"
          value={fmtCents(-(Math.abs(totals.total_fees) + Math.abs(totals.total_slippage)))}
          sub="¢ / contract weighted mean"
          tone="negative"
        />
        <Tile
          label="realized P&L"
          value={fmtCents(totals.total_realized)}
          sub="¢ / contract weighted mean"
          tone={totals.total_realized > 0 ? 'positive' : totals.total_realized < 0 ? 'negative' : 'neutral'}
        />
      </div>

      {/* ── Per-market-type waterfall chart ── */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Per-contract decomposition by market type · cents per contract
        </div>
        <ResponsiveContainer width="100%" height={Math.max(280, byMarketType.length * 72)}>
          <BarChart data={waterfallData} margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
            <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
            <XAxis
              dataKey="market_type"
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--cloud-haze)' }}
              stroke="var(--rule-mid)"
            />
            <YAxis
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
              label={{
                value: '¢ / contract',
                angle: -90,
                position: 'insideLeft',
                style: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' },
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ink-deep)',
                border: '1px solid var(--rule-mid)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}¢` : v)}
            />
            <ReferenceLine y={0} stroke="var(--cloud-mute)" />
            <Bar dataKey="edge" name="Edge"           fill="var(--dawn-gold)"    stackId="terms" />
            <Bar dataKey="fees" name="Fees"           fill="var(--storm-deep)"   stackId="terms" />
            <Bar dataKey="slippage" name="Slippage"   fill="var(--storm-violet)" stackId="terms" />
            <Bar dataKey="variance" name="Variance"   fill="var(--sky-mist)"     stackId="terms" />
            <Bar dataKey="realized" name="Realized"   fill="var(--cloud-haze)"   stackId="realized" />
          </BarChart>
        </ResponsiveContainer>
        <div style={S.legend}>
          <LegendDot color="var(--dawn-gold)"     label="edge" />
          <LegendDot color="var(--storm-deep)"    label="fees" />
          <LegendDot color="var(--storm-violet)"  label="slippage" />
          <LegendDot color="var(--sky-mist)"      label="variance" />
          <LegendDot color="var(--cloud-haze)"    label="realized" />
        </div>
      </div>

      {/* ── Per-market-type breakdown table ── */}
      <div style={S.tableCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Per-market-type detail · weighted by contracts traded
        </div>
        <table style={S.table}>
          <thead>
            <tr style={S.theadRow}>
              <th style={S.thLeft}>Market</th>
              <th style={S.thRight}>n trades</th>
              <th style={S.thRight}>n contracts</th>
              <th style={S.thRight}>edge ¢</th>
              <th style={S.thRight}>variance ¢</th>
              <th style={S.thRight}>fees ¢</th>
              <th style={S.thRight}>slippage ¢</th>
              <th style={S.thRight}>realized ¢</th>
            </tr>
          </thead>
          <tbody>
            {byMarketType.length === 0 && (
              <tr>
                <td colSpan={8} style={S.tdEmpty}>
                  No settled trades with attribution data yet.
                </td>
              </tr>
            )}
            {byMarketType.map((b, i) => (
              <tr key={i} style={S.tbodyRow}>
                <td style={S.tdLeft}>{b.market_type}</td>
                <td style={S.tdRight}>{fmtInt(b.n_trades)}</td>
                <td style={S.tdRight}>{fmtInt(b.n_contracts)}</td>
                <td style={{ ...S.tdRight, color: 'var(--dawn-gold)' }}>
                  {fmtCents(b.edge)}
                </td>
                <td style={S.tdRight}>{fmtCents(-Math.abs(b.variance))}</td>
                <td style={{ ...S.tdRight, color: 'var(--storm-deep)' }}>
                  {fmtCents(-Math.abs(b.fees))}
                </td>
                <td style={{ ...S.tdRight, color: 'var(--storm-violet)' }}>
                  {fmtCents(-Math.abs(b.slippage))}
                </td>
                <td style={{
                  ...S.tdRight,
                  color: b.realized > 0 ? 'var(--dawn-gold)'
                       : b.realized < 0 ? 'var(--storm-violet)'
                       : 'var(--cloud-pearl)',
                  fontWeight: 600,
                }}>
                  {fmtCents(b.realized)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={S.footnote}>
        <em>edge</em> is the model's expected ¢/contract assuming our calibrated
        probability is correct.&nbsp; <em>variance</em> is the half-Kelly penalty
        for the bet's binomial uncertainty.&nbsp; <em>fees</em> and <em>slippage</em>
        are realized costs.&nbsp; <em>realized</em> is the empirical mean —
        the difference between realized and (edge − variance − fees − slip)
        is the calibration residual.
      </p>
    </SectionFrame>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function Tile({ label, value, sub, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
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

function LegendDot({ color, label }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--type-micro)',
      color: 'var(--cloud-haze)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}>
      <span style={{
        width: 10,
        height: 10,
        background: color,
        display: 'inline-block',
        borderRadius: 1,
      }} />
      {label}
    </span>
  );
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtCents(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${Math.abs(v).toFixed(2)}¢`;
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
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-4)',
    marginTop: 'var(--space-3)',
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--rule-faint)',
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
  tdLeft: { textAlign: 'left',  padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-pearl)' },
  tdRight: { textAlign: 'right', padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-haze)' },
  tdEmpty: {
    textAlign: 'center', padding: 'var(--space-5)',
    color: 'var(--cloud-mute)', fontStyle: 'italic',
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
