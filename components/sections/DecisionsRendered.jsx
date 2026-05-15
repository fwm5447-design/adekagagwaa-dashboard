'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * DecisionsRendered — analytics.mv_signals_funnel_30d (dedup'd in
 * migration 040).
 *
 * Counterpart to the Oracle: where the Oracle asks "was the bot's
 * confidence well-calibrated", this section asks "was the bot's
 * gatekeeper logic well-tuned".
 *
 * One row in the source MV per (decision, market_type) — aggregated
 * across all distinct (market_id, target_date) tuples for which the
 * bot's LATEST decision was that code on that market type.  n_signals
 * is the count of those distinct decisions (3,200 over 30d on May
 * 2026), NOT the raw signal-emission count (which inflates 100-200×).
 *
 * Hierarchy:
 *
 *   1. Verdict — take rate + net realized pnl, severity-toned.
 *
 *   2. Breakdown tiles — total decisions / taken / skipped / realized.
 *
 *   3. Decision distribution — horizontal bars per (decision,
 *      market_type), colored by skip-family (action / edge / structure
 *      / disagreement / data-quality / model-quality).
 *
 *   4. Threshold scrutiny — sortable table of SKIP buckets ordered by
 *      mean_edge_pct desc.  Buckets with high mean edge are
 *      candidates for threshold loosening; buckets with low edge are
 *      threshold-correct.
 *
 *   5. Trade outcomes — focused TRADE-decision summary with realized
 *      win rate and pnl per market_type.
 */
