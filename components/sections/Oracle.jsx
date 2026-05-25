'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';

/**
 * Self-Correction — per-cell trading state + bias-shift visualization.
 *
 * Replaces the legacy calibration-deciles view (2026-05-25).  Reads
 * analytics.mv_forecast_skill (joined with open trade counts) through
 * the SELF_CORRECTION query in lib/queries.js.
 *
 * Three things the operator needs to see at a glance:
 *
 *   1. Which (city, market_type) cells are currently TRADING — i.e.
 *      MAE ≤ 1°F (full Kelly) or 1-2°F (partial Kelly).
 *
 *   2. Which cells are SKIPPED because MAE > 2°F, and which of those
 *      are HEALING (bias dominates MAE, so the μ-shift correction
 *      will pull them back into the trading universe).
 *
 *   3. The actual μ-shift being applied per cell — bias_7d_cal in °F.
 *      Sign-aware: a cell with bias = −3.2°F is chronically under-
 *      predicting, so the bot shifts μ UP by 3.2°F before scoring
 *      brackets.
 *
 * The grid is sorted TRADE → PARTIAL → SKIP → COLD, then by MAE ASC
 * within each group.  Open positions are tagged on each chip.
 */
export default function Oracle({ rows = [], freshness }) {
  // ── Normalize rows ─────────────────────────────────────────────────
  const cells = useMemo(() => {
    return (rows || []).map((r) => ({
      city:        String(r.city || '?'),
      market_type: String(r.market_type || '?').toLowerCase(),
      n_settled:   Number(r.n_settled_7d) || 0,
      mae:         r.mae_7d_cal  != null ? Number(r.mae_7d_cal)  : null,
      bias:        r.bias_7d_cal != null ? Number(r.bias_7d_cal) : null,
      gate:        String(r.gate || 'COLD'),
      kelly_mult:  Number(r.kelly_mult) || 0,
      healable:    r.healable === true,
      n_open:      Number(r.n_open) || 0,
    }));
  }, [rows]);

  // ── Headline totals ────────────────────────────────────────────────
  const totals = useMemo(() => {
    let trading = 0, partial = 0, skip = 0, cold = 0, healing = 0;
    let total_open = 0;
    let bias_magnitude = 0;
    for (const c of cells) {
      if (c.gate === 'TRADE')       trading += 1;
      else if (c.gate === 'PARTIAL') partial += 1;
      else if (c.gate === 'SKIP')    skip    += 1;
      else                           cold    += 1;
      if (c.healable) healing += 1;
      total_open += c.n_open;
      if (Number.isFinite(c.bias)) bias_magnitude += Math.abs(c.bias);
    }
    return { trading, partial, skip, cold, healing, total_open, bias_magnitude };
  }, [cells]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <SectionFrame
      id="self-correction"
      invocation="Self-Correction"
      title="Self-Correction"
      subtitle="Each (city, market_type) cell trades when its rolling 7-day forecast MAE is tight (≤ 2°F).  Cells with chronic directional bias get a μ-shift correction applied to every forecast; that pulls them back below the skip line over a few days as new forecasts arrive.  The bot re-enters paused cells automatically once they recover."
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {/* Headline tile strip */}
      <div style={S.heroGrid}>
        <HeroTile
          label="trading"
          value={totals.trading.toString()}
          sub="full Kelly (MAE ≤ 1°F)"
          tone="positive"
        />
        <HeroTile
          label="partial"
          value={totals.partial.toString()}
          sub="size taper (1–2°F)"
          tone="caution"
        />
        <HeroTile
          label="skipped"
          value={totals.skip.toString()}
          sub={
            totals.healing > 0
              ? `${totals.healing} healing via bias correction`
              : 'MAE > 2°F · paused'
          }
          tone="negative"
        />
        <HeroTile
          label="open positions"
          value={totals.total_open.toString()}
          sub={
            totals.bias_magnitude > 0
              ? `${totals.bias_magnitude.toFixed(1)}°F total bias being subtracted`
              : 'no μ-shift in effect'
          }
          tone="neutral"
        />
      </div>

      {/* Cell grid */}
      {cells.length === 0 ? (
        <div style={S.empty}>
          <div style={S.emptyTitle}>No cells reporting</div>
          <div style={S.emptySub}>
            mv_forecast_skill is empty.  Refreshes daily as forecasts settle.
          </div>
        </div>
      ) : (
        <div style={S.cellGrid}>
          {cells.map((c) => (
            <CellChip key={`${c.city}|${c.market_type}`} cell={c} />
          ))}
        </div>
      )}

      <div style={S.footnote}>
        <strong>How to read this:</strong> green = trading full size,
        amber = partial Kelly, violet = paused (MAE &gt; 2°F),
        azure = paused but healing (bias dominates the error).
        The μ-shift number is the bias correction applied to that cell&apos;s
        predictive mean — negative bias = forecast under-predicts → we
        shift μ up; positive bias = over-predicts → shift down.
      </div>
    </SectionFrame>
  );
}


