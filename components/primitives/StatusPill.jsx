'use client';

/**
 * StatusPill — a small colored chip used for enum-valued data:
 *   - v_burn_in_status.gate_status: building | divergent | ready
 *   - mv_data_completeness.health_status: ok | stale | missing | unknown
 *   - mv_signals_funnel_30d.decision: TRADE | SKIP_LOW_EDGE | etc.
 *
 * Each known enum value has a matched (background, foreground) pair
 * from the design tokens.  Unknown values fall through to a neutral
 * gray pill.
 */

const PALETTE = {
  // Burn-in gate
  ready:      { bg: 'rgba(212, 164, 74, 0.16)', fg: 'var(--dawn-gold)',    border: 'rgba(212, 164, 74, 0.40)' },
  building:   { bg: 'rgba(74, 127, 168, 0.16)', fg: 'var(--sky-azure)',    border: 'rgba(74, 127, 168, 0.40)' },
  divergent:  { bg: 'var(--storm-haze)',         fg: 'var(--storm-violet)', border: 'rgba(107, 77, 142, 0.40)' },

  // Data completeness
  ok:         { bg: 'var(--forest-veil)',         fg: '#7da78d',              border: 'rgba(45, 74, 62, 0.50)' },
  stale:      { bg: 'rgba(184, 133, 58, 0.16)',  fg: 'var(--dawn-amber)',    border: 'rgba(184, 133, 58, 0.40)' },
  missing:    { bg: 'var(--coral-haze)',          fg: 'var(--coral-flare)',   border: 'rgba(194, 84, 80, 0.40)' },
  unknown:    { bg: 'rgba(245, 241, 232, 0.06)', fg: 'var(--cloud-mute)',    border: 'rgba(245, 241, 232, 0.16)' },

  // Trade decisions / generic
  TRADE:      { bg: 'rgba(212, 164, 74, 0.16)', fg: 'var(--dawn-gold)',    border: 'rgba(212, 164, 74, 0.40)' },
  SKIP:       { bg: 'rgba(245, 241, 232, 0.06)', fg: 'var(--cloud-mute)',    border: 'rgba(245, 241, 232, 0.16)' },

  // Win/loss
  win:        { bg: 'var(--forest-veil)',         fg: '#7da78d',              border: 'rgba(45, 74, 62, 0.50)' },
  loss:       { bg: 'var(--storm-haze)',         fg: 'var(--storm-violet)', border: 'rgba(107, 77, 142, 0.40)' },
  open:       { bg: 'rgba(74, 127, 168, 0.16)', fg: 'var(--sky-azure)',    border: 'rgba(74, 127, 168, 0.40)' },
};

const NEUTRAL = {
  bg: 'rgba(245, 241, 232, 0.06)',
  fg: 'var(--cloud-mute)',
  border: 'rgba(245, 241, 232, 0.16)',
};

export default function StatusPill({ value, size = 'normal', children }) {
  // Fall through generic SKIP_* decisions to SKIP coloring.
  let key = value;
  if (typeof value === 'string' && value.startsWith('SKIP_')) {
    key = 'SKIP';
  }
  const c = PALETTE[key] ?? NEUTRAL;
  const isCompact = size === 'compact';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: isCompact ? '2px 6px' : '3px 9px',
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-mono)',
        fontSize: isCompact ? '10px' : 'var(--type-micro)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}
    >
      {children ?? value}
    </span>
  );
}