export default function DecisionsRendered({ rows = [], freshness }) {
  // ── Top-line aggregates ──────────────────────────────────────────
  const totals = useMemo(() => {
    let nDecisions = 0;
    let nTaken     = 0;
    let nSkipped   = 0;
    let cfPnl      = 0;
    let cfWinsW    = 0;  // sum(cf_win_rate × n_with_cf), for weighted avg
    let cfDecsW    = 0;
    for (const r of rows) {
      nDecisions += Number(r.n_signals) || 0;
      nTaken     += Number(r.n_taken)   || 0;
      nSkipped   += Number(r.n_skipped) || 0;
      const cf = Number(r.cf_total_pnl);
      if (Number.isFinite(cf)) cfPnl += cf;
      const wr = Number(r.cf_win_rate);
      const nw = Number(r.n_with_cf) || 0;
      if (Number.isFinite(wr) && nw > 0) {
        cfWinsW += wr * nw;
        cfDecsW += nw;
      }
    }
    return {
      nDecisions, nTaken, nSkipped,
      takeRate: nDecisions > 0 ? nTaken / nDecisions : null,
      cfPnl,
      winRate: cfDecsW > 0 ? cfWinsW / cfDecsW : null,
    };
  }, [rows]);

  // ── Distribution data (one entry per row, sorted by volume desc) ──
  const distribution = useMemo(() => {
    return [...rows]
      .filter((r) => Number(r.n_signals) > 0)
      .map((r) => {
        const decision = String(r.decision || '?');
        const family   = familyOf(decision);
        return {
          decision,
          market_type: String(r.market_type || '?'),
          label: `${decision.replace(/^SKIP_/, '')} · ${r.market_type}`,
          n: Number(r.n_signals) || 0,
          n_taken: Number(r.n_taken) || 0,
          n_skipped: Number(r.n_skipped) || 0,
          mean_edge: Number(r.mean_edge_pct),
          mean_our:  Number(r.mean_our_prob),
          mean_mkt:  Number(r.mean_market_prob),
          mean_conf: Number(r.mean_confidence),
          n_with_cf: Number(r.n_with_cf) || 0,
          cf_win:    Number(r.cf_win_rate),
          cf_pnl:    Number(r.cf_total_pnl),
          family,
        };
      })
      .sort((a, b) => b.n - a.n);
  }, [rows]);

  // ── Skip-only buckets, sorted by mean_edge desc (over-cautious first)
  const skipScrutiny = useMemo(() => {
    return distribution
      .filter((d) => d.decision.startsWith('SKIP'))
      .sort((a, b) => {
        // NULL edge_pct (data-quality skips) sort to the bottom.
        const ae = Number.isFinite(a.mean_edge) ? a.mean_edge : -Infinity;
        const be = Number.isFinite(b.mean_edge) ? b.mean_edge : -Infinity;
        return be - ae;
      });
  }, [distribution]);

  // ── Trade-only buckets (for the realized outcome strip)
  const tradeBuckets = useMemo(() => {
    return distribution
      .filter((d) => d.decision === 'TRADE')
      .sort((a, b) => a.market_type.localeCompare(b.market_type));
  }, [distribution]);

  const hasData = totals.nDecisions > 0;

  return (
    <SectionFrame
      id="decisions"
      invocation="Decisions Rendered & Withheld"
      title="Decisions Rendered & Withheld"
      subtitle="The gatekeeper layer.  Every (market, day) the analyzer evaluates ends in one decision — take, or one of a dozen named refusals.  This view is the gatekeeper's annual review: how often it acted, how often it withheld, and whether the trades that survived its gates made money."
      freshnessAt={freshness}
      freshnessCadenceSec={3600 /* hourly refresh */}
    >
      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* ── 1. Verdict ──────────────────────────────────────────── */}
          <Verdict totals={totals} />

          {/* ── 2. KPI tiles ───────────────────────────────────────── */}
          <div style={S.tileGrid}>
            <Tile
              eyebrow="decisions"
              value={fmtInt(totals.nDecisions)}
              sub="market × day tuples · 30d"
              tone="neutral"
            />
            <Tile
              eyebrow="acted"
              value={fmtInt(totals.nTaken)}
              sub={`${pct(totals.takeRate)} take rate`}
              tone="positive"
            />
            <Tile
              eyebrow="withheld"
              value={fmtInt(totals.nSkipped)}
              sub={`${pct(1 - totals.takeRate)} skipped`}
              tone="neutral"
            />
            <Tile
              eyebrow="realized · gates passed"
              value={fmtSignedDollar(totals.cfPnl)}
              sub={totals.winRate != null ? `${pct(totals.winRate)} win rate` : '—'}
              tone={totals.cfPnl > 0 ? 'positive' : totals.cfPnl < 0 ? 'negative' : 'neutral'}
            />
          </div>

          {/* ── 3. Distribution ────────────────────────────────────── */}
          <div style={S.chartCard}>
            <div style={S.chartHeader}>
              <div className="eyebrow">Decisions by reason × market type · last 30 days</div>
              <div style={S.legend}>
                <FamilyKey family="action"    label="trade" />
                <FamilyKey family="edge"      label="edge gate" />
                <FamilyKey family="structure" label="market structure" />
                <FamilyKey family="disagree"  label="model disagreement" />
                <FamilyKey family="model"     label="model quality" />
                <FamilyKey family="data"      label="missing data" />
              </div>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(320, distribution.length * 22)}>
              <BarChart
                data={distribution}
                layout="vertical"
                margin={{ top: 8, right: 32, bottom: 24, left: 8 }}
              >
                <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" horizontal={false} />
                <XAxis
                  type="number"
                  tick={S.axisTick}
                  stroke="var(--rule-mid)"
                  label={{
                    value: 'DECISIONS (MARKET × DAY)',
                    position: 'insideBottom',
                    offset: -8,
                    style: S.axisLabel,
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ ...S.axisTick, fill: 'var(--cloud-haze)' }}
                  stroke="var(--rule-mid)"
                  width={220}
                />
                <Tooltip
                  cursor={{ fill: 'var(--rule-faint)' }}
                  content={<DistributionTooltip />}
                />
                <Bar dataKey="n" name="decisions" isAnimationActive={false}>
                  {distribution.map((d, i) => (
                    <Cell key={i} fill={colorOfFamily(d.family)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── 4. Trade outcomes ──────────────────────────────────── */}
          {tradeBuckets.length > 0 && (
            <div style={S.chartCard}>
              <div style={S.chartHeader}>
                <div className="eyebrow">When the gate said TRADE</div>
              </div>
              <div style={S.tradeRow}>
                {tradeBuckets.map((t) => (
                  <TradeBucket key={t.market_type} bucket={t} />
                ))}
              </div>
            </div>
          )}

          {/* ── 5. Skip scrutiny table ─────────────────────────────── */}
          <div style={S.tableCard}>
            <div style={S.tableHeader}>
              <div className="eyebrow" style={{ color: 'var(--cloud-haze)' }}>
                Skip thresholds · sorted by mean edge (over-cautious first)
              </div>
            </div>
            <table style={S.table}>
              <thead>
                <tr style={S.theadRow}>
                  <th style={S.thLeft}>Reason</th>
                  <th style={S.thLeft}>Market</th>
                  <th style={S.thRight}>n</th>
                  <th style={S.thRight}>mean edge</th>
                  <th style={S.thRight}>our P / mkt P</th>
                  <th style={S.thRight}>n w/ position</th>
                  <th style={S.thRight}>realized</th>
                  <th style={S.thRight}>verdict</th>
                </tr>
              </thead>
              <tbody>
                {skipScrutiny.length === 0 && (
                  <tr><td colSpan={8} style={S.tdEmpty}>No skip decisions in the window.</td></tr>
                )}
                {skipScrutiny.map((d, i) => {
                  const verdict = skipVerdict(d);
                  return (
                    <tr key={i} style={S.tbodyRow}>
                      <td style={S.tdLeft}>
                        <StatusPill value={d.decision} size="compact" />
                      </td>
                      <td style={{ ...S.tdLeft, color: 'var(--cloud-mute)' }}>
                        {d.market_type}
                      </td>
                      <td style={S.tdRight}>{fmtInt(d.n)}</td>
                      <td style={{ ...S.tdRight, color: edgeTone(d.mean_edge).fg, fontWeight: 600 }}>
                        {Number.isFinite(d.mean_edge) ? `${d.mean_edge.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ ...S.tdRight, color: 'var(--cloud-mute)' }}>
                        {Number.isFinite(d.mean_our) ? d.mean_our.toFixed(2) : '—'}
                        {' / '}
                        {Number.isFinite(d.mean_mkt) ? d.mean_mkt.toFixed(2) : '—'}
                      </td>
                      <td style={S.tdRight}>{d.n_with_cf > 0 ? fmtInt(d.n_with_cf) : '—'}</td>
                      <td style={{
                        ...S.tdRight,
                        color: Number.isFinite(d.cf_pnl)
                          ? (d.cf_pnl > 0 ? 'var(--dawn-gold)' : d.cf_pnl < 0 ? 'var(--storm-violet)' : 'var(--cloud-mute)')
                          : 'var(--cloud-shade)',
                        fontWeight: Number.isFinite(d.cf_pnl) && d.cf_pnl !== 0 ? 600 : 400,
                      }}>
                        {Number.isFinite(d.cf_pnl) ? fmtSignedDollar(d.cf_pnl) : '—'}
                      </td>
                      <td style={{ ...S.tdRight }}>
                        <span style={{
                          color: verdict.color,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--type-micro)',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                        }}>
                          {verdict.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Footnote ───────────────────────────────────────────── */}
          <div style={S.footnote}>
            One row above = one (market × day) the analyzer evaluated.  The bot may revisit the same
            market every ~2 minutes; only the <em>latest</em> decision counts (mig 040 fix).
            &ldquo;Realized&rdquo; is the actual pnl on trades opened against this market×day — for
            SKIP rows that&rsquo;s the regret pnl of positions opened under an earlier TRADE decision then
            flipped to skip.  <strong style={{ color: 'var(--cloud-haze)' }}>Mean edge</strong> on a
            SKIP row is the model&rsquo;s view of the edge it left on the table; high values are
            candidates for loosening the corresponding threshold.
          </div>
        </>
      )}
    </SectionFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Verdict — the one-line headline.
// ─────────────────────────────────────────────────────────────────────
function Verdict({ totals }) {
  const tr = totals.takeRate;
  const pnl = totals.cfPnl;
  const tone = verdictTone(tr, pnl);
  const headline =
    tr == null ? 'NO DECISIONS' :
    tr < 0.05  ? 'OVER-CAUTIOUS' :
    tr > 0.50  ? 'PROMISCUOUS' :
    pnl < 0    ? 'GATES UNDERWATER' :
    pnl > 0    ? 'GATES POSITIVE' :
                 'BREAKEVEN';
  return (
    <div style={{ ...S.verdictCard, borderColor: tone.border, background: tone.bg }}>
      <div style={S.verdictInner}>
        <div style={S.verdictLabelBlock}>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
            Verdict · last 30 days
          </div>
          <span style={{ ...S.verdictBadge, color: tone.fg, borderColor: tone.border, background: tone.bg }}>
            {headline}
          </span>
          <div style={S.verdictNarrative}>
            Bot acted on <em style={{ color: 'var(--cloud-haze)' }}>{fmtInt(totals.nTaken)}</em>
            {' of '}
            <em style={{ color: 'var(--cloud-haze)' }}>{fmtInt(totals.nDecisions)}</em>
            {' market days · realized '}
            <em style={{ color: tone.fg }}>{fmtSignedDollar(pnl)}</em>
            {totals.winRate != null && (
              <span style={{ color: 'var(--cloud-mute)' }}> · {pct(totals.winRate)} win rate</span>
            )}
          </div>
        </div>
        <div style={S.verdictNumberBlock}>
          <div className="display-numeric" style={{ ...S.verdictNumber, color: tone.fg }}>
            {tr != null ? `${(tr * 100).toFixed(1)}%` : '—'}
          </div>
          <div style={S.verdictNumberSub}>take rate</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TradeBucket — TRADE-decision summary card per market_type.
// ─────────────────────────────────────────────────────────────────────
function TradeBucket({ bucket }) {
  const succeedRate = bucket.n > 0 ? bucket.n_taken / bucket.n : null;
  const cfPnl = Number.isFinite(bucket.cf_pnl) ? bucket.cf_pnl : 0;
  const winRate = Number.isFinite(bucket.cf_win) ? bucket.cf_win : null;
  return (
    <div style={S.tradeCard}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
        TRADE · {bucket.market_type}
      </div>
      <div className="display-numeric" style={{
        ...S.tradeValue,
        color: cfPnl > 0 ? 'var(--dawn-gold)' : cfPnl < 0 ? 'var(--storm-violet)' : 'var(--cloud-pearl)',
      }}>
        {fmtSignedDollar(cfPnl)}
      </div>
      <div style={S.tradeMeta}>
        <span style={S.tradeMetaItem}>
          <span style={S.tradeMetaLabel}>n</span>
          <span style={S.tradeMetaValue}>{fmtInt(bucket.n)}</span>
        </span>
        <span style={S.tradeMetaItem}>
          <span style={S.tradeMetaLabel}>open rate</span>
          <span style={S.tradeMetaValue}>{pct(succeedRate)}</span>
        </span>
        <span style={S.tradeMetaItem}>
          <span style={S.tradeMetaLabel}>win rate</span>
          <span style={S.tradeMetaValue}>{pct(winRate)}</span>
        </span>
        <span style={S.tradeMetaItem}>
          <span style={S.tradeMetaLabel}>mean edge</span>
          <span style={S.tradeMetaValue}>
            {Number.isFinite(bucket.mean_edge) ? `${bucket.mean_edge.toFixed(1)}%` : '—'}
          </span>
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tile — KPI card.
// ─────────────────────────────────────────────────────────────────────
function Tile({ eyebrow, value, sub, tone = 'neutral' }) {
  const color =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{eyebrow}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color }}>{value}</div>
      {sub && <div style={S.tileSub}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Legend key for the family palette.
// ─────────────────────────────────────────────────────────────────────
function FamilyKey({ family, label }) {
  return (
    <span style={S.legendItem}>
      <span style={{
        display: 'inline-block', width: 10, height: 10,
        background: colorOfFamily(family), borderRadius: 1,
      }} />
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Distribution tooltip.
// ─────────────────────────────────────────────────────────────────────
function DistributionTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={S.tooltipBox}>
      <div style={{ ...S.tooltipHeader, color: colorOfFamily(d.family) }}>
        {d.decision} · {d.market_type}
      </div>
      <TooltipRow label="decisions" value={fmtInt(d.n)} />
      <TooltipRow label="opened" value={`${fmtInt(d.n_taken)} (${pct(d.n_taken / Math.max(d.n,1))})`} />
      <TooltipRow label="mean edge"
        value={Number.isFinite(d.mean_edge) ? `${d.mean_edge.toFixed(2)}%` : '—'}
        valueColor={edgeTone(d.mean_edge).fg}
      />
      <TooltipRow label="our P / mkt P"
        value={`${Number.isFinite(d.mean_our) ? d.mean_our.toFixed(3) : '—'} / ${Number.isFinite(d.mean_mkt) ? d.mean_mkt.toFixed(3) : '—'}`}
      />
      {Number.isFinite(d.cf_pnl) && d.n_with_cf > 0 && (
        <TooltipRow label="realized"
          value={fmtSignedDollar(d.cf_pnl)}
          valueColor={d.cf_pnl > 0 ? 'var(--dawn-gold)' : d.cf_pnl < 0 ? 'var(--storm-violet)' : 'var(--cloud-pearl)'}
        />
      )}
    </div>
  );
}

function TooltipRow({ label, value, valueColor }) {
  return (
    <div style={S.tooltipRow}>
      <span style={S.tooltipLabel}>{label}</span>
      <span style={{ ...S.tooltipValue, color: valueColor ?? 'var(--cloud-pearl)' }}>{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={S.empty}>
      <div style={S.emptyTitle}>The gatekeeper sleeps</div>
      <div style={S.emptySub}>
        No decisions in the last 30 days.  Once the analyzer evaluates markets the funnel will populate.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — semantics
// ─────────────────────────────────────────────────────────────────────

// Map decision codes to a small set of semantic families.  Drives
// palette and legend grouping.  Families are visual categories, NOT
// the same as the underlying skip-reason taxonomy in the analyzer.
function familyOf(decision) {
  if (decision === 'TRADE') return 'action';
  if (decision === 'SKIP_BRACKET_EDGE'
   || decision === 'SKIP_BRACKET_SPREAD'
   || decision === 'SKIP_IN_SPREAD') return 'edge';
  if (decision === 'SKIP_LIQUIDITY_GRADED'
   || decision === 'SKIP_TAIL_MARKET') return 'structure';
  if (decision === 'SKIP_ENSEMBLE_SPREAD'
   || decision === 'SKIP_DISAGREEMENT_HARD'
   || decision === 'SKIP_BLEND_DISAGREE'
   || decision === 'SKIP_MARKET_MODEL_DISAGREE') return 'disagree';
  if (decision === 'SKIP_CLI_BOUNDARY'
   || decision === 'SKIP_GRADE_F') return 'model';
  if (decision === 'SKIP_NO_FORECAST'
   || decision === 'SKIP_INTRADAY_BIN_COLLAPSED'
   || decision === 'SKIP_GAUSSIAN_FLOOR') return 'data';
  return 'other';
}

function colorOfFamily(family) {
  switch (family) {
    case 'action':    return 'var(--dawn-gold)';
    case 'edge':      return 'var(--sky-mist)';
    case 'structure': return 'var(--storm-violet)';
    case 'disagree':  return 'var(--sky-azure)';
    case 'model':     return 'var(--storm-deep)';
    case 'data':      return 'var(--cloud-shade)';
    default:          return 'var(--cloud-mute)';
  }
}

// Tone selector for the verdict tile.
function verdictTone(tr, pnl) {
  if (tr == null) {
    return { fg: 'var(--cloud-shade)', bg: 'rgba(245,241,232,0.04)', border: 'rgba(245,241,232,0.10)' };
  }
  if (tr < 0.05 || tr > 0.50) {
    // Off-balance gatekeeper — too cautious or too loose.
    return { fg: 'var(--storm-violet)', bg: 'var(--storm-haze)', border: 'rgba(107,77,142,0.40)' };
  }
  if (pnl > 50) {
    // Selective AND profitable.
    return { fg: 'var(--dawn-gold)', bg: 'rgba(212,164,74,0.08)', border: 'rgba(212,164,74,0.30)' };
  }
  if (pnl < -50) {
    return { fg: 'var(--coral-flare)', bg: 'var(--coral-haze)', border: 'rgba(194,84,80,0.40)' };
  }
  return { fg: 'var(--cloud-haze)', bg: 'rgba(245,241,232,0.04)', border: 'rgba(245,241,232,0.16)' };
}

// Tone for a single mean_edge_pct value in the skip scrutiny table.
// High edge on a SKIP is suspicious (over-cautious threshold).
function edgeTone(e) {
  if (!Number.isFinite(e)) return { fg: 'var(--cloud-shade)' };
  if (e >= 20) return { fg: 'var(--coral-flare)' };
  if (e >= 10) return { fg: 'var(--dawn-amber)' };
  if (e >= 5)  return { fg: 'var(--cloud-haze)' };
  return        { fg: 'var(--cloud-mute)' };
}

// "Verdict" for a skip bucket in the scrutiny table.  Combines mean
// edge with realized cf_pnl to label the threshold as well-saved,
// over-cautious, etc.
function skipVerdict(d) {
  const e = Number.isFinite(d.mean_edge) ? d.mean_edge : null;
  const pnl = Number.isFinite(d.cf_pnl) ? d.cf_pnl : null;
  if (e == null && pnl == null) {
    return { label: '—', color: 'var(--cloud-shade)' };
  }
  if (e != null && e >= 15) {
    return { label: 'over-cautious', color: 'var(--coral-flare)' };
  }
  if (e != null && e >= 8) {
    return { label: 'borderline', color: 'var(--dawn-amber)' };
  }
  if (pnl != null && pnl < -50) {
    return { label: 'well-saved', color: '#7da78d' };
  }
  if (e != null && e < 5) {
    return { label: 'threshold-correct', color: 'var(--cloud-haze)' };
  }
  return { label: 'wash', color: 'var(--cloud-mute)' };
}

// ─────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────
function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtSignedDollar(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '$0.00';
  const sign = n > 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const S = {
  // ── Verdict ────────────────────────────────────────────────────
  verdictCard: {
    border: '1px solid',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    marginBottom: 'var(--space-5)',
    transition: 'all var(--motion-glide)',
  },
  verdictInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)',
    flexWrap: 'wrap',
  },
  verdictLabelBlock: {
    flex: '1 1 320px',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  verdictBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    border: '1px solid',
    borderRadius: 'var(--radius-pill)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    width: 'fit-content',
  },
  verdictNarrative: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-base)',
    color: 'var(--cloud-haze)',
    lineHeight: 1.5,
    fontStyle: 'italic',
    maxWidth: '60ch',
  },
  verdictNumberBlock: {
    textAlign: 'right',
    flexShrink: 0,
  },
  verdictNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-oracle)',
    fontWeight: 500,
    lineHeight: 0.95,
    letterSpacing: '-0.02em',
  },
  verdictNumberSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginTop: 'var(--space-2)',
  },

  // ── KPI tiles ──────────────────────────────────────────────────
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-5)',
  },
  tile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    minHeight: 104,
  },
  tileValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-display)',
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: '-0.01em',
  },
  tileSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.02em',
  },

  // ── Chart cards ────────────────────────────────────────────────
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4) var(--space-5) var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-3)',
    flexWrap: 'wrap',
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },

  // ── Trade bucket cards ─────────────────────────────────────────
  tradeRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 'var(--space-3)',
  },
  tradeCard: {
    background: 'var(--ink-mid)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  tradeValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-display)',
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: '-0.01em',
  },
  tradeMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-4)',
  },
  tradeMetaItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  tradeMetaLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  tradeMetaValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-base)',
    color: 'var(--cloud-haze)',
    fontVariantNumeric: 'tabular-nums',
  },

  // ── Axes ───────────────────────────────────────────────────────
  axisTick: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fill: 'var(--cloud-mute)',
  },
  axisLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fill: 'var(--cloud-mute)',
    letterSpacing: '0.10em',
  },

  // ── Skip scrutiny table ────────────────────────────────────────
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    overflowX: 'auto',
    marginBottom: 'var(--space-4)',
  },
  tableHeader: {
    padding: 'var(--space-3) var(--space-4)',
    borderTop: '2px solid var(--sky-mist)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
  },
  theadRow: { borderBottom: '1px solid var(--rule-mid)' },
  thLeft: {
    textAlign: 'left', padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-mute)', fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.10em',
  },
  thRight: {
    textAlign: 'right', padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-mute)', fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.10em',
  },
  tbodyRow: { borderBottom: '1px solid var(--rule-faint)' },
  tdLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-pearl)',
    fontVariantNumeric: 'tabular-nums',
  },
  tdRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-haze)',
    fontVariantNumeric: 'tabular-nums',
  },
  tdEmpty: {
    textAlign: 'center',
    padding: 'var(--space-5)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
  },

  // ── Tooltip ────────────────────────────────────────────────────
  tooltipBox: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 4,
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--cloud-pearl)',
    minWidth: 220,
    boxShadow: 'var(--shadow-card)',
  },
  tooltipHeader: {
    fontWeight: 600,
    letterSpacing: '0.06em',
    paddingBottom: 'var(--space-2)',
    marginBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--rule-faint)',
    textTransform: 'uppercase',
  },
  tooltipRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    lineHeight: 1.6,
  },
  tooltipLabel: {
    color: 'var(--cloud-mute)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontSize: 10,
  },
  tooltipValue: {
    fontVariantNumeric: 'tabular-nums',
  },

  // ── Empty state ────────────────────────────────────────────────
  empty: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-7)',
    textAlign: 'center',
  },
  emptyTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-haze)',
    marginBottom: 'var(--space-2)',
  },
  emptySub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '46ch',
    lineHeight: 1.6,
    margin: '0 auto',
  },

  // ── Footnote ───────────────────────────────────────────────────
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '78ch',
    lineHeight: 1.7,
    marginTop: 'var(--space-2)',
  },
};