// ── Cell chip ───────────────────────────────────────────────────────

function CellChip({ cell }) {
  const { city, market_type, mae, bias, gate, kelly_mult, healable, n_open } = cell;
  const tone = gateTone(gate, healable);
  const muShift = bias != null ? -bias : 0;  // μ shifts opposite to bias

  return (
    <div style={{ ...C.chip, borderLeftColor: tone.border }}>
      <div style={C.chipHeader}>
        <span style={{ ...C.mt, color: tone.mtColor }}>
          {market_type.toUpperCase()}
        </span>
        <span style={C.city}>{city}</span>
        {n_open > 0 && (
          <span style={C.openBadge} title={`${n_open} open position${n_open === 1 ? '' : 's'}`}>
            {n_open}
          </span>
        )}
      </div>

      <div style={C.chipBody}>
        <div style={C.mae}>
          {mae != null ? `${mae.toFixed(2)}°F` : '—'}
          <span style={C.maeLabel}>MAE</span>
        </div>

        {gate === 'TRADE' || gate === 'PARTIAL' ? (
          <div style={{ ...C.tag, color: tone.tagColor }}>
            {gate === 'TRADE' ? 'full Kelly' : `${Math.round(kelly_mult * 100)}% Kelly`}
          </div>
        ) : gate === 'SKIP' ? (
          <div style={{ ...C.tag, color: tone.tagColor }}>
            {healable ? 'healing' : 'paused'}
          </div>
        ) : (
          <div style={{ ...C.tag, color: tone.tagColor }}>cold</div>
        )}
      </div>

      {Math.abs(muShift) >= 0.50 && (
        <div style={C.shift}>
          μ-shift {muShift > 0 ? '+' : '−'}{Math.abs(muShift).toFixed(2)}°F
        </div>
      )}
    </div>
  );
}


// ── Hero tile ───────────────────────────────────────────────────────

function HeroTile({ label, value, sub, tone = 'neutral' }) {
  const color =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : tone === 'caution'  ? 'var(--cloud-haze)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.heroTile}>
      <div className="eyebrow" style={S.heroLabel}>{label}</div>
      <div className="display-numeric" style={{ ...S.heroValue, color }}>{value}</div>
      {sub && <div style={S.heroSub}>{sub}</div>}
    </div>
  );
}


// ── Color helpers ───────────────────────────────────────────────────

function gateTone(gate, healable) {
  if (gate === 'TRADE') {
    return {
      border:   'var(--dawn-gold)',
      tagColor: 'var(--dawn-gold)',
      mtColor:  'var(--dawn-gold)',
    };
  }
  if (gate === 'PARTIAL') {
    return {
      border:   'var(--cloud-haze)',
      tagColor: 'var(--cloud-haze)',
      mtColor:  'var(--cloud-haze)',
    };
  }
  if (gate === 'SKIP') {
    return healable
      ? {
          border:   'var(--sky-azure, #5fb1e6)',
          tagColor: 'var(--sky-azure, #5fb1e6)',
          mtColor:  'var(--sky-azure, #5fb1e6)',
        }
      : {
          border:   'var(--storm-violet)',
          tagColor: 'var(--storm-violet)',
          mtColor:  'var(--storm-violet)',
        };
  }
  return {
    border:   'var(--cloud-mute)',
    tagColor: 'var(--cloud-mute)',
    mtColor:  'var(--cloud-mute)',
  };
}


// ── Styles ──────────────────────────────────────────────────────────

const S = {
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-5)',
  },
  heroTile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    minHeight: 96,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  heroLabel: {
    color: 'var(--cloud-mute)',
  },
  heroValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-display)',
    fontWeight: 500,
    lineHeight: 1.0,
    letterSpacing: '-0.01em',
    marginTop: 'var(--space-2)',
    marginBottom: 'var(--space-1)',
  },
  heroSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
  },
  cellGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-4)',
  },
  empty: {
    height: 240,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--cloud-mute)',
    textAlign: 'center',
  },
  emptyTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-h3)',
    color: 'var(--cloud-haze)',
    marginBottom: 'var(--space-2)',
  },
  emptySub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    maxWidth: '46ch',
    lineHeight: 1.6,
  },
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '78ch',
    lineHeight: 1.6,
  },
};

const C = {
  chip: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderLeft: '3px solid var(--cloud-mute)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-3)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minHeight: 72,
  },
  chipHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  mt: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.06em',
  },
  city: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  openBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    color: 'var(--ink-deep)',
    background: 'var(--dawn-gold)',
    borderRadius: 999,
    padding: '1px 6px',
    minWidth: 16,
    textAlign: 'center',
    fontWeight: 600,
  },
  chipBody: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
  },
  mae: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-h3)',
    fontWeight: 500,
    color: 'var(--cloud-pearl)',
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
  },
  maeLabel: {
    fontSize: 9,
    color: 'var(--cloud-mute)',
    letterSpacing: '0.06em',
  },
  tag: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontWeight: 500,
  },
  shift: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginTop: 2,
  },
};
