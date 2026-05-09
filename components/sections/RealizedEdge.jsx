'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * RealizedEdge — three-tier dashboard surface for trade economics.
 *
 *   Tier 1 (always visible):  pure realized P&L per market_type, derived
 *                             from mv_trades_full.  No closing-line
 *                             dependency.  Lights up the moment any
 *                             trade settles.
 *
 *   Tier 2 (visible when attribution is empty/sparse):  the four-stage
 *                             pipeline counts so you can see exactly
 *                             where rows are dropping out — n_settled →
 *                             n_with_closing_line → n_with_orderbook →
 *                             n_in_attribution.
 *
 *   Tier 3 (visible when attribution is populated):  the closing-line
 *                             waterfall — edge, variance, fees,
 *                             slippage, realized.  Reads from
 *                             mv_pnl_attribution.
 *
 * Data shape (passed in via the `data` prop, with backward-compat for
 * the legacy `rows` prop pointing at mv_pnl_attribution rows):
 *
 *   {
 *     rows: <mv_pnl_attribution rows — closing-line decomposition>,
 *     realized_summary: [
 *       { market_type, n_settled, n_won, n_lost,
 *         total_pnl_net, total_pnl_gross,
 *         total_intent_size_usd, total_fees_paid }, ...
 *     ],
 *     pipeline_counts: {
 *       n_settled, n_with_closing_line,
 *       n_with_orderbook_captured, n_in_attribution
 *     }
 *   }
 */
