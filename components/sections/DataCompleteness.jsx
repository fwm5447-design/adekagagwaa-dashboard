'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * DataCompleteness — mv_data_completeness.
 *
 * For each (city, source, variant, target_date) the MV records whether
 * that source has a usable forecast run for that target.  This view
 * pivots into a heat-grid: rows are (source, variant), columns are
 * target_date, cells are colored by health_status.
 *
 * The aggregate panel highlights gaps to investigate:
 *   - Sources with stale or missing observations across many cities
 *   - Target dates with broad coverage failure (suggests an outage)
 *   - Sources that have been silently absent for hours
 */
export default function DataCompleteness({ rows = [], freshness }) {
  // We aggregate to (source, variant, target_date) — the per-city
  // detail is too granular for the dashboard heatmap.  Each cell
  // gets the worst health_status across its cities.
  const grid = useMemo(() => {
    const cells = new Map(); // key: `${src}|${variant}|${date}` → {status, n}
    const sourceVariants = new Set();
    const targetDates = new Set();
    for (const r of rows) {
      const src = String(r.source || '?');
      const variant = String(r.variant || '');
      const date = String(r.target_date || '').slice(0, 10);
      if (!date) continue;
      const sv = `${src}__${variant}`;
      sourceVariants.add(sv);
      targetDates.add(date);
      const key = `${sv}|${date}`;
      const current = cells.get(key) || { worst: 'ok', n: 0, last_fetched: null };
      const status = String(r.health_status || 'unknown');
      current.worst = worseOf(current.worst, status);
      current.n += 1;
      const lf = r.last_fetched_at ? new Date(r.last_fetched_at).getTime() : null;
      if (lf && (!current.last_fetched || lf > current.last_fetched)) {
        current.last_fetched = lf;
      }
      cells.set(key, current);
    }
    const sortedDates = [...targetDates].sort();
    const sortedSources = [...sourceVariants].sort();
    return { cells, sortedDates, sortedSources };
  }, [rows]);

  // Aggregate counts.
  const counts = useMemo(() => {
    const by = { ok: 0, stale: 0, missing: 0, unknown: 0 };
    for (const r of rows) {
      const s = String(r.health_status || 'unknown');
      if (by[s] != null) by[s] += 1;
      else by.unknown += 1;
    }
    const total = rows.length;
    return { ...by, total };
  }, [rows]);

  return (
    <SectionFrame
      id="completeness"
      invocation="Data Completeness"
      title="Data Completeness"
      subtitle="Each row is a forecast tributary; each column a forecast target.  Stale or missing cells pointing toward a single date suggest an outage; cells distributed across one source suggest its endpoint is silently degraded."
      freshnessAt={freshness}
      freshnessCadenceSec={3600}
    >
      {/* Aggregate tile row */}
      <div style={S.tileGrid}>
        <Tile label="ok"      value={fmtInt(counts.ok)}      tone="positive" />
        <Tile label="stale"   value={fmtInt(counts.stale)}   tone="warning" />
        <Tile label="missing" value={fmtInt(counts.missing)} tone="negative" />
        <Tile label="unknown" value={fmtInt(counts.unknown)} tone="neutral" />
      </div>

      {/* Heatmap grid */}
      <div style={S.gridWrap}>
        {grid.sortedSources.length === 0 ? (
          <div style={S.empty}>No data-completeness observations yet.</div>
        ) : (
          <div style={{
            ...S.gridTable,
            gridTemplateColumns: `200px repeat(${grid.sortedDates.length}, minmax(64px, 1fr))`,
          }}>
            {/* Header row: empty corner + dates */}
            <div style={S.cornerCell}>
              <span className="eyebrow">source · variant</span>
            </div>
            {grid.sortedDates.map((d) => (
              <div key={d} style={S.dateHeader}>
                <span className="eyebrow">{d.slice(5)}</span>
              </div>
            ))}

            {/* Body rows */}
            {grid.sortedSources.map((sv) => {
              const [src, variant] = sv.split('__');
              return (
                <Row
                  key={sv}
                  src={src}
                  variant={variant}
                  dates={grid.sortedDates}
                  cells={grid.cells}
                  sv={sv}
                />
              );
            })}
          </div>
        )}
      </div>

      <div style={S.legend}>
        <LegendChip status="ok" />
        <LegendChip status="stale" />
        <LegendChip status="missing" />
        <LegendChip status="unknown" />
      </div>
    </SectionFrame>
  );
}

function Row({ src, variant, dates, cells, sv }) {
  return (
    <>
      <div style={S.rowLabel}>
        <span style={S.rowSource}>{src}</span>
        {variant && <span style={S.rowVariant}>{variant}</span>}
      </div>
      {dates.map((d) => {
        const key = `${sv}|${d}`;
        const cell = cells.get(key);
        if (!cell) {
          return (
            <div key={d} style={{ ...S.heatCell, background: 'var(--ink-mid)' }} title="no data" />
          );
        }
        const fill = cellFill(cell.worst);
        const tooltip = `${src}${variant ? ' · ' + variant : ''} · ${d}\nstatus: ${cell.worst}\ncities: ${cell.n}`;
        return (
          <div
            key={d}
            style={{ ...S.heatCell, background: fill, cursor: 'help' }}
            title={tooltip}
          />
        );
      })}
    </>
  );
}

function LegendChip({ status }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span style={{
        width: 14, height: 14, background: cellFill(status), borderRadius: 2,
        border: '1px solid var(--rule-faint)',
      }} />
      <StatusPill value={status} size="compact" />
    </span>
  );
}

function Tile({ label, value, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'warning' ? 'var(--dawn-amber)'
    : tone === 'negative' ? 'var(--coral-flare)'
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

// Status ordering: missing > stale > unknown > ok (worst wins for cell color)
function worseOf(a, b) {
  const order = { ok: 0, unknown: 1, stale: 2, missing: 3 };
  const aN = order[a] ?? 1;
  const bN = order[b] ?? 1;
  return aN >= bN ? a : b;
}

function cellFill(status) {
  if (status === 'ok')      return 'var(--forest-veil)';
  if (status === 'stale')   return 'rgba(184, 133, 58, 0.32)';
  if (status === 'missing') return 'rgba(194, 84, 80, 0.32)';
  return 'rgba(245, 241, 232, 0.06)';
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
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
  gridWrap: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    overflowX: 'auto',
  },
  gridTable: {
    display: 'grid',
    gap: 2,
    minWidth: 600,
  },
  cornerCell: {
    padding: 'var(--space-2) var(--space-3)',
    borderBottom: '1px solid var(--rule-mid)',
  },
  dateHeader: {
    padding: 'var(--space-2) var(--space-1)',
    borderBottom: '1px solid var(--rule-mid)',
    textAlign: 'center',
  },
  rowLabel: {
    padding: 'var(--space-2) var(--space-3)',
    background: 'var(--ink-mid)',
    borderRight: '1px solid var(--rule-faint)',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  rowSource: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
  },
  rowVariant: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
  },
  heatCell: {
    height: 28,
    borderRadius: 2,
    transition: `background var(--motion-quick)`,
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-4)',
    marginTop: 'var(--space-4)',
    paddingTop: 'var(--space-4)',
    borderTop: '1px solid var(--rule-faint)',
  },
  empty: {
    textAlign: 'center',
    padding: 'var(--space-7)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
};
