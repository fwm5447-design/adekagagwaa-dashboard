'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * DecisionsRendered — analytics.mv_decisions_v2_funnel_30d.
 *
 * Counterpart to the Oracle: where the Oracle asks "was the bot's
 * confidence well-calibrated", this section asks "was the bot's
 * gatekeeper logic well-tuned".
 *
 * Source MV (migration 050, 2026-05-18): one row per
 * (decision_code, market_type) -- aggregated across distinct
 * (market_id, target_date) tuples where the engine's LATEST decision
 * was that code on that market type.  decision_code is 'TRADE' or
 * the first token of pass_reason (G3_CLI_BOUNDARY, G4_FEE_DEATH_ZONE,
 * G5_INSUFFICIENT_KELLY, etc. -- see core/decision/gates.py).
 *
 * Replaces the previous mv_signals_funnel_30d view (now deprecated)
 * which used the legacy SKIP_* codes from analyzer.analyze().
 *
 * Hierarchy:
 *
 *   1. Verdict — take rate + net realized pnl, severity-toned.
 *
 *   2. Breakdown tiles — total decisions / taken / skipped / realized.
 *
 *   3. Decision distribution — horizontal bars per (decision,
 *      market_type), colored by gate family (action / forecast /
 *      structure / cli / kelly / market / fees).
 *
 *   4. Threshold scrutiny — sortable table of PASS buckets ordered by
 *      regret_rate desc.  High regret_rate means the gate kept us out
 *      of bets the engine would have won; candidates for loosening.
 *      Low regret_rate means the gate correctly saved us from losers.
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
          // Strip both the legacy SKIP_ prefix (if any rows still
          // carry it during a transition window) and the v2 G#_ prefix
          // so the bar label is human-readable: 'CLI_BOUNDARY · high'
          label: `${decision.replace(/^(SKIP_|G\d_)/, '')} · ${r.market_type}`,
          n: Number(r.n_signals) || 0,
          n_taken: Number(r.n_taken) || 0,
          n_skipped: Number(r.n_skipped) || 0,
          mean_edge: Number(r.mean_edge_pct),   // aliased: actually p_lcb × 100
          mean_our:  Number(r.mean_our_prob),   // aliased: actually p_yes_cal
          mean_mkt:  Number(r.mean_market_prob),
          mean_conf: Number(r.mean_confidence),
          n_with_cf: Number(r.n_with_cf) || 0,
          cf_win:    Number(r.cf_win_rate),
          cf_pnl:    Number(r.cf_total_pnl),
          // v2-native fields for regret-based verdict
          n_regret_misses:       Number(r.n_regret_misses) || 0,
          n_resolved_for_regret: Number(r.n_resolved_for_regret) || 0,
          family,
        };
      })
      .sort((a, b) => b.n - a.n);
  }, [rows]);

  // ── PASS-only buckets, sorted by p_lcb desc (highest-conviction
  //    refusals first -- those are the loosening candidates).
  //    Under v2, decision codes are 'TRADE' or 'G1..G7' (or PASS_OTHER /
  //    G0_NO_FORECAST) -- everything that isn't TRADE is a pass.
  const skipScrutiny = useMemo(() => {
    return distribution
      .filter((d) => d.decision !== 'TRADE')
      .sort((a, b) => {
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
      subtitle="The gatekeeper layer.  Every (market, day) the engine evaluates ends in one decision — TRADE, or a named gate refusal (G1..G7).  This view is the gatekeeper's annual review: how often it acted, how often it withheld, and — critically — for each gate, how often the side it considered would actually have won (the regret rate).  Replaces the legacy SKIP_* funnel with the v2 decision pipeline (mig 050)."
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
                <FamilyKey family="forecast"  label="forecast (G1)" />
                <FamilyKey family="structure" label="signal quality (G2/G3)" />
                <FamilyKey family="market"    label="microstructure (G4)" />
                <FamilyKey family="kelly"     label="conviction (G5)" />
                <FamilyKey family="sizing"    label="portfolio (G6/G7)" />
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

          {/* ── 5. Gate scrutiny table ─────────────────────────────── */}
          <div style={S.tableCard}>
            <div style={S.tableHeader}>
              <div className="eyebrow" style={{ color: 'var(--cloud-haze)' }}>
                Gate scrutiny · sorted by p_lcb (highest-conviction refusals first)
              </div>
            </div>
            <table style={S.table}>
              <thead>
                <tr style={S.theadRow}>
                  <th style={S.thLeft}>Gate</th>
                  <th style={S.thLeft}>Market</th>
                  <th style={S.thRight}>n</th>
                  <th style={S.thRight}>p_lcb</th>
                  <th style={S.thRight}>p_cal</th>
                  <th style={S.thRight}>n resolved</th>
                  <th style={S.thRight}>regret %</th>
                  <th style={S.thRight}>verdict</th>
                </tr>
              </thead>
              <tbody>
                {skipScrutiny.length === 0 && (
                  <tr><td colSpan={8} style={S.tdEmpty}>No gate refusals in the window.</td></tr>
                )}
                {skipScrutiny.map((d, i) => {
                  const verdict = skipVerdict(d);
                  // mean_edge is aliased to (p_lcb × 100) in the v2
                  // query.  Convert back to a 0..1 fraction for display.
                  const pLcb = Number.isFinite(d.mean_edge) ? d.mean_edge / 100 : null;
                  const pCal = Number.isFinite(d.mean_our) ? d.mean_our : null;
                  const nRes = Number(d.n_resolved_for_regret) || 0;
                  const nMis = Number(d.n_regret_misses) || 0;
                  const regret = nRes > 0 ? nMis / nRes : null;
                  return (
                    <tr key={i} style={S.tbodyRow}>
                      <td style={S.tdLeft}>
                        <StatusPill value={d.decision} size="compact" />
                      </td>
                      <td style={{ ...S.tdLeft, color: 'var(--cloud-mute)' }}>
                        {d.market_type}
                      </td>
                      <td style={S.tdRight}>{fmtInt(d.n)}</td>
                      <td style={{ ...S.tdRight, color: lcbTone(pLcb).fg, fontWeight: 600 }}>
                        {pLcb != null ? `${(pLcb * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ ...S.tdRight, color: 'var(--cloud-mute)' }}>
                        {pCal != null ? pCal.toFixed(2) : '—'}
                      </td>
                      <td style={S.tdRight}>{nRes > 0 ? fmtInt(nRes) : '—'}</td>
                      <td style={{
                        ...S.tdRight,
                        color: regret == null
                          ? 'var(--cloud-shade)'
                          : regret >= 0.60 ? 'var(--coral-flare)'
                          : regret <= 0.40 ? '#7da78d'
                          : 'var(--cloud-haze)',
                        fontWeight: regret != null ? 600 : 400,
                      }}>
                        {regret != null ? `${(regret * 100).toFixed(0)}%` : '—'}
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
            One row above = one (market × day) the v2 engine evaluated.  The bot revisits the same
            market every ~2 minutes; only the <em>latest</em> decision counts (mig 050 dedup).
            <strong style={{ color: 'var(--cloud-haze)' }}> p_lcb</strong> on a gate row is the
            engine&rsquo;s 5%-LCB conviction on the side it considered — higher = more confident the
            engine wanted to bet, so the gate is a loosening candidate.
            <strong style={{ color: 'var(--cloud-haze)' }}> regret %</strong> is the fraction of resolved
            markets in this gate&rsquo;s bucket where the side the engine considered actually won.
            High regret = gate is over-cautious; low regret = gate is correctly saving us.
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
// Family classifier for the v2 gate set (G1..G7 + special cases).
// See core/decision/gates.py for the canonical gate definitions.
function familyOf(decision) {
  if (decision === 'TRADE')               return 'action';
  if (decision === 'G1_FORECAST_INVALID'
   || decision === 'G1_RECENT_TAIL_EVENT'
   || decision === 'G0_NO_FORECAST')      return 'forecast';   // predictor not trusted
  if (decision === 'G2_SIGMA_TOO_WIDE'
   || decision === 'G3_CLI_BOUNDARY'
   || decision === 'G3_DEGENERATE_SIGMA') return 'structure';  // signal-quality refusals
  if (decision === 'G4_FEE_DEATH_ZONE'
   || decision === 'G4_NO_QUOTES')        return 'market';     // microstructure
  if (decision === 'G5_INSUFFICIENT_KELLY'
   || decision === 'G5_NEGATIVE_KELLY_BOTH_SIDES'
   || decision === 'PASS_OTHER')          return 'kelly';      // conviction floor
  if (decision === 'G6_BOOK_DEPTH'
   || decision === 'G7_PER_CITY_CAP')     return 'sizing';     // post-bet portfolio checks
  return 'other';
}

function colorOfFamily(family) {
  switch (family) {
    case 'action':    return 'var(--dawn-gold)';
    case 'forecast':  return 'var(--cloud-shade)';   // predictor (G1)
    case 'structure': return 'var(--storm-violet)';  // signal quality (G2/G3)
    case 'market':    return 'var(--sky-mist)';      // microstructure (G4)
    case 'kelly':     return 'var(--storm-deep)';    // conviction (G5)
    case 'sizing':    return 'var(--sky-azure)';     // portfolio (G6/G7)
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

// Tone for p_lcb (0..1) in the v2 scrutiny table.  High p_lcb on a
// PASS row means the engine had strong conviction it should bet --
// suspicious if the gate kept us out.  Mirrors edgeTone but at the
// probability scale appropriate for the v2 calibrated output.
function lcbTone(p) {
  if (!Number.isFinite(p)) return { fg: 'var(--cloud-shade)' };
  if (p >= 0.65) return { fg: 'var(--coral-flare)' };  // very confident → loosen
  if (p >= 0.55) return { fg: 'var(--dawn-amber)' };
  if (p >= 0.45) return { fg: 'var(--cloud-haze)' };
  return            { fg: 'var(--cloud-mute)' };
}

// "Verdict" for a PASS bucket in the scrutiny table.  Driven by
// regret_rate (the fraction of PASS rows where the considered side
// actually won the underlying market).  Falls back to p_lcb when
// not enough resolved markets exist yet.
//
//   regret_rate >= 0.60   → over-cautious  (gate is killing winners)
//   regret_rate <= 0.40   → well-saved     (gate is saving us from losers)
//   else                  → threshold-correct
//
// When regret_rate is null (no resolved markets yet) we still classify
// by avg_p_lcb -- high p_lcb on a PASS means the engine had strong
// conviction it should bet, so the gate is borderline candidate-for-
// loosening.
function skipVerdict(d) {
  const nRes = Number(d.n_resolved_for_regret) || 0;
  const nMiss = Number(d.n_regret_misses) || 0;
  const regretRate = nRes > 0 ? nMiss / nRes : null;
  const lcb = Number.isFinite(d.mean_edge) ? d.mean_edge / 100 : null;
  // mean_edge here = avg_p_lcb × 100 (aliased in SQL), so dividing
  // by 100 recovers p_lcb in [0, 1].
  if (regretRate != null) {
    if (regretRate >= 0.60) {
      return { label: 'over-cautious', color: 'var(--coral-flare)' };
    }
    if (regretRate <= 0.40) {
      return { label: 'well-saved', color: '#7da78d' };
    }
    return { label: 'threshold-correct', color: 'var(--cloud-haze)' };
  }
  // No regret data yet (gate hasn't been resolved against any market).
  if (lcb != null && lcb >= 0.55) {
    return { label: 'borderline · awaiting data', color: 'var(--dawn-amber)' };
  }
  if (lcb != null && lcb < 0.30) {
    return { label: 'low conviction', color: 'var(--cloud-mute)' };
  }
  return { label: '—', color: 'var(--cloud-shade)' };
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
