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
  // PATCHER_2026_05_15_PAST_TARGET_NEUTRAL — anchor date for "is this
  // target_date in the past?".  We use the dashboard tab's wall clock
  // (UTC date) — close enough to the bot's behavior, and avoids a
  // round-trip just for `today`.  Past target_dates can't be re-fetched
  // (the day is over) so freshness ≠ health for them; they get a
  // neutral palette instead of the alarming red/amber.
  const todayUTC = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  );

  // We aggregate to (source, variant, target_date) — the per-city
  // detail is too granular for the dashboard heatmap.  Each cell
  // tracks per-status city counts, and renders by ok-fraction
  // coverage rather than worst-of (which collapsed almost every
  // cell to non-ok at typical 30-40% city-level ok rates).
  // PATCHER_2026_05_06_COMPLETENESS_COVERAGE
  const grid = useMemo(() => {
    const cells = new Map();
    // key: `${src}|${variant}|${date}` →
    //   { ok, stale, missing, unknown, total, last_fetched }
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
      const current = cells.get(key) || {
        ok: 0, stale: 0, missing: 0, unknown: 0, total: 0,
        last_fetched: null,
      };
      const status = String(r.health_status || 'unknown');
      if (status === 'ok' || status === 'stale' || status === 'missing') {
        current[status] += 1;
      } else {
        current.unknown += 1;
      }
      current.total += 1;
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

  // Aggregate counts — PATCHER_2026_05_15_PAST_TARGET_NEUTRAL excludes
  // past target_dates from the ok/stale/missing tiles since those are
  // historical and can't be re-fetched.  Past rows are surfaced
  // separately as `historical` so the tile bar doesn't scare on
  // expected-stale data.
  const counts = useMemo(() => {
    const by = { ok: 0, stale: 0, missing: 0, unknown: 0, historical: 0 };
    for (const r of rows) {
      const d = String(r.target_date || '').slice(0, 10);
      if (todayUTC && d && d < todayUTC) {
        by.historical += 1;
        continue;
      }
      const s = String(r.health_status || 'unknown');
      if (by[s] != null) by[s] += 1;
      else by.unknown += 1;
    }
    const total = rows.length;
    return { ...by, total };
  }, [rows, todayUTC]);

  return (
    <SectionFrame
      id="completeness"
      invocation="Data Completeness"
      title="Data Completeness"
      subtitle="Each row is a forecast tributary; each column a forecast target.  Stale or missing cells pointing toward a single date suggest an outage; cells distributed across one source suggest its endpoint is silently degraded."
      freshnessAt={freshness}
      freshnessCadenceSec={3600}
    >
      {/* Aggregate tile row — past target_dates excluded from
          ok/stale/missing (they're shown in 'historical' instead). */}
      <div style={S.tileGrid}>
        <Tile label="ok"         value={fmtInt(counts.ok)}         tone="positive" />
        <Tile label="stale"      value={fmtInt(counts.stale)}      tone="warning" />
        <Tile label="missing"    value={fmtInt(counts.missing)}    tone="negative" />
        <Tile label="historical" value={fmtInt(counts.historical)} tone="neutral" />
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
                  todayUTC={todayUTC}
                />
              );
            })}
          </div>
        )}
      </div>

      <div style={S.legend}>
        <CoverageLegendChip label="≥ 95% ok" fill={cellFillByOkFrac(1.00)} />
        <CoverageLegendChip label="≥ 70% ok" fill={cellFillByOkFrac(0.80)} />
        <CoverageLegendChip label="≥ 40% ok" fill={cellFillByOkFrac(0.50)} />
        <CoverageLegendChip label="< 40% ok" fill={cellFillByOkFrac(0.10)} />
        <CoverageLegendChip label="closed (past target)" fill={cellFillClosed()} />
      </div>
    </SectionFrame>
  );
}

function Row({ src, variant, dates, cells, sv, todayUTC }) {
  return (
    <>
      <div style={S.rowLabel}>
        <span style={S.rowSource}>{src}</span>
        {variant && <span style={S.rowVariant}>{variant}</span>}
      </div>
      {dates.map((d) => {
        const key = `${sv}|${d}`;
        const cell = cells.get(key);
        if (!cell || cell.total === 0) {
          return (
            <div key={d} style={{ ...S.heatCell, background: 'var(--ink-mid)' }} title="no data" />
          );
        }
        const okFrac = cell.ok / cell.total;
        const pctText = `${Math.round(okFrac * 100)}%`;
        // PATCHER_2026_05_15_PAST_TARGET_NEUTRAL — past target_dates
        // can't be re-fetched (the day is closed); freshness ≠ health.
        // Render them with a neutral palette + "(closed)" tooltip
        // instead of the actionable red/amber.
        const isPast = todayUTC && d < todayUTC;
        const fill = isPast ? cellFillClosed() : cellFillByOkFrac(okFrac);
        const lines = [
          `${src}${variant ? ' · ' + variant : ''} · ${d}` + (isPast ? ' (closed)' : ''),
          `ok: ${cell.ok}/${cell.total}  (${pctText})`,
        ];
        if (cell.stale > 0)   lines.push(`stale: ${cell.stale}`);
        if (cell.missing > 0) lines.push(`missing: ${cell.missing}`);
        if (cell.unknown > 0) lines.push(`unknown: ${cell.unknown}`);
        if (isPast)           lines.push('(past target — staleness is expected)');
        const tooltip = lines.join('\n');
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

function CoverageLegendChip({ label, fill }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <span style={{
        width: 14, height: 14, background: fill, borderRadius: 2,
        border: '1px solid var(--rule-faint)',
      }} />
      <span className="eyebrow" style={{ color: 'var(--cloud-pearl)' }}>{label}</span>
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

// Coverage-percentage cell color.  Replaces worseOf() / cellFill()
// — see useMemo aggregation comment for rationale.
function cellFillByOkFrac(okFrac) {
  if (okFrac >= 0.95) return 'var(--forest-veil)';                 // solid green
  if (okFrac >= 0.70) return 'rgba(94, 138, 89, 0.55)';            // faded green
  if (okFrac >= 0.40) return 'rgba(184, 133, 58, 0.45)';           // amber
  return 'rgba(194, 84, 80, 0.45)';                                 // red
}

// PATCHER_2026_05_15_PAST_TARGET_NEUTRAL — past target_dates use this
// fill regardless of their current ok/stale ratio.  Once a day has
// passed the bot can't re-fetch its forecasts, so MV staleness is
// guaranteed and not actionable.  Neutral grey signals "historical /
// closed" without screaming red.
function cellFillClosed() {
  return 'rgba(245, 241, 232, 0.10)';                               // soft grey
}

// Kept for the legend chips below — they map a label string to a
// representative fill.  Coverage bands are defined here so the
// legend and cellFillByOkFrac stay in sync.
function cellFill(status) {
  if (status === 'ok')      return 'var(--forest-veil)';
  if (status === 'stale')   return 'rgba(184, 133, 58, 0.45)';
  if (status === 'missing') return 'rgba(194, 84, 80, 0.45)';
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
