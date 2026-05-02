'use client';

/**
 * FreshnessLamp — a small colored dot indicating how recently a
 * materialized view was refreshed.
 *
 * Color mapping:
 *   < 1.5x cadence  → dawn-gold      (fresh)
 *   < 3x cadence    → dawn-amber     (warm)
 *   < 6x cadence    → storm-violet   (stale)
 *   ≥ 6x cadence    → coral-flare    (failed)
 *   no timestamp    → cloud-shade    (uninitialized)
 *
 * Each section has its own expected cadence (refresh interval); the
 * staleness threshold is per-section.  The mapping above is the
 * default; sections can pass `expectedCadenceSec` to override.
 *
 * Visual: 8px dot with a soft halo.  Title attribute has the
 * exact age for hover inspection.  Pure CSS, no animation.
 */
export default function FreshnessLamp({
  refreshedAt,
  expectedCadenceSec = 300, // 5 minutes default (mv_trades_full / mv_pnl_attribution / mv_api_call_health_24h cadence)
  size = 8,
}) {
  let color = 'var(--cloud-shade)';
  let title = 'no data';
  let ageSec = null;

  if (refreshedAt) {
    const refreshedMs = new Date(refreshedAt).getTime();
    const nowMs = Date.now();
    ageSec = Math.max(0, Math.round((nowMs - refreshedMs) / 1000));

    const ratio = ageSec / expectedCadenceSec;
    if (ratio < 1.5) {
      color = 'var(--dawn-gold)';
      title = `fresh · ${formatAge(ageSec)} ago`;
    } else if (ratio < 3) {
      color = 'var(--dawn-amber)';
      title = `warm · ${formatAge(ageSec)} ago`;
    } else if (ratio < 6) {
      color = 'var(--storm-violet)';
      title = `stale · ${formatAge(ageSec)} ago`;
    } else {
      color = 'var(--coral-flare)';
      title = `failed · ${formatAge(ageSec)} ago`;
    }
  }

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 8px -1px ${color}`,
        flexShrink: 0,
      }}
    />
  );
}

function formatAge(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
