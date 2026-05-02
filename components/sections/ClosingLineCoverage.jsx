'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * ClosingLineCoverage — mv_closing_line_coverage.
 *
 * Daily per-market-type capture rate of closing-line snapshots.
 * The Phase 3.3 closing-line scheduler captures market-mid at
 * `expected_close_at - 5 min`; eligible trades that miss this
 * snapshot lose their CLV measurement and degrade the
 * RealizedEdge slippage decomposition.
 *
 * Healthy state: capture_rate ≥ 0.95 every day per market_type.
 * Sustained capture_rate < 0.85 indicates the scheduler is
 * dropping snapshots — usually upstream Kalshi REST instability
 * or container-restart timing windows.
 */
export default function ClosingLineCoverage({ rows = [], freshness }) {
  // Pivot: x=date, y=capture_rate, series per market_type.
  const series = useMemo(() => {
    const byDate = new Map();
    const types = new Set();
    for (const r of rows) {
      const date = String(r.target_date_norm || '').slice(0, 10);
      if (!date) continue;
      const mt = String(r.market_type || 'unknown');
      types.add(mt);
      if (!byDate.has(date)) byDate.set(date, { date });
      byDate.get(date)[mt] = Number(r.capture_rate);
      byDate.get(date)[`${mt}__total`] = Number(r.n_trades_total);
      byDate.get(date)[`${mt}__captured`] = Number(r.n_trades_captured);
      byDate.get(date)[`${mt}__missed`] = Number(r.n_trades_missed);
    }
    const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { points, marketTypes: [...types].sort() };
  }, [rows]);

  const totals = useMemo(() => {
    let totalEligible = 0;
    let totalCaptured = 0;
    let totalMissed = 0;
    let weightedSum = 0;
    let weightDenom = 0;
    for (const r of rows) {
      const eligible = Number(r.n_trades_eligible) || 0;
      const captured = Number(r.n_trades_captured) || 0;
      const missed = Number(r.n_trades_missed) || 0;
      const cap = Number(r.capture_rate);
      totalEligible += eligible;
      totalCaptured += captured;
      totalMissed += missed;
      if (Number.isFinite(cap) && eligible > 0) {
        weightedSum += cap * eligible;
        weightDenom += eligible;
      }
    }
    return {
      totalEligible,
      totalCaptured,
      totalMissed,
      weightedRate: weightDenom > 0 ? weightedSum / weightDenom : null,
    };
  }, [rows]);

  // Color per market_type — keyed visually.
  const seriesColor = (mt) => {
    if (mt === 'high')  return 'var(--dawn-gold)';
    if (mt === 'low')   return 'var(--sky-azure)';
    if (mt === 'rainm') return 'var(--storm-violet)';
    return 'var(--cloud-mute)';
  };

  return (
    <SectionFrame
      id="coverage"
      invocation="Closing-Line Capture"
      title="Closing-Line Capture"
      subtitle="The closing line — market mid five minutes before settlement — is the calibration mirror against which slippage and CLV are measured.  Days that fall below ninety-percent capture starve the realized edge attribution."
      freshnessAt={freshness}
      freshnessCadenceSec={3600}
    >
      {/* Headline tiles */}
      <div style={S.tileGrid}>
        <Tile
          label="weighted capture · 30d"
          value={totals.weightedRate != null ? pct(totals.weightedRate) : '—'}
          tone={
            totals.weightedRate == null ? 'neutral'
            : totals.weightedRate >= 0.95 ? 'positive'
            : totals.weightedRate >= 0.85 ? 'warning'
            : 'negative'
          }
        />
        <Tile label="trades eligible"  value={fmtInt(totals.totalEligible)}  tone="neutral" />
        <Tile label="trades captured"  value={fmtInt(totals.totalCaptured)}  tone="positive" />
        <Tile
          label="trades missed"
          value={fmtInt(totals.totalMissed)}
          tone={totals.totalMissed > 0 ? 'warning' : 'positive'}
        />
      </div>

      {/* Time-series chart */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Capture rate by day · last 30 days
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={series.points} margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
            <XAxis
              dataKey="date"
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
            />
            <YAxis
              domain={[0, 1]}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ink-deep)',
                border: '1px solid var(--rule-mid)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              formatter={(v, name) => [
                typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : v,
                name,
              ]}
            />
            <ReferenceLine y={0.95} stroke="var(--dawn-gold)" strokeDasharray="3 3" label={{
              value: 'healthy ≥ 95%',
              position: 'right',
              fill: 'var(--dawn-gold)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
            }} />
            <ReferenceLine y={0.85} stroke="var(--storm-violet)" strokeDasharray="3 3" label={{
              value: 'attention < 85%',
              position: 'right',
              fill: 'var(--storm-violet)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
            }} />
            {series.marketTypes.map((mt) => (
              <Line
                key={mt}
                type="monotone"
                dataKey={mt}
                name={mt}
                stroke={seriesColor(mt)}
                strokeWidth={2}
                dot={{ r: 3, fill: seriesColor(mt) }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionFrame>
  );
}

function Tile({ label, value, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'warning' ? 'var(--dawn-amber)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color: valueColor }}>
        {value}
      </div>
    </div>
  );
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

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
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
  },
};