export default function RealizedEdge({ rows: legacyRows, data, freshness }) {
  // Backward-compat: if data prop missing, treat top-level rows as the
  // attribution rows.  New deployments should pass the full `data` shape.
  const attributionRows  = (data?.rows || legacyRows || []);
  const realizedSummary  = data?.realized_summary || [];
  const pipelineCounts   = data?.pipeline_counts || null;

  // ── Tier 1 — Pure realized P&L per market_type
  // Uses settler-derived data only; no closing-line dependency.  Sums
  // pnl_net across settled trades, computes win rate and average size.
  const realizedByMarket = useMemo(() => {
    return [...realizedSummary]
      .map((r) => ({
        market_type: String(r.market_type),
        n_settled: Number(r.n_settled) || 0,
        n_won: Number(r.n_won) || 0,
        n_lost: Number(r.n_lost) || 0,
        n_decisive: (Number(r.n_won) || 0) + (Number(r.n_lost) || 0),
        total_pnl_net: Number(r.total_pnl_net) || 0,
        total_pnl_gross: Number(r.total_pnl_gross) || 0,
        total_intent_size_usd: Number(r.total_intent_size_usd) || 0,
        total_fees_paid: Number(r.total_fees_paid) || 0,
      }))
      .sort((a, b) => a.market_type.localeCompare(b.market_type));
  }, [realizedSummary]);

  const realizedTotals = useMemo(() => {
    let n_settled = 0, n_won = 0, n_lost = 0;
    let pnl_net = 0, pnl_gross = 0, fees = 0, size = 0;
    for (const r of realizedByMarket) {
      n_settled += r.n_settled;
      n_won += r.n_won;
      n_lost += r.n_lost;
      pnl_net += r.total_pnl_net;
      pnl_gross += r.total_pnl_gross;
      fees += r.total_fees_paid;
      size += r.total_intent_size_usd;
    }
    const decisive = n_won + n_lost;
    const roi = size > 0 ? (pnl_net / size) : 0;
    const win_rate = decisive > 0 ? (n_won / decisive) : null;
    return { n_settled, n_won, n_lost, decisive, pnl_net, pnl_gross, fees, size, roi, win_rate };
  }, [realizedByMarket]);

  // ── Tier 3 — Closing-line decomposition (existing logic)
  const byMarketType = useMemo(() => {
    const buckets = new Map();
    for (const r of attributionRows) {
      const mt = String(r.market_type || '?');
      if (!buckets.has(mt)) {
        buckets.set(mt, {
          market_type: mt,
          n_trades: 0,
          n_contracts_sum: 0,
          edge_sum: 0, variance_sum: 0,
          fees_sum: 0, slippage_sum: 0, realized_sum: 0,
        });
      }
      const b = buckets.get(mt);
      const n_contracts = Number(r.n_contracts) || 0;
      b.n_trades += 1;
      b.n_contracts_sum += n_contracts;
      b.edge_sum     += (Number(r.edge_per_contract)         || 0) * n_contracts;
      b.variance_sum += (Number(r.variance_per_contract)     || 0) * n_contracts;
      b.fees_sum     += (Number(r.fees_per_contract)         || 0) * n_contracts;
      b.slippage_sum += (Number(r.slippage_per_contract)     || 0) * n_contracts;
      b.realized_sum += (Number(r.realized_pnl_per_contract) || 0) * n_contracts;
    }
    const out = [];
    for (const b of buckets.values()) {
      const denom = Math.max(b.n_contracts_sum, 1);
      out.push({
        market_type: b.market_type,
        n_trades: b.n_trades,
        n_contracts: b.n_contracts_sum,
        edge: b.edge_sum / denom * 100,         // dollars → cents per contract
        variance: b.variance_sum / denom * 100,
        fees: b.fees_sum / denom * 100,
        slippage: b.slippage_sum / denom * 100,
        realized: b.realized_sum / denom * 100,
      });
    }
    out.sort((a, b) => a.market_type.localeCompare(b.market_type));
    return out;
  }, [attributionRows]);

  const attributionTotals = useMemo(() => {
    let n_trades = 0, n_contracts = 0;
    let total_edge = 0, total_variance = 0, total_fees = 0, total_slippage = 0, total_realized = 0;
    for (const b of byMarketType) {
      n_trades += b.n_trades;
      n_contracts += b.n_contracts;
      total_edge     += b.edge     * b.n_contracts;
      total_variance += b.variance * b.n_contracts;
      total_fees     += b.fees     * b.n_contracts;
      total_slippage += b.slippage * b.n_contracts;
      total_realized += b.realized * b.n_contracts;
    }
    const denom = Math.max(n_contracts, 1);
    return {
      n_trades,
      n_contracts,
      mean_edge: total_edge / denom,
      mean_variance: total_variance / denom,
      mean_fees: total_fees / denom,
      mean_slippage: total_slippage / denom,
      mean_realized: total_realized / denom,
    };
  }, [byMarketType]);

  const waterfallData = useMemo(() => byMarketType.map((b) => ({
    market_type: b.market_type,
    edge: b.edge,
    fees: -Math.abs(b.fees),
    slippage: -Math.abs(b.slippage),
    variance: b.variance,    // signed; not stacked as a deduction
    realized: b.realized,
  })), [byMarketType]);

  const showAttribution = byMarketType.length > 0;

  return (
    <SectionFrame
      id="edge"
      invocation="Realized Edge"
      title="Realized Edge"
      subtitle="Two cuts of the same trade book.  Above the line: pure realized P&L from settlement, no closing-line dependency, populates the moment a trade settles.  Below: the closing-line decomposition that separates edge from variance from cost.  Reading the gap between the two tells you whether the model is finding edge or whether the dice are."
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {/* ─── Tier 1 — Pure realized P&L tiles ──────────────────────── */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div className="eyebrow" style={S.sectionEyebrow}>tier one</div>
          <div style={S.sectionTitle}>realized P&amp;L · all settled trades</div>
        </div>

        <div style={S.tileRow}>
          <Tile
            eyebrow="settled trades"
            value={fmtInt(realizedTotals.n_settled)}
            sub={`${fmtInt(realizedTotals.decisive)} decisive`}
          />
          <Tile
            eyebrow="net P&amp;L"
            value={fmtUSD(realizedTotals.pnl_net)}
            sub={`gross ${fmtUSD(realizedTotals.pnl_gross)}`}
            tone={realizedTotals.pnl_net > 0 ? 'positive' : realizedTotals.pnl_net < 0 ? 'negative' : 'neutral'}
          />
          <Tile
            eyebrow="ROI"
            value={realizedTotals.size > 0 ? `${(realizedTotals.roi * 100).toFixed(2)}%` : '—'}
            sub={realizedTotals.size > 0 ? `on ${fmtUSD(realizedTotals.size)} staked` : 'no stakes yet'}
            tone={realizedTotals.roi > 0 ? 'positive' : realizedTotals.roi < 0 ? 'negative' : 'neutral'}
          />
          <Tile
            eyebrow="win rate"
            value={realizedTotals.win_rate == null ? '—' : `${(realizedTotals.win_rate * 100).toFixed(1)}%`}
            sub={`${fmtInt(realizedTotals.n_won)}W · ${fmtInt(realizedTotals.n_lost)}L`}
          />
        </div>

        {realizedByMarket.length > 0 && (
          <div style={S.byMarketStrip}>
            {realizedByMarket.map((b) => (
              <MarketSplit key={b.market_type} bucket={b} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Tier 2 — Pipeline diagnostic (when attribution is empty) ── */}
      {!showAttribution && (
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div className="eyebrow" style={S.sectionEyebrow}>tier two</div>
            <div style={S.sectionTitle}>closing-line attribution · pipeline status</div>
          </div>
          <PipelineStatus counts={pipelineCounts} />
        </div>
      )}

      {/* ─── Tier 3 — Closing-line decomposition (when populated) ── */}
      {showAttribution && (
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div className="eyebrow" style={S.sectionEyebrow}>tier three</div>
            <div style={S.sectionTitle}>closing-line decomposition · per contract</div>
          </div>

          <div style={S.tileRow}>
            <Tile
              eyebrow="contracts attributed"
              value={fmtInt(attributionTotals.n_contracts)}
              sub={`${fmtInt(attributionTotals.n_trades)} trades`}
            />
            <Tile
              eyebrow="closing-line edge"
              value={fmtCents(attributionTotals.mean_edge)}
              sub="¢ / contract"
              tone="positive"
            />
            <Tile
              eyebrow="frictions"
              value={fmtCents(-(Math.abs(attributionTotals.mean_fees) + Math.abs(attributionTotals.mean_slippage)))}
              sub="¢ / contract · fees + slip"
              tone="negative"
            />
            <Tile
              eyebrow="net realized"
              value={fmtCents(attributionTotals.mean_realized)}
              sub="¢ / contract"
              tone={attributionTotals.mean_realized > 0 ? 'positive'
                   : attributionTotals.mean_realized < 0 ? 'negative' : 'neutral'}
            />
          </div>

          {/* Waterfall chart */}
          <div style={S.chartCard}>
            <ResponsiveContainer width="100%" height={Math.max(280, byMarketType.length * 76)}>
              <BarChart data={waterfallData} margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
                <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
                <XAxis dataKey="market_type"
                       tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--cloud-haze)' }}
                       stroke="var(--rule-mid)" />
                <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
                       stroke="var(--rule-mid)"
                       label={{
                         value: '¢ / contract',
                         angle: -90, position: 'insideLeft',
                         style: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' },
                       }} />
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
                <Bar dataKey="edge"     name="Edge"     fill="var(--dawn-gold)"    stackId="a" />
                <Bar dataKey="fees"     name="Fees"     fill="var(--storm-deep)"   stackId="a" />
                <Bar dataKey="slippage" name="Slippage" fill="var(--storm-violet)" stackId="a" />
                <Bar dataKey="realized" name="Realized" fill="var(--cloud-haze)"   stackId="b" />
              </BarChart>
            </ResponsiveContainer>
            <div style={S.legend}>
              <LegendDot color="var(--dawn-gold)"    label="closing-line edge" />
              <LegendDot color="var(--storm-deep)"   label="fees" />
              <LegendDot color="var(--storm-violet)" label="slippage" />
              <LegendDot color="var(--cloud-haze)"   label="realized P&amp;L" />
            </div>
          </div>

          {/* Per-market table */}
          <div style={S.tableCard}>
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
                {byMarketType.map((b, i) => (
                  <tr key={i} style={S.tbodyRow}>
                    <td style={S.tdLeft}>{b.market_type.toUpperCase()}</td>
                    <td style={S.tdRight}>{fmtInt(b.n_trades)}</td>
                    <td style={S.tdRight}>{fmtInt(b.n_contracts)}</td>
                    <td style={{ ...S.tdRight, color: 'var(--dawn-gold)' }}>{fmtCents(b.edge)}</td>
                    <td style={S.tdRight}>{fmtCents(b.variance)}</td>
                    <td style={{ ...S.tdRight, color: 'var(--storm-deep)' }}>{fmtCents(-Math.abs(b.fees))}</td>
                    <td style={{ ...S.tdRight, color: 'var(--storm-violet)' }}>{fmtCents(-Math.abs(b.slippage))}</td>
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
        </div>
      )}

      <p style={S.footnote}>
        Tier one is settler-truth: did the trade win or lose, and what did the books pay?
        Tier three is closing-line truth: did we get a price the market would later confirm?
        Edge is what the model promised under closing-line efficiency; variance is the
        binomial residual; fees are the fixed Kalshi vig; slippage is intent-vs-fill on live
        trades (zero on paper).  When tier-one realized P&amp;L diverges from
        tier-three edge, you're either being lucky or unlucky; statistical significance lives
        in the second column.
      </p>
    </SectionFrame>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function PipelineStatus({ counts }) {
  if (!counts) {
    return (
      <div style={S.empty}>
        Pipeline counts unavailable.  The dashboard query for{' '}
        <code style={S.code}>analytics.v_attribution_pipeline_counts</code>{' '}
        returned nothing — confirm migration 031 has been applied.
      </div>
    );
  }

  const stages = [
    { key: 'n_settled',                  label: 'settled',           caption: 'trades with a settlement record' },
    { key: 'n_with_closing_line',        label: 'closing line',      caption: 'closing-line capture attempted' },
    { key: 'n_with_orderbook_captured',  label: 'orderbook captured', caption: 'capture status = captured + non-empty book' },
    { key: 'n_in_attribution',           label: 'in attribution',    caption: 'derived closing mid is finite' },
  ];

  const max = Math.max(...stages.map((s) => Number(counts[s.key]) || 0), 1);

  return (
    <div style={S.pipelineCard}>
      <div style={S.pipelineFunnel}>
        {stages.map((s, i) => {
          const v = Number(counts[s.key]) || 0;
          const prev = i === 0 ? null : (Number(counts[stages[i - 1].key]) || 0);
          const drop = prev != null ? prev - v : null;
          const dropPct = (prev != null && prev > 0) ? (drop / prev) * 100 : null;
          return (
            <div key={s.key} style={S.pipelineStep}>
              <div style={S.pipelineStepHead}>
                <div className="eyebrow" style={S.pipelineStepLabel}>{s.label}</div>
                <div className="display-numeric" style={S.pipelineStepValue}>{fmtInt(v)}</div>
                <div style={S.pipelineStepCaption}>{s.caption}</div>
              </div>
              <div style={S.pipelineStepBarTrack}>
                <div style={{
                  ...S.pipelineStepBarFill,
                  width: `${(v / max) * 100}%`,
                  background: i === stages.length - 1 ? 'var(--dawn-gold)' : 'var(--sky-azure)',
                }} />
              </div>
              {drop != null && drop > 0 && (
                <div style={S.pipelineStepDrop}>
                  − {fmtInt(drop)} dropped <span style={{ color: 'var(--cloud-mute)' }}>({dropPct.toFixed(1)}%)</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p style={S.pipelineNote}>
        The closing-line decomposition needs all four stages.  The largest drop tells you
        which gate to fix.  Below the bot is producing trades and capturing closing lines;
        the attribution-stage drop is normal during the first hours after a fix lands while
        the materialized view catches up to the freshly-derivable rows.
      </p>
    </div>
  );
}

function MarketSplit({ bucket }) {
  const win_rate = bucket.n_decisive > 0 ? bucket.n_won / bucket.n_decisive : null;
  const roi = bucket.total_intent_size_usd > 0
    ? bucket.total_pnl_net / bucket.total_intent_size_usd
    : 0;
  return (
    <div style={S.splitCard}>
      <div style={S.splitMarket}>{bucket.market_type.toUpperCase()}</div>
      <div style={S.splitMain}>
        <div style={{ ...S.splitPnl, color: bucket.total_pnl_net > 0 ? 'var(--dawn-gold)' : bucket.total_pnl_net < 0 ? 'var(--storm-violet)' : 'var(--cloud-pearl)' }}>
          {fmtUSD(bucket.total_pnl_net)}
        </div>
        <div style={S.splitRoi}>
          {bucket.total_intent_size_usd > 0 ? `${(roi * 100).toFixed(2)}% ROI` : '—'}
        </div>
      </div>
      <div style={S.splitFooter}>
        <span style={{ color: 'var(--dawn-gold)' }}>{bucket.n_won}W</span>
        {' / '}
        <span style={{ color: 'var(--storm-violet)' }}>{bucket.n_lost}L</span>
        {win_rate != null && (
          <span style={S.splitWinRate}>· {(win_rate * 100).toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
}

function Tile({ eyebrow, value, sub, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}
           dangerouslySetInnerHTML={{ __html: eyebrow }} />
      <div className="display-numeric" style={{ ...S.tileValue, color: valueColor }}>
        {value}
      </div>
      {sub && (
        <div className="numeric" style={S.tileSub}
             dangerouslySetInnerHTML={{ __html: sub }} />
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
      <span style={{ width: 10, height: 10, background: color, display: 'inline-block', borderRadius: 1 }} />
      <span dangerouslySetInnerHTML={{ __html: label }} />
    </span>
  );
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtCents(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${Math.abs(v).toFixed(2)}¢`;
}
function fmtUSD(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(2)}`;
}

const S = {
  section: {
    marginBottom: 'var(--space-6)',
  },
  sectionHeader: {
    paddingBottom: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  sectionEyebrow: {
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-1)',
  },
  sectionTitle: {
    fontFamily: 'var(--font-headings, var(--font-display))',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
    letterSpacing: '0.01em',
  },

  tileRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  tile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    minHeight: 100,
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

  byMarketStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-3)',
  },
  splitCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4)',
  },
  splitMarket: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-1)',
  },
  splitMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 'var(--space-1)',
  },
  splitPnl: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    fontSize: 'var(--type-large)',
  },
  splitRoi: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
  },
  splitFooter: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
  },
  splitWinRate: {
    color: 'var(--cloud-haze)',
    marginLeft: 'var(--space-2)',
  },

  // Pipeline funnel
  pipelineCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
  },
  pipelineFunnel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },
  pipelineStep: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  pipelineStepHead: {
    display: 'grid',
    gridTemplateColumns: '120px 100px 1fr',
    gap: 'var(--space-3)',
    alignItems: 'baseline',
  },
  pipelineStepLabel: {
    color: 'var(--cloud-mute)',
  },
  pipelineStepValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
  },
  pipelineStepCaption: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  pipelineStepBarTrack: {
    height: 6,
    background: 'var(--ink-mid)',
    borderRadius: 'var(--radius-pill)',
    overflow: 'hidden',
  },
  pipelineStepBarFill: {
    height: '100%',
    transition: 'width var(--motion-glide)',
  },
  pipelineStepDrop: {
    fontSize: 'var(--type-micro)',
    color: 'var(--storm-violet)',
    fontFamily: 'var(--font-mono)',
    paddingLeft: 132,
  },
  pipelineNote: {
    marginTop: 'var(--space-4)',
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--rule-faint)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    lineHeight: 1.6,
  },

  empty: {
    padding: 'var(--space-5)',
    textAlign: 'center',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    lineHeight: 1.6,
  },
  code: {
    fontFamily: 'var(--font-mono)',
    fontStyle: 'normal',
    background: 'var(--ink-mid)',
    padding: '1px 6px',
    borderRadius: 3,
    color: 'var(--cloud-pearl)',
  },

  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
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

  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-4)',
    maxWidth: '72ch',
    lineHeight: 1.6,
  },
};
