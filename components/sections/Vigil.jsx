'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * Vigil — v_burn_in_status.
 *
 * Phase 4.1 dual-cache burn-in observer.  Surfaces the per-source
 * status of the cache cutover gate.  Three thresholds must clear
 * for a source to graduate from 'building' to 'ready':
 *
 *   1. days_since_start ≥ 14
 *   2. total_lookups ≥ 1_000  (per-source statistical power)
 *   3. total_divergent == 0   (any divergence demotes to 'divergent')
 *
 * The aggregate burn-in clears when EVERY source/variant is 'ready'
 * AND the cumulative lookups across all sources ≥ 100_000.  Phase 4.2
 * (l2_authoritative flip) is gated on this view.
 */
export default function Vigil({ rows = [], freshness }) {
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      // 'divergent' first (alarm), then 'building', then 'ready'
      const order = { divergent: 0, building: 1, ready: 2 };
      const ag = order[String(a.gate_status)] ?? 99;
      const bg = order[String(b.gate_status)] ?? 99;
      if (ag !== bg) return ag - bg;
      return Number(b.total_lookups || 0) - Number(a.total_lookups || 0);
    });
  }, [rows]);

  const aggregate = useMemo(() => {
    let total_lookups = 0;
    let total_divergent = 0;
    let n_sources = 0;
    let n_ready = 0;
    let n_building = 0;
    let n_divergent = 0;
    let earliest_start = null;
    let latest_observed = null;
    for (const r of rows) {
      n_sources += 1;
      total_lookups += Number(r.total_lookups || 0);
      total_divergent += Number(r.total_divergent || 0);
      const status = String(r.gate_status);
      if (status === 'ready') n_ready += 1;
      else if (status === 'divergent') n_divergent += 1;
      else n_building += 1;

      if (r.burn_in_started_at) {
        const t = new Date(r.burn_in_started_at).getTime();
        if (!earliest_start || t < earliest_start) earliest_start = t;
      }
      if (r.last_observed_at) {
        const t = new Date(r.last_observed_at).getTime();
        if (!latest_observed || t > latest_observed) latest_observed = t;
      }
    }
    const earliest_days =
      earliest_start ? (Date.now() - earliest_start) / (86400 * 1000) : null;
    const overall_status =
      n_divergent > 0 ? 'divergent'
      : n_sources > 0 && n_ready === n_sources && total_lookups >= 100_000 ? 'ready'
      : 'building';
    return {
      n_sources, n_ready, n_building, n_divergent,
      total_lookups, total_divergent,
      earliest_days,
      overall_status,
      total_lookups_pct: Math.min(1, total_lookups / 100_000),
    };
  }, [rows]);

  return (
    <SectionFrame
      id="vigil"
      invocation="Vigil"
      title="Vigil"
      subtitle="The Phase 4.1 cache cutover sits behind a fourteen-day burn-in.  Each source must observe a thousand cache lookups against its two backends without a single divergence before its gate opens.  When all gates open and the cumulative lookups cross a hundred thousand, the cutover proceeds."
      freshnessAt={freshness}
      freshnessCadenceSec={3600 /* hourly */}
    >
      {/* Aggregate gate */}
      <div style={S.aggregateCard}>
        <div style={S.aggregateLeft}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
            Overall burn-in gate
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <StatusPill value={aggregate.overall_status}>
              {aggregate.overall_status.toUpperCase()}
            </StatusPill>
            <div className="numeric" style={S.aggregateMeta}>
              {aggregate.n_ready} / {aggregate.n_sources} sources ready ·
              {' '}{aggregate.earliest_days != null ? aggregate.earliest_days.toFixed(1) : '—'} days observed
            </div>
          </div>
        </div>
        <div style={S.aggregateRight}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
            Cumulative lookups · 100K threshold
          </div>
          <div style={S.progressBarOuter}>
            <div
              style={{
                ...S.progressBarInner,
                width: `${aggregate.total_lookups_pct * 100}%`,
                background:
                  aggregate.overall_status === 'divergent' ? 'var(--storm-violet)'
                  : aggregate.overall_status === 'ready' ? 'var(--dawn-gold)'
                  : 'var(--sky-azure)',
              }}
            />
          </div>
          <div className="numeric" style={S.progressLabel}>
            {fmtInt(aggregate.total_lookups)} / 100,000
            {aggregate.total_divergent > 0 && (
              <span style={{ color: 'var(--storm-violet)', marginLeft: 'var(--space-3)' }}>
                · {fmtInt(aggregate.total_divergent)} divergent observation{aggregate.total_divergent === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Per-source cards grid */}
      <div style={S.grid}>
        {sorted.length === 0 && (
          <div style={S.emptyCard}>
            No burn-in observations yet — view returns empty until the
            DualBackend writes its first lookup counter.
          </div>
        )}
        {sorted.map((r, i) => {
          const days = Number(r.days_since_start) || 0;
          const lookups = Number(r.total_lookups) || 0;
          const divergent = Number(r.total_divergent) || 0;
          const dayPct = Math.min(1, days / 14);
          const lookupPct = Math.min(1, lookups / 1000);
          const status = String(r.gate_status);
          const isAlarm = status === 'divergent';
          return (
            <div
              key={i}
              style={{
                ...S.card,
                ...(isAlarm ? { boxShadow: 'var(--shadow-storm)' } : null),
              }}
            >
              <div style={S.cardHeader}>
                <div>
                  <div style={S.cardSource}>
                    {r.source}
                    {r.variant && <span style={S.cardVariant}> · {r.variant}</span>}
                  </div>
                  <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
                    started{' '}
                    {r.burn_in_started_at
                      ? new Date(r.burn_in_started_at).toLocaleDateString()
                      : '—'}
                  </div>
                </div>
                <StatusPill value={status} />
              </div>

              {/* Days countdown */}
              <div style={S.metric}>
                <div style={S.metricRow}>
                  <span className="eyebrow">days observed</span>
                  <span className="numeric" style={S.metricValue}>
                    {days.toFixed(1)} <span style={S.metricCap}>/ 14</span>
                  </span>
                </div>
                <div style={S.barOuter}>
                  <div style={{ ...S.barInner, width: `${dayPct * 100}%`,
                    background: dayPct >= 1 ? 'var(--dawn-gold)' : 'var(--sky-azure)' }} />
                </div>
              </div>

              {/* Lookups countdown */}
              <div style={S.metric}>
                <div style={S.metricRow}>
                  <span className="eyebrow">lookups</span>
                  <span className="numeric" style={S.metricValue}>
                    {fmtInt(lookups)} <span style={S.metricCap}>/ 1,000</span>
                  </span>
                </div>
                <div style={S.barOuter}>
                  <div style={{ ...S.barInner, width: `${lookupPct * 100}%`,
                    background: lookupPct >= 1 ? 'var(--dawn-gold)' : 'var(--sky-azure)' }} />
                </div>
              </div>

              {/* Divergent observations */}
              <div style={S.metric}>
                <div style={S.metricRow}>
                  <span className="eyebrow">divergences</span>
                  <span className="numeric" style={{
                    ...S.metricValue,
                    color: divergent > 0 ? 'var(--storm-violet)' : 'var(--dawn-gold)',
                    fontWeight: 600,
                  }}>
                    {fmtInt(divergent)}
                    <span style={S.metricCap}> · target 0</span>
                  </span>
                </div>
              </div>

              {/* Hit-pattern breakdown */}
              <div style={S.hitPattern}>
                <HitChip label="both hit" value={r.total_both_hit} accent="var(--dawn-gold)" />
                <HitChip label="L1 only" value={r.total_l1_only} accent="var(--sky-azure)" />
                <HitChip label="L2 only" value={r.total_l2_only} accent="var(--storm-violet)" />
                <HitChip label="both miss" value={r.total_both_miss} accent="var(--cloud-mute)" />
              </div>
            </div>
          );
        })}
      </div>
    </SectionFrame>
  );
}

function HitChip({ label, value, accent }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      flex: '1 1 0',
      minWidth: 0,
    }}>
      <span className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</span>
      <span className="numeric" style={{
        fontSize: 'var(--type-small)',
        color: 'var(--cloud-pearl)',
        borderLeft: `2px solid ${accent}`,
        paddingLeft: 'var(--space-2)',
      }}>
        {fmtInt(value)}
      </span>
    </div>
  );
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

