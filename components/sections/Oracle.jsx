'use client';

import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import BarometricNeedle from '../primitives/BarometricNeedle';

/**
 * Oracle — calibration reliability surface (bet-side aware).
 *
 * Migration 027 (2026-05-04) shipped mv_calibration_buckets_win,
 * which buckets trades by predicted probability of THE TRADE WINNING
 * (which differs by bet_side) rather than predicted probability of
 * YES winning.  This is the correct reliability-diagram input — a
 * confident NO bet (our_prob_cal=0.04, bet_side=NO) now lands at
 * predicted_mean ~0.96 (top decile), where empirical 0.7 reads
 * correctly as "overconfident NO bet" rather than the old MV's
 * "predicted 0.04 / empirical 0.70" reading that conflated a
 * confident-NO position with a confident-YES prediction.
 *
 * Render layers:
 *
 *   1. Three barometric needles (one per market_type) showing
 *      sample-weighted divergence between predicted_mean and
 *      empirical_mean.  Aggregates across both bet_sides.  Zero
 *      divergence = perfectly calibrated.  Positive = under-predict
 *      (empirical higher than predicted).  Negative = over-predict.
 *
 *   2. Two barometric needles (YES / NO) showing the same divergence
 *      stat aggregated by bet_side rather than by market_type.
 *      Surfaces YES↔NO calibration asymmetry.  This is the new
 *      Phase D signal — when one side is more miscalibrated than
 *      the other, you see it here.
 *
 *   3. Reliability scatter: predicted_mean (x) vs empirical_mean
 *      (y), one dot per (day, decile, market_type, bet_side).
 *      Identity line = perfect calibration.  Color-coded by
 *      market_type (high/low/rainm).  Dot size ∝ n_trades.
 *      Tooltip carries bet_side so you can read individual dots.
 *
 *   4. Two decile rollup tables side-by-side: YES bets and NO bets
 *      separately.  Splitting is more informative than the old
 *      combined table because YES and NO bets cluster in different
 *      deciles (YES low, NO high).
 */
