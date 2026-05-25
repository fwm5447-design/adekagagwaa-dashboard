'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';

/**
 * ForecastSkill — per-(city, market_type) DTL Kelly multiplier.
 *
 * Sources analytics.mv_forecast_skill (migration 054).  Each row is
 * one cell's rolling 7-day mean absolute error against settled v2
 * trades, mapped to a [0, 1] skill multiplier that the engine
 * applies to `kelly_lcb` for that cell.
 *
 * Triage view: worst MAE at the top.  Cells with skill==0 are
 * effectively "bypassed" — the engine declines to bet them.  Cells
 * with skill==1 are healthy.  Anything in between is a partial
 * shrink.  This panel is the operator's view of which cells are
 * being throttled and why.
 *
 *  Skill mapping (from core/decision/skill_score.py, 2026-05-25 revision):
 *    mae ≤ 1.0°F  → 1.0  (full Kelly)
 *    1-2°F       → 1.0 → 0.0  (linear taper)
 *    > 2°F        → 0.0  (skip the trade)
 *    unknown / < 3 samples → 0.0 (cold cell → skip, was 0.5 half-Kelly)
 */
export default function ForecastSkill({ rows = [], freshness }) {
  const data = useMemo(() => {
    return [...rows]
      .map((r) => {
        const mae = r.mae_7d_cal != null ? Number(r.mae_7d_cal) : null;
        return {
          city:        String(r.city || '?'),
          market_type: String(r.market_type || '?').toUpperCase(),
          n_7d:        Number(r.n_settled_7d) || 0,
          mae_7d:      mae,
          mae_14d:     r.mae_14d_cal != null ? Number(r.mae_14d_cal) : null,
          n_14d:       Number(r.n_settled_14d) || 0,
          bias_7d:     r.bias_7d_cal != null ? Number(r.bias_7d_cal) : null,
          skill:       skillFromMae(mae),
        };
      })
      .sort((a, b) => (b.mae_7d ?? -1) - (a.mae_7d ?? -1));
  }, [rows]);

  const totals = useMemo(() => {
    let n_cells = data.length;
    let n_zero = 0;
    let n_partial = 0;
    let n_full = 0;
    let n_default = 0;
    for (const d of data) {
      if (d.mae_7d === null || d.n_7d < 3) { n_default += 1; continue; }
      if (d.skill === 0) n_zero += 1;
      else if (d.skill >= 0.99) n_full += 1;
      else n_partial += 1;
    }
    return { n_cells, n_zero, n_partial, n_full, n_default };
  }, [data]);

  return (
    <SectionFrame
      id="forecast-skill"
      invocation="Forecast Skill"
      title="Forecast Skill Throttle"
      subtitle="Per-cell rolling 7-day MAE drives a Kelly multiplier on every bet.  Cells with MAE > 2°F skip entirely; cells with MAE ≤ 1°F bet full Kelly; in between is a linear taper.  MAE updates daily from forecasts joined with observations, so paused cells keep accumulating signal and auto-resume once they recover.  Refreshes every 5 minutes."
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {/* Headline tiles */}
      <div style={S.tileGrid}>
        <Tile label="Cells tracked" value={totals.n_cells.toString()} sub="distinct (city, market) pairs" />
        <Tile label="Skipped" value={totals.n_zero.toString()} sub="skill = 0 (MAE > 2°F)" tone="bad" />
        <Tile label="Throttled" value={totals.n_partial.toString()} sub="0 < skill < 1 (1-2°F)" tone="warn" />
        <Tile label="Healthy" value={totals.n_full.toString()} sub="skill = 1.0 (MAE ≤ 1°F)" tone="good" />
        <Tile label="Cold" value={totals.n_default.toString()} sub="< 3 settled samples (skip)" tone="bad" />
      </div>

      {/* Table */}
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thLeft}>Cell</th>
              <th style={S.th}>n 7d</th>
              <th style={S.th}>MAE 7d</th>
              <th style={S.th}>MAE 14d</th>
              <th style={S.th}>Bias 7d</th>
              <th style={S.th}>Skill</th>
              <th style={S.th}>Effect</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr>
                <td colSpan={7} style={S.empty}>
                  No cells in mv_forecast_skill yet.  MV populates daily from forecasts joined with canonical observations.
                </td>
              </tr>
            )}
            {data.map((d) => {
              const isDefault = d.mae_7d === null || d.n_7d < 3;
              const eff = isDefault
                ? 'cold → skip'
                : d.skill === 0 ? 'SKIP'
                : d.skill >= 0.99 ? 'full Kelly'
                : `${(d.skill * 100).toFixed(0)}% Kelly`;
              return (
                <tr key={`${d.city}|${d.market_type}`} style={S.tr}>
                  <td style={S.tdLeft}>
                    <span className="numeric">{d.city}</span>{' '}
                    <span style={S.mt}>{d.market_type}</span>
                  </td>
                  <td style={S.td}>{d.n_7d}</td>
                  <td style={S.tdMono}>{d.mae_7d != null ? d.mae_7d.toFixed(2) + '°F' : '—'}</td>
                  <td style={S.tdMono}>{d.mae_14d != null ? d.mae_14d.toFixed(2) + '°F' : '—'}</td>
                  <td style={S.tdMono}>{d.bias_7d != null ? (d.bias_7d > 0 ? '+' : '') + d.bias_7d.toFixed(2) + '°F' : '—'}</td>
                  <td style={{ ...S.tdMono, color: skillColor(d.skill, isDefault), fontWeight: 600 }}>
                    {d.skill.toFixed(2)}
                  </td>
                  <td style={{ ...S.td, color: skillColor(d.skill, isDefault) }}>
                    {eff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}


// ── Pure functions ──────────────────────────────────────────────

/** Mirror of core/decision/skill_score.py skill_score_from_mae().
 *  2026-05-25: curve tightened — anything above 2°F now skips. */
function skillFromMae(mae) {
  if (mae === null || mae === undefined) return 0.0;
  if (mae <= 0) return 1.0;
  const points = [[0, 1.0], [1, 1.0], [2, 0.0]];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (mae <= x1) {
      const t = (mae - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return 0.0;
}

function skillColor(skill, isDefault) {
  if (isDefault) return 'var(--cloud-mute, #999)';
  if (skill === 0) return 'var(--bad, #d44)';
  if (skill < 0.4) return 'var(--bad, #d44)';
  if (skill < 0.8) return 'var(--warn, #d80)';
  return 'var(--good, #2a8)';
}


// ── Sub-component ───────────────────────────────────────────────

function Tile({ label, value, sub, tone }) {
  const toneColor =
    tone === 'good' ? 'var(--good, #2a8)' :
    tone === 'bad'  ? 'var(--bad, #d44)' :
    tone === 'warn' ? 'var(--warn, #d80)' :
    'inherit';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={S.tileLabel}>{label}</div>
      <div className="numeric" style={{ ...S.tileValue, color: toneColor }}>{value}</div>
      {sub && <div style={S.tileSub}>{sub}</div>}
    </div>
  );
}


// ── Styles (in the dashboard's house style: minimal, serif-friendly) ──

const S = {
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  tile: {
    padding: '12px 14px',
    background: 'var(--cloud-bg, rgba(255,255,255,0.04))',
    borderRadius: '4px',
  },
  tileLabel: {
    color: 'var(--cloud-mute, #999)',
    fontSize: '11px',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  tileValue: {
    fontSize: '24px',
    fontWeight: 600,
    lineHeight: 1.1,
  },
  tileSub: {
    color: 'var(--cloud-mute, #999)',
    fontSize: '12px',
    marginTop: '4px',
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    padding: '8px 10px',
    textAlign: 'right',
    color: 'var(--cloud-mute, #999)',
    borderBottom: '1px solid var(--cloud-line, rgba(255,255,255,0.1))',
    fontWeight: 500,
  },
  thLeft: {
    padding: '8px 10px',
    textAlign: 'left',
    color: 'var(--cloud-mute, #999)',
    borderBottom: '1px solid var(--cloud-line, rgba(255,255,255,0.1))',
    fontWeight: 500,
  },
  tr: {
    borderBottom: '1px solid var(--cloud-line, rgba(255,255,255,0.05))',
  },
  td: {
    padding: '6px 10px',
    textAlign: 'right',
  },
  tdLeft: {
    padding: '6px 10px',
    textAlign: 'left',
  },
  tdMono: {
    padding: '6px 10px',
    textAlign: 'right',
    fontFamily: 'var(--font-mono, monospace)',
    fontVariantNumeric: 'tabular-nums',
  },
  mt: {
    color: 'var(--cloud-mute, #999)',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  empty: {
    padding: '24px',
    textAlign: 'center',
    color: 'var(--cloud-mute, #999)',
    fontStyle: 'italic',
  },
};