const S = {
  aggregateCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    marginBottom: 'var(--space-5)',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-5)',
  },
  aggregateLeft: {},
  aggregateRight: {},
  aggregateMeta: {
    color: 'var(--cloud-haze)',
    fontSize: 'var(--type-small)',
  },
  progressBarOuter: {
    height: 8,
    background: 'var(--ink-mid)',
    borderRadius: 'var(--radius-pill)',
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    transition: `width var(--motion-glide)`,
  },
  progressLabel: {
    marginTop: 'var(--space-2)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--space-3)',
  },
  card: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  emptyCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    textAlign: 'center',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-2)',
  },
  cardSource: {
    fontFamily: 'var(--font-display)',
    fontWeight: 500,
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.01em',
  },
  cardVariant: {
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontWeight: 400,
  },
  metric: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  metricValue: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
  },
  metricCap: {
    color: 'var(--cloud-mute)',
    fontSize: 'var(--type-micro)',
  },
  barOuter: {
    height: 4,
    background: 'var(--ink-mid)',
    borderRadius: 'var(--radius-pill)',
    overflow: 'hidden',
  },
  barInner: { height: '100%', transition: `width var(--motion-glide)` },
  hitPattern: {
    display: 'flex',
    gap: 'var(--space-3)',
    paddingTop: 'var(--space-2)',
    borderTop: '1px solid var(--rule-faint)',
  },
};