export default function Oracle({ rows = [], freshness }) {
  // Bucket the rows by market_type for the three needles.
  const byMarketType = useMemo(() => {
    const out = { high: [], low: [], rainm: [] };
    for (const r of rows) {
      if (r.market_type && out[r.market_type]) {
        out[r.market_type].push(r);
      }
    }
    return out;
  }, [rows]);

  // Bucket the rows by bet_side for the two new needles.
  const byBetSide = useMemo(() => {
    const out = { YES: [], NO: [] };
    for (const r of rows) {
      if (r.bet_side && out[r.bet_side]) {
        out[r.bet_side].push(r);
      }
    }
    return out;
  }, [rows]);

  // Sample-weighted mean divergence (empirical - predicted).
  // Pure helper — same shape as the original component's inline
  // calculation, factored out so we can reuse it for the bet_side
  // needles.
  const computeDivergence = (mtRows) => {
    let totalN = 0;
    let weightedDiv = 0;
    for (const r of mtRows) {
      const n = Number(r.n_trades) || 0;
      const pred = Number(r.predicted_mean);
      const emp = Number(r.empirical_mean);
      if (Number.isFinite(pred) && Number.isFinite(emp) && n > 0) {
        weightedDiv += n * (emp - pred);
        totalN += n;
      }
    }
    return totalN > 0 ? { div: weightedDiv / totalN, n: totalN } : null;
  };

  const divergenceByType = useMemo(() => {
    const out = {};
    for (const [mt, mtRows] of Object.entries(byMarketType)) {
      out[mt] = computeDivergence(mtRows);
    }
    return out;
  }, [byMarketType]);

  const divergenceByBetSide = useMemo(() => {
    const out = {};
    for (const [bs, bsRows] of Object.entries(byBetSide)) {
      out[bs] = computeDivergence(bsRows);
    }
    return out;
  }, [byBetSide]);

  // Scatter data — flat list with bet_side carried for the tooltip.
  const scatter = useMemo(() => {
    return rows
      .filter((r) =>
        Number.isFinite(Number(r.predicted_mean)) &&
        Number.isFinite(Number(r.empirical_mean)) &&
        Number(r.n_trades) > 0
      )
      .map((r) => ({
        x: Number(r.predicted_mean),
        y: Number(r.empirical_mean),
        z: Number(r.n_trades),
        market_type: r.market_type,
        bet_side: r.bet_side,
        prob_decile: r.prob_decile,
      }));
  }, [rows]);

  // Per-decile rollup, split by bet_side.  Same aggregation logic
  // as before but partitioned: YES bets cluster in low deciles
  // (predicted 0.1-0.3, empirical near 0), NO bets cluster in high
  // deciles (predicted 0.85-0.96, empirical 0.6-0.85).  Splitting
  // surfaces the asymmetry that a combined table would smooth out.
  const computeDecileRollup = (filteredRows) => {
    const buckets = new Map();
    for (const r of filteredRows) {
      const d = r.prob_decile;
      const n = Number(r.n_trades) || 0;
      const pred = Number(r.predicted_mean);
      const emp = Number(r.empirical_mean);
      const crps = Number(r.mean_crps_cal);
      if (!Number.isFinite(d) || n === 0) continue;
      const cur = buckets.get(d) ?? { d, n: 0, predN: 0, empN: 0, crpsN: 0 };
      cur.n += n;
      if (Number.isFinite(pred)) cur.predN += n * pred;
      if (Number.isFinite(emp))  cur.empN  += n * emp;
      if (Number.isFinite(crps)) cur.crpsN += n * crps;
      buckets.set(d, cur);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.d - b.d)
      .map((b) => ({
        decile: b.d,
        n_trades: b.n,
        predicted: b.n > 0 ? b.predN / b.n : null,
        empirical: b.n > 0 ? b.empN / b.n : null,
        gap: b.n > 0 ? (b.empN / b.n) - (b.predN / b.n) : null,
        mean_crps: b.n > 0 ? b.crpsN / b.n : null,
      }));
  };

  const decileRollupYes = useMemo(
    () => computeDecileRollup(byBetSide.YES),
    [byBetSide.YES],
  );
  const decileRollupNo = useMemo(
    () => computeDecileRollup(byBetSide.NO),
    [byBetSide.NO],
  );

  return (
    <SectionFrame
      id="oracle"
      invocation="Oracular Calibration"
      title="The Oracle"
      subtitle="Predicted probability of the trade winning (per bet side) interrogated against empirical posterior.  A well-calibrated bot has predicted ≈ empirical within each decile, on each side."
      freshnessAt={freshness}
      freshnessCadenceSec={86400 /* daily refresh */}
    >
      {/* Three needles — divergence per market_type (aggregates across bet_side) */}
      <div style={S.needleRow3}>
        {['high', 'low', 'rainm'].map((mt) => {
          const d = divergenceByType[mt];
          return (
            <div key={mt} style={S.needleCell}>
              <BarometricNeedle
                value={d?.div ?? null}
                min={-0.20}
                max={0.20}
                goodRange={[-0.04, 0.04]}
                label={`${mt.toUpperCase()} bias · n=${d?.n ?? 0}`}
                size="compact"
              />
            </div>
          );
        })}
      </div>

      {/* Two needles — divergence per bet_side (aggregates across market_type).
          New in mig 027 / Phase D — surfaces YES↔NO calibration asymmetry. */}
      <div style={S.needleRow2}>
        {['YES', 'NO'].map((bs) => {
          const d = divergenceByBetSide[bs];
          return (
            <div key={bs} style={S.needleCell}>
              <BarometricNeedle
                value={d?.div ?? null}
                min={-0.20}
                max={0.20}
                goodRange={[-0.04, 0.04]}
                label={`${bs} bets bias · n=${d?.n ?? 0}`}
                size="compact"
              />
            </div>
          );
        })}
      </div>

      {/* Reliability scatter */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Reliability — predicted P(win) vs empirical P(win)
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="x"
              name="Predicted"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1.0]}
              tickFormatter={(v) => v.toFixed(2)}
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
              label={{
                value: 'PREDICTED P(WIN)',
                position: 'insideBottom',
                offset: -8,
                style: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)', letterSpacing: '0.1em' },
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="Empirical"
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1.0]}
              tickFormatter={(v) => v.toFixed(2)}
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
              label={{
                value: 'EMPIRICAL P(WIN)',
                angle: -90,
                position: 'insideLeft',
                offset: 12,
                style: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)', letterSpacing: '0.1em' },
              }}
            />
            <ZAxis dataKey="z" range={[20, 320]} name="n_trades" />
            <Tooltip
              cursor={{ stroke: 'var(--rule-strong)', strokeDasharray: '3 3' }}
              contentStyle={{
                background: 'var(--ink-deep)',
                border: '1px solid var(--rule-mid)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              // Custom tooltip content so we can show market_type +
              // bet_side alongside the numeric values.  Recharts'
              // default tooltip surfaces only the dataKey-named
              // values, which would hide bet_side.
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const p = payload[0]?.payload;
                if (!p) return null;
                return (
                  <div style={S.tooltipBox}>
                    <div style={S.tooltipHeader}>
                      {String(p.market_type ?? '?').toUpperCase()} · {p.bet_side ?? '?'} · D{p.prob_decile ?? '?'}
                    </div>
                    <div style={S.tooltipRow}>
                      <span style={S.tooltipLabel}>predicted</span>
                      <span style={S.tooltipValue}>{p.x.toFixed(3)}</span>
                    </div>
                    <div style={S.tooltipRow}>
                      <span style={S.tooltipLabel}>empirical</span>
                      <span style={S.tooltipValue}>{p.y.toFixed(3)}</span>
                    </div>
                    <div style={S.tooltipRow}>
                      <span style={S.tooltipLabel}>n trades</span>
                      <span style={S.tooltipValue}>{p.z}</span>
                    </div>
                  </div>
                );
              }}
            />
            {/* Identity line — perfect calibration */}
            <ReferenceLine
              segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
              stroke="var(--dawn-gold)"
              strokeDasharray="4 6"
              strokeWidth={1.4}
            />
            <Scatter
              name="HIGH"
              data={scatter.filter((p) => p.market_type === 'high')}
              fill="var(--sky-azure)"
              fillOpacity={0.7}
            />
            <Scatter
              name="LOW"
              data={scatter.filter((p) => p.market_type === 'low')}
              fill="var(--storm-violet)"
              fillOpacity={0.7}
            />
            <Scatter
              name="RAINM"
              data={scatter.filter((p) => p.market_type === 'rainm')}
              fill="var(--dawn-gold)"
              fillOpacity={0.7}
            />
          </ScatterChart>
        </ResponsiveContainer>
        <div style={S.legend}>
          <span style={{ ...S.swatch, background: 'var(--sky-azure)' }} /> HIGH
          <span style={{ ...S.swatch, background: 'var(--storm-violet)' }} /> LOW
          <span style={{ ...S.swatch, background: 'var(--dawn-gold)' }} /> RAINM
          <span style={S.swatchSpacer} />
          <span style={S.swatchLine} /> identity (perfect calibration)
        </div>
      </div>

      {/* Two decile rollup tables — YES bets / NO bets side by side.  YES
          bets cluster in low deciles, NO bets in high deciles, so a
          combined table mixes apples and oranges.  Splitting reveals
          the per-side calibration story directly. */}
      <div style={S.tableGrid}>
        <DecileRollupTable title="YES bets — last 30 days" rows={decileRollupYes} />
        <DecileRollupTable title="NO bets — last 30 days"  rows={decileRollupNo}  />
      </div>
    </SectionFrame>
  );
}


