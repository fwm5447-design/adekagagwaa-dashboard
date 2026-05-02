'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * TributaryEnsemble — per-source skill from mv_source_skill_30d.
 *
 * Renders two horizontal bar charts:
 *
 *   1. RMSE per (source, variant).  Lower = better.  Sources with
 *      RMSE > 3°F highlight in storm-violet (poor skill).  Sub-2°F
 *      sources render in dawn-gold (excellent skill).
 *
 *   2. Bias per (source, variant).  Centered at 0; positive bars to
 *      the right (over-forecasting).  Bars within ±0.5°F render in
 *      dawn-gold (well-calibrated mean); larger biases render in
 *      storm-violet (systematic error worth investigating).
 *
 * Plus a tabular summary with sample counts.  N_paired_tmax/tmin
 * differentiate which side of the market the source contributes to.
 */
export default function TributaryEnsemble({ rows = [], freshness }) {
  const data = useMemo(() => {
    return rows
      .map((r) => ({
        label: `${r.source}${r.variant ? ` · ${r.variant}` : ''}`,
        rmse: Number(r.rmse),
        bias: Number(r.bias),
        mae: Number(r.mae),
        n_paired: Number(r.n_paired),
        n_tmax: Number(r.n_paired_tmax),
        n_tmin: Number(r.n_paired_tmin),
      }))
      .filter((d) => Number.isFinite(d.rmse));
  }, [rows]);

  // Sort by RMSE for the chart; best at top.
  const sorted = useMemo(() => [...data].sort((a, b) => a.rmse - b.rmse), [data]);

  const rmseColorFor = (v) =>
    v < 2.0 ? 'var(--dawn-gold)' :
    v < 3.0 ? 'var(--dawn-amber)' :
    v < 4.0 ? 'var(--sky-azure)' :
              'var(--storm-violet)';

  const biasColorFor = (v) => {
    const abs = Math.abs(v);
    return abs < 0.5 ? 'var(--dawn-gold)' :
           abs < 1.5 ? 'var(--dawn-amber)' :
                       'var(--storm-violet)';
  };

  return (
    <SectionFrame
      id="tributary"
      invocation="Tributary Ensemble"
      title="Tributary Ensemble"
      subtitle="Each source pours its forecast into the consensus.  Skill is measured against canonical observations over the prior thirty days — RMSE for sharpness, bias for systematic drift."
      freshnessAt={freshness}
      freshnessCadenceSec={86400 /* daily refresh */}
    >
      <div style={S.grid}>
        {/* RMSE chart */}
        <div style={S.chartCard}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
            RMSE by source · °F
          </div>
          <ResponsiveContainer width="100%" height={Math.max(220, sorted.length * 32)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
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
                width={140}
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
                  typeof v === 'number' ? v.toFixed(3) : v,
                  name,
                ]}
              />
              <Bar dataKey="rmse" name="RMSE">
                {sorted.map((d, i) => (
                  <Cell key={i} fill={rmseColorFor(d.rmse)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Bias chart */}
        <div style={S.chartCard}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
            Bias by source · °F  (positive = over-forecast)
          </div>
          <ResponsiveContainer width="100%" height={Math.max(220, sorted.length * 32)}>
            <BarChart data={sorted} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
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
                width={140}
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
                  typeof v === 'number' ? v.toFixed(3) : v,
                  name,
                ]}
              />
              <ReferenceLine x={0} stroke="var(--cloud-mute)" />
              <Bar dataKey="bias" name="Bias">
                {sorted.map((d, i) => (
                  <Cell key={i} fill={biasColorFor(d.bias)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabular summary */}
      <div style={S.tableCard}>
        <table style={S.table}>
          <thead>
            <tr style={S.theadRow}>
              <th style={S.thLeft}>Source</th>
              <th style={S.thLeft}>Variant</th>
              <th style={S.thRight}>n paired</th>
              <th style={S.thRight}>n tmax</th>
              <th style={S.thRight}>n tmin</th>
              <th style={S.thRight}>Bias</th>
              <th style={S.thRight}>MAE</th>
              <th style={S.thRight}>RMSE</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={8} style={S.tdEmpty}>No paired source-vs-observation data yet.</td></tr>
            )}
            {sorted.map((d, i) => (
              <tr key={i} style={S.tbodyRow}>
                <td style={S.tdLeft}>{d.label.split(' · ')[0]}</td>
                <td style={S.tdLeft}>{d.label.split(' · ')[1] ?? '—'}</td>
                <td style={S.tdRight}>{d.n_paired}</td>
                <td style={S.tdRight}>{d.n_tmax}</td>
                <td style={S.tdRight}>{d.n_tmin}</td>
                <td style={{ ...S.tdRight, color: biasColorFor(d.bias) }}>
                  {Number.isFinite(d.bias) ? `${d.bias > 0 ? '+' : ''}${d.bias.toFixed(2)}` : '—'}
                </td>
                <td style={S.tdRight}>{Number.isFinite(d.mae) ? d.mae.toFixed(2) : '—'}</td>
                <td style={{ ...S.tdRight, color: rmseColorFor(d.rmse), fontWeight: 600 }}>
                  {Number.isFinite(d.rmse) ? d.rmse.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}

const S = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-5)',
  },
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
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
  tdLeft: { textAlign: 'left', padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-pearl)' },
  tdRight: { textAlign: 'right', padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-haze)' },
  tdEmpty: {
    textAlign: 'center', padding: 'var(--space-5)',
    color: 'var(--cloud-mute)', fontStyle: 'italic',
  },
};
