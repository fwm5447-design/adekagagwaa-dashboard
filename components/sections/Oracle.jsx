'use client';

import { useMemo } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import BarometricNeedle from '../primitives/BarometricNeedle';

/**
 * Oracle — calibration reliability surface.
 *
 * Renders mv_calibration_buckets data three ways:
 *
 *   1. Three barometric needles (one per market_type) showing the
 *      sample-weighted divergence between predicted_mean and
 *      empirical_mean.  Zero divergence = perfectly calibrated.
 *      Positive = we over-predict (predicted too high vs reality).
 *      Negative = we under-predict.
 *
 *   2. Reliability scatter: predicted_mean (x-axis) vs empirical_mean
 *      (y-axis), one dot per (day, decile, market_type).  Identity
 *      line = perfect calibration.  Color-coded by market_type.
 *      Dot size ∝ n_trades.
 *
 *   3. Tabular: per-decile rollup over the visible window — bucket,
 *      n_trades, predicted, empirical, gap, mean CRPS.
 *
 * The audit's calibration narrative: "well-calibrated forecasts have
 * predicted_mean ≈ empirical_mean within each bucket."
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

  // Sample-weighted mean divergence per market_type.
  // divergence = E[empirical] - E[predicted] under sample weights.
  const divergenceByType = useMemo(() => {
    const out = {};
    for (const [mt, mtRows] of Object.entries(byMarketType)) {
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
      out[mt] = totalN > 0 ? { div: weightedDiv / totalN, n: totalN } : null;
    }
    return out;
  }, [byMarketType]);

  // Scatter data — flat list with color/size encoded.
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
        prob_decile: r.prob_decile,
      }));
  }, [rows]);

  // Decile rollup table — aggregate over all market_types & days.
  const decileRollup = useMemo(() => {
    const buckets = new Map();
    for (const r of rows) {
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
  }, [rows]);

  return (
    <SectionFrame
      id="oracle"
      invocation="Oracular Calibration"
      title="The Oracle"
      subtitle="Predicted probability is meaningless without an empirical posterior.  Each bucket interrogates the model against its own forecast."
      freshnessAt={freshness}
      freshnessCadenceSec={86400 /* daily refresh */}
    >
      {/* Three needles — divergence per market_type */}
      <div style={S.needleRow}>
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

      {/* Reliability scatter */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Reliability — predicted vs empirical
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
                value: 'PREDICTED',
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
                value: 'EMPIRICAL',
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
              formatter={(v, name) => [
                typeof v === 'number' ? v.toFixed(3) : v,
                name,
              ]}
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

      {/* Decile rollup table */}
      <div style={S.tableCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Decile rollup — last 30 days
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
            {decileRollup.length === 0 && (
              <tr><td colSpan={6} style={S.tdEmpty}>No settled trades yet.</td></tr>
            )}
            {decileRollup.map((b) => {
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
    </SectionFrame>
  );
}

const S = {
  needleRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'var(--space-5)',
    marginBottom: 'var(--space-6)',
    padding: 'var(--space-5) 0',
    borderTop: '1px solid var(--rule-faint)',
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
};