// ─────────────────────────────────────────────────────────────────────
// DecileRollupTable — extracted into its own component because we now
// render two of them (YES / NO) and don't want to copy-paste the
// table boilerplate.  Same look-and-feel as the original combined
// table; only differences are a custom title prop and a slightly
// narrower default width (since we render two side-by-side).
// ─────────────────────────────────────────────────────────────────────
function DecileRollupTable({ title, rows }) {
  return (
    <div style={S.tableCard}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        {title}
      </div>
      <table style={S.table}>
        <thead>
          <tr style={S.theadRow}>
            <th style={S.thLeft}>Decile</th>
            <th style={S.thRight}>n trades</th>
            <th style={S.thRight}>Predicted</th>
            <th style={S.thRight}>Empirical</th>
            <th style={S.thRight}>Gap</th>
            <th style={S.thRight}>Mean CRPS</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} style={S.tdEmpty}>No settled trades on this side.</td></tr>
          )}
          {rows.map((b) => {
            const gapAbs = b.gap == null ? 0 : Math.abs(b.gap);
            const gapColor =
              gapAbs < 0.04 ? 'var(--dawn-gold)' :
              gapAbs < 0.10 ? 'var(--dawn-amber)' :
              gapAbs < 0.20 ? 'var(--storm-violet)' :
                              'var(--coral-flare)';
            return (
              <tr key={b.decile} style={S.tbodyRow}>
                <td style={S.tdLeft}>D{b.decile}</td>
                <td style={S.tdRight}>{b.n_trades}</td>
                <td style={S.tdRight}>{b.predicted == null ? '—' : b.predicted.toFixed(3)}</td>
                <td style={S.tdRight}>{b.empirical == null ? '—' : b.empirical.toFixed(3)}</td>
                <td style={{ ...S.tdRight, color: gapColor, fontWeight: 600 }}>
                  {b.gap == null ? '—' : `${b.gap > 0 ? '+' : ''}${b.gap.toFixed(3)}`}
                </td>
                <td style={S.tdRight}>{b.mean_crps == null ? '—' : b.mean_crps.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


const S = {
  needleRow3: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'var(--space-5)',
    marginBottom: 'var(--space-4)',
    padding: 'var(--space-5) 0',
    borderTop: '1px solid var(--rule-faint)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  needleRow2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-5)',
    marginBottom: 'var(--space-6)',
    padding: 'var(--space-5) 0',
    borderBottom: '1px solid var(--rule-faint)',
  },
  needleCell: {
    display: 'flex',
    justifyContent: 'center',
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
    alignItems: 'center',
    gap: 'var(--space-3)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.06em',
    marginTop: 'var(--space-2)',
  },
  swatch: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  swatchLine: {
    display: 'inline-block',
    width: 16,
    height: 2,
    background: 'var(--dawn-gold)',
  },
  swatchSpacer: {
    width: 'var(--space-3)',
  },
  // Two side-by-side decile tables.  At narrow widths, fall back to
  // stacked layout via a container query equivalent (minmax).
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 'var(--space-4)',
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
  theadRow: {
    borderBottom: '1px solid var(--rule-mid)',
  },
  thLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-mute)',
    fontWeight: 500,
    fontSize: 'var(--type-micro)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  thRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-mute)',
    fontWeight: 500,
    fontSize: 'var(--type-micro)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  tbodyRow: {
    borderBottom: '1px solid var(--rule-faint)',
  },
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
  // Custom tooltip used by the reliability scatter.  Recharts'
  // default formatter only knows about dataKey-named values, so we
  // render our own to surface market_type and bet_side cleanly.
  tooltipBox: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 4,
    padding: 'var(--space-2) var(--space-3)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--cloud-pearl)',
    minWidth: 140,
  },
  tooltipHeader: {
    fontWeight: 600,
    color: 'var(--dawn-gold)',
    letterSpacing: '0.04em',
    paddingBottom: 'var(--space-1)',
    marginBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  tooltipRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    lineHeight: 1.4,
  },
  tooltipLabel: {
    color: 'var(--cloud-mute)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontSize: 10,
  },
  tooltipValue: {
    color: 'var(--cloud-pearl)',
    fontVariantNumeric: 'tabular-nums',
  },
};
