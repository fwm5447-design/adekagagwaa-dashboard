'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * Vigil — calibration-stack health observer.
 *
 * Replaces the original Phase 4.1 burn-in monitor (which is moot now
 * that forecast_cache deprecation completed).  Surfaces the three
 * layers of the current calibration stack:
 *
 *   1. EMOS v2 — the mu/sigma calibrator, reads from emos_fits_v2
 *      (per-source × per-cell × per-lead-bin × per-doy).  Health
 *      signals: sign of (c, d) coefficients (must be positive — exp-
 *      transform invariant), CRPS lift ratio (crps_holdout vs
 *      crps_raw_holdout, target < 1.0), shadow vs promoted state.
 *
 *   2. Isotonic — the probability calibrator on top of the predictive
 *      Gaussian.  Reads from isotonic_fits per market_type.  Health
 *      signal: brier_holdout / brier_train ratio (alarm > 1.20×).
 *
 *   3. Station biases — empirical per-city threshold shifts.  Reads
 *      from station_biases per (city, market_type ∈ {high, low}).
 *      Health signal: distribution shape — biases concentrating
 *      far from zero indicate model drift.
 *
 * The aggregate gate at the top is the AND of the three layers.  Any
 * single regression flips the whole banner.
 *
 * Data shape (passed in via the `data` prop):
 *   {
 *     emos: [{ scope_market_type, scope_lead_bin, scope_source, scope_station,
 *              a, b, c, d, sigma_min,
 *              crps_train, crps_holdout, crps_raw_train, crps_raw_holdout,
 *              n_train_samples, n_holdout_samples,
 *              shadow_at, promoted_at, retired_at }, ...],
 *     isotonic: [{ scope_market_type, scope_station,
 *                  brier_train, brier_holdout, log_loss_train,
 *                  control_points, n_samples,
 *                  training_window_start, training_window_end }, ...],
 *     station_biases: [{ scope_city, scope_market_type,
 *                        empirical_bias, n_samples,
 *                        min_samples_threshold,
 *                        training_window_start, training_window_end }, ...]
 *   }
 */
export default function Vigil({ data = {}, freshness }) {
  const emosRows     = data.emos || [];
  const isotonicRows = data.isotonic || [];
  const biasRows     = data.station_biases || [];

  // ── Panel 1 stats: EMOS v2 health
  const emosStats = useMemo(() => {
    const n = emosRows.length;
    if (n === 0) {
      return { n: 0, n_sane: 0, sanity_pct: 0, median_lift: null,
               n_shadow: 0, n_promoted: 0, n_regressing: 0 };
    }
    let n_sane = 0;
    let n_shadow = 0;
    let n_promoted = 0;
    let n_regressing = 0;
    const lifts = [];
    for (const r of emosRows) {
      const c = Number(r.c);
      const d = Number(r.d);
      if (Number.isFinite(c) && Number.isFinite(d) && c > 0 && d > 0) n_sane += 1;
      if (r.shadow_at && !r.promoted_at) n_shadow += 1;
      if (r.promoted_at) n_promoted += 1;
      const ch = Number(r.crps_holdout);
      const rh = Number(r.crps_raw_holdout);
      if (Number.isFinite(ch) && Number.isFinite(rh) && rh > 0) {
        const lift = ch / rh;
        lifts.push(lift);
        if (lift > 1.0) n_regressing += 1;
      }
    }
    lifts.sort((a, b) => a - b);
    const median_lift = lifts.length === 0
      ? null
      : (lifts.length % 2
         ? lifts[(lifts.length - 1) / 2]
         : (lifts[lifts.length / 2 - 1] + lifts[lifts.length / 2]) / 2);
    return {
      n,
      n_sane,
      sanity_pct: n_sane / n,
      median_lift,
      n_shadow,
      n_promoted,
      n_regressing,
    };
  }, [emosRows]);

  // Worst 10 fits by lift ratio
  const emosWatchlist = useMemo(() => {
    const enriched = emosRows
      .map((r) => {
        const ch = Number(r.crps_holdout);
        const rh = Number(r.crps_raw_holdout);
        const lift = (Number.isFinite(ch) && Number.isFinite(rh) && rh > 0) ? ch / rh : null;
        return { ...r, lift };
      })
      .filter((r) => r.lift != null);
    enriched.sort((a, b) => b.lift - a.lift);
    return enriched.slice(0, 10);
  }, [emosRows]);

  // ── Panel 2: per market_type isotonic stats
  const isotonicByMarket = useMemo(() => {
    const out = { high: null, low: null, rainm: null };
    for (const r of isotonicRows) {
      // Only the "global" (scope_station NULL/empty) fits drive the
      // dashboard panel; per-station rows are reserved for forward-compat.
      if (r.scope_station != null && String(r.scope_station).length > 0) continue;
      const mt = String(r.scope_market_type);
      if (out[mt] === null || (Number(r.n_samples) > Number(out[mt]?.n_samples || 0))) {
        out[mt] = r;
      }
    }
    return out;
  }, [isotonicRows]);

  // ── Panel 3: station bias matrix
  const biasMatrix = useMemo(() => {
    const m = new Map();   // city → { high, low }
    for (const r of biasRows) {
      const city = String(r.scope_city);
      if (!m.has(city)) m.set(city, { high: null, low: null });
      const mt = String(r.scope_market_type);
      if (mt === 'high' || mt === 'low') m.get(city)[mt] = r;
    }
    // Sort cities by max abs bias across both market_types, descending.
    const rows = [];
    for (const [city, mts] of m.entries()) {
      const hbias = mts.high ? Number(mts.high.empirical_bias) : 0;
      const lbias = mts.low  ? Number(mts.low.empirical_bias)  : 0;
      const max_abs = Math.max(Math.abs(hbias), Math.abs(lbias));
      rows.push({ city, high: mts.high, low: mts.low, max_abs });
    }
    rows.sort((a, b) => b.max_abs - a.max_abs);
    return rows;
  }, [biasRows]);

  const biasRange = useMemo(() => {
    let max = 0;
    for (const r of biasRows) {
      const v = Math.abs(Number(r.empirical_bias) || 0);
      if (v > max) max = v;
    }
    return Math.max(max, 1.0);   // floor at 1°F so bars are always visible
  }, [biasRows]);

  // ── Aggregate health
  const aggregate = useMemo(() => {
    const emos_health =
      emosStats.n === 0                ? 'unknown'
      : emosStats.sanity_pct < 1.0     ? 'regressing'
      : emosStats.median_lift == null  ? 'watching'
      : emosStats.median_lift > 1.0    ? 'regressing'
      : emosStats.median_lift > 0.98   ? 'watching'
      :                                  'healthy';

    const iso_health = ['high', 'low', 'rainm'].reduce((acc, mt) => {
      const r = isotonicByMarket[mt];
      if (!r) return acc;
      const bt = Number(r.brier_train);
      const bh = Number(r.brier_holdout);
      if (!Number.isFinite(bt) || !Number.isFinite(bh) || bt <= 0) return acc;
      const ratio = bh / bt;
      if (ratio > 1.20) return 'regressing';
      if (ratio > 1.10 && acc !== 'regressing') return 'watching';
      return acc;
    }, 'healthy');

    const bias_health = biasRange > 5.0 ? 'watching' : 'healthy';

    const ranks = { regressing: 0, watching: 1, healthy: 2, unknown: 3 };
    const overall = [emos_health, iso_health, bias_health]
      .reduce((w, s) => (ranks[s] < ranks[w] ? s : w), 'healthy');

    return { emos: emos_health, iso: iso_health, bias: bias_health, overall };
  }, [emosStats, isotonicByMarket, biasRange]);

  return (
    <SectionFrame
      id="vigil"
      invocation="Vigil"
      title="Vigil"
      subtitle="Three calibration layers, three independent quality gates.  EMOS shapes the predictive Gaussian's μ and σ.  Isotonic remaps probabilities into empirical YES rates.  Station biases shift thresholds for each city's microclimate.  Each layer must pass on its own; the whole stack is only as honest as the worst-graded layer."
      freshnessAt={freshness}
      freshnessCadenceSec={3600}
    >
      {/* Aggregate banner */}
      <div style={S.aggregateCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <StatusPill value={aggregate.overall === 'healthy' ? 'ready'
                            : aggregate.overall === 'watching' ? 'building'
                            : 'divergent'}>
            {aggregate.overall.toUpperCase()}
          </StatusPill>
          <div className="numeric" style={S.aggregateLabel}>
            calibration stack
          </div>
        </div>
        <div style={S.aggregateLayers}>
          <LayerChip label="EMOS v2"   state={aggregate.emos} />
          <LayerChip label="Isotonic"  state={aggregate.iso} />
          <LayerChip label="Stations"  state={aggregate.bias} />
        </div>
      </div>

      {/* ─── Panel 1 — EMOS v2 ────────────────────────────────────── */}
      <Panel
        eyebrow="layer one"
        title="EMOS v2 — predictive μ / σ calibration"
        meta={`${fmtInt(emosStats.n)} active fits · ${fmtInt(emosStats.n_promoted)} promoted · ${fmtInt(emosStats.n_shadow)} in shadow`}
      >
        <div style={S.tileRow}>
          <Tile
            eyebrow="active fits"
            value={fmtInt(emosStats.n)}
            sub={`${fmtInt(emosStats.n_promoted)} live`}
          />
          <Tile
            eyebrow="coefficient sanity"
            value={emosStats.n === 0 ? '—' : `${(emosStats.sanity_pct * 100).toFixed(1)}%`}
            sub="c &gt; 0 ∧ d &gt; 0"
            tone={emosStats.sanity_pct >= 1.0 ? 'positive'
                 : emosStats.sanity_pct >= 0.99 ? 'neutral'
                 : 'negative'}
          />
          <Tile
            eyebrow="median CRPS lift"
            value={emosStats.median_lift == null ? '—' : emosStats.median_lift.toFixed(3)}
            sub={emosStats.median_lift == null ? 'no holdout data'
                 : emosStats.median_lift < 1.0 ? `${((1 - emosStats.median_lift) * 100).toFixed(1)}% better than raw`
                 : `${((emosStats.median_lift - 1) * 100).toFixed(1)}% worse than raw`}
            tone={emosStats.median_lift == null ? 'neutral'
                 : emosStats.median_lift < 0.98 ? 'positive'
                 : emosStats.median_lift > 1.0 ? 'negative'
                 : 'neutral'}
          />
          <Tile
            eyebrow="regressing fits"
            value={fmtInt(emosStats.n_regressing)}
            sub={`out of ${fmtInt(emosStats.n)}`}
            tone={emosStats.n_regressing === 0 ? 'positive'
                 : emosStats.n_regressing < 5 ? 'neutral'
                 : 'negative'}
          />
        </div>

        {/* Watchlist — worst 10 by lift ratio */}
        <div style={S.cardSlab}>
          <div className="eyebrow" style={S.cardSlabEyebrow}>
            watchlist · ten weakest fits by holdout lift ratio
          </div>
          {emosWatchlist.length === 0 ? (
            <div style={S.empty}>
              No fits with both holdout CRPS and raw-holdout CRPS computed yet.  Once a refit cycle
              produces a non-empty time-blocked CV pass, fits surface here ranked from worst to best.
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr style={S.theadRow}>
                  <th style={S.thLeft}>cell</th>
                  <th style={S.thLeft}>scope</th>
                  <th style={S.thRight}>n train</th>
                  <th style={S.thRight}>n holdout</th>
                  <th style={S.thRight}>CRPS train</th>
                  <th style={S.thRight}>CRPS holdout</th>
                  <th style={S.thRight}>lift</th>
                  <th style={S.thRight}>(a, b, c, d)</th>
                </tr>
              </thead>
              <tbody>
                {emosWatchlist.map((r, i) => {
                  const isAlarm = r.lift > 1.0;
                  return (
                    <tr key={i} style={{
                      ...S.tbodyRow,
                      ...(isAlarm ? { background: 'color-mix(in srgb, var(--storm-violet) 8%, transparent)' } : null),
                    }}>
                      <td style={S.tdLeft}>
                        <span style={S.cellMarketType}>{r.scope_market_type}</span>
                        {r.scope_lead_bin != null && (
                          <span style={S.cellLead}> · lb{r.scope_lead_bin}</span>
                        )}
                      </td>
                      <td style={S.tdLeft}>
                        <span style={S.cellScope}>
                          {r.scope_source || 'pooled'}
                          {r.scope_station ? ` / ${r.scope_station}` : ''}
                        </span>
                      </td>
                      <td style={S.tdRight}>{fmtInt(r.n_train_samples)}</td>
                      <td style={S.tdRight}>{fmtInt(r.n_holdout_samples)}</td>
                      <td style={S.tdRight}>{fmtFloat(r.crps_train, 3)}</td>
                      <td style={{ ...S.tdRight, color: isAlarm ? 'var(--storm-violet)' : 'var(--cloud-haze)' }}>
                        {fmtFloat(r.crps_holdout, 3)}
                      </td>
                      <td style={{
                        ...S.tdRight,
                        color: isAlarm ? 'var(--storm-violet)' : (r.lift < 0.95 ? 'var(--dawn-gold)' : 'var(--cloud-pearl)'),
                        fontWeight: 600,
                      }}>
                        {r.lift.toFixed(3)}
                      </td>
                      <td style={{ ...S.tdRight, fontSize: 'var(--type-micro)', color: 'var(--cloud-mute)' }}>
                        ({fmtCoeff(r.a)}, {fmtCoeff(r.b)}, {fmtCoeff(r.c)}, {fmtCoeff(r.d)})
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Panel>

      {/* ─── Panel 2 — Isotonic ───────────────────────────────────── */}
      <Panel
        eyebrow="layer two"
        title="Isotonic — probability calibration"
        meta="three independent calibrators · one per market type"
      >
        <div style={S.isotonicGrid}>
          {['high', 'low', 'rainm'].map((mt) => {
            const r = isotonicByMarket[mt];
            return <IsotonicCard key={mt} mt={mt} fit={r} />;
          })}
        </div>
      </Panel>

      {/* ─── Panel 3 — Station biases ────────────────────────────── */}
      <Panel
        eyebrow="layer three"
        title="Station biases — per-city threshold corrections"
        meta={`${fmtInt(biasRows.length)} active rows · target ±5°F · max observed ${biasRange.toFixed(2)}°F`}
      >
        <div style={S.biasShell}>
          <div style={S.biasGrid}>
            {biasMatrix.map((row) => (
              <BiasRow key={row.city} row={row} range={biasRange} />
            ))}
            {biasMatrix.length === 0 && (
              <div style={S.empty}>
                No active station biases yet — until {`>=`} BIAS_MIN_SAMPLES forecast×observation
                pairs accumulate per (city, market_type), the analyzer falls through to the
                physics prior.
              </div>
            )}
          </div>

          {/* Histogram */}
          <BiasHistogram rows={biasRows} range={biasRange} />
        </div>
      </Panel>

      <p style={S.footnote}>
        EMOS warps the predictive Gaussian to fit historical observation residuals; isotonic
        regression rebuilds the YES-probability from empirical settlement frequencies; station
        biases shift the comparison threshold by the city's measured microclimate offset.  All
        three apply at decision time, in that order.  If any layer is regressing, the bot's
        edge estimate is wrong by exactly that layer's residual — and the bot trades on the
        wrong number.
      </p>
    </SectionFrame>
  );
}


// ─── Panel + card primitives ─────────────────────────────────────────

function Panel({ eyebrow, title, meta, children }) {
  return (
    <div style={S.panelOuter}>
      <div style={S.panelHeader}>
        <div>
          <div className="eyebrow" style={S.panelEyebrow}>{eyebrow}</div>
          <div style={S.panelTitle}>{title}</div>
        </div>
        {meta && <div className="numeric" style={S.panelMeta}>{meta}</div>}
      </div>
      <div style={S.panelBody}>{children}</div>
    </div>
  );
}

function LayerChip({ label, state }) {
  const color =
    state === 'healthy'    ? 'var(--dawn-gold)'
    : state === 'watching' ? 'var(--sky-azure)'
    : state === 'unknown'  ? 'var(--cloud-mute)'
    :                        'var(--storm-violet)';
  return (
    <div style={S.layerChip}>
      <span style={{ ...S.layerDot, background: color }} />
      <span style={S.layerLabel}>{label}</span>
      <span style={{ ...S.layerState, color }}>
        {state}
      </span>
    </div>
  );
}

function Tile({ eyebrow, value, sub, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}
           dangerouslySetInnerHTML={{ __html: eyebrow }} />
      <div className="display-numeric" style={{ ...S.tileValue, color: valueColor }}>
        {value}
      </div>
      {sub && <div className="numeric" style={S.tileSub}>{sub}</div>}
    </div>
  );
}

function IsotonicCard({ mt, fit }) {
  if (!fit) {
    return (
      <div style={S.isoCard}>
        <div style={S.isoCardHeader}>
          <span style={S.isoCardMt}>{mt.toUpperCase()}</span>
          <StatusPill value="building">PENDING</StatusPill>
        </div>
        <div style={S.empty}>
          No active isotonic fit for {mt}.  Calibrator no-ops below the
          MIN_SAMPLES_FOR_ISOTONIC threshold; raw probability passes through.
        </div>
      </div>
    );
  }

  const bt = Number(fit.brier_train);
  const bh = Number(fit.brier_holdout);
  const ratio = (Number.isFinite(bt) && Number.isFinite(bh) && bt > 0) ? bh / bt : null;
  const status =
    ratio == null              ? 'building'
    : ratio > 1.20              ? 'divergent'
    : ratio > 1.10              ? 'building'
    :                             'ready';

  // Parse control points for the mini sparkline.  Stored as JSONB
  // array of [p_raw, p_cal] pairs (per migration 013).  Resilient to
  // both array-of-arrays and array-of-objects shapes.
  let points = [];
  try {
    const cp = fit.control_points;
    const arr = Array.isArray(cp) ? cp : (typeof cp === 'string' ? JSON.parse(cp) : []);
    points = arr.map((pt) => {
      if (Array.isArray(pt)) return [Number(pt[0]), Number(pt[1])];
      if (pt && typeof pt === 'object') return [Number(pt.p_raw), Number(pt.p_cal)];
      return null;
    }).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  } catch (e) { points = []; }

  return (
    <div style={S.isoCard}>
      <div style={S.isoCardHeader}>
        <span style={S.isoCardMt}>{mt.toUpperCase()}</span>
        <StatusPill value={status}>
          {ratio == null ? 'PENDING' : (status === 'ready' ? 'OK' : status === 'building' ? 'WATCHING' : 'REGRESSING')}
        </StatusPill>
      </div>

      <CalibrationCurve points={points} />

      <div style={S.isoMetrics}>
        <div style={S.isoMetricRow}>
          <span className="eyebrow">Brier · train</span>
          <span className="numeric" style={S.isoMetricValue}>{fmtFloat(bt, 4)}</span>
        </div>
        <div style={S.isoMetricRow}>
          <span className="eyebrow">Brier · holdout</span>
          <span className="numeric" style={{
            ...S.isoMetricValue,
            color: ratio != null && ratio > 1.20 ? 'var(--storm-violet)' : 'var(--cloud-pearl)',
          }}>
            {fmtFloat(bh, 4)}
          </span>
        </div>
        <div style={S.isoMetricRow}>
          <span className="eyebrow">holdout / train</span>
          <span className="numeric" style={{
            ...S.isoMetricValue,
            fontWeight: 600,
            color: ratio == null ? 'var(--cloud-mute)'
                  : ratio > 1.20 ? 'var(--storm-violet)'
                  : ratio > 1.10 ? 'var(--sky-azure)'
                  : 'var(--dawn-gold)',
          }}>
            {ratio == null ? '—' : `${ratio.toFixed(3)}×`}
          </span>
        </div>
        <div style={S.isoMetricRow}>
          <span className="eyebrow">samples</span>
          <span className="numeric" style={S.isoMetricValue}>{fmtInt(fit.n_samples)}</span>
        </div>
      </div>

      {(fit.training_window_start || fit.training_window_end) && (
        <div style={S.isoWindow}>
          {fit.training_window_start || '—'} → {fit.training_window_end || '—'}
        </div>
      )}
    </div>
  );
}

/** Mini SVG calibration curve: raw probability on X axis, calibrated
 *  on Y axis.  Identity diagonal in faint stroke; control-point line
 *  in dawn-gold.  Departures from the diagonal show where the raw
 *  model needed correction. */
function CalibrationCurve({ points }) {
  const W = 220, H = 120, PAD = 6;
  const x = (p) => PAD + (W - 2 * PAD) * p;
  const y = (p) => H - PAD - (H - 2 * PAD) * p;

  if (!points || points.length === 0) {
    return (
      <div style={{
        height: H, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: 'var(--cloud-mute)',
        fontSize: 'var(--type-small)', fontStyle: 'italic',
        fontFamily: 'var(--font-display)',
      }}>
        no curve yet
      </div>
    );
  }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p[0])} ${y(p[1])}`).join(' ');

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}
         style={{ display: 'block' }} aria-label="Calibration curve">
      <defs>
        <linearGradient id="iso-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="var(--dawn-gold)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--dawn-gold)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Identity diagonal */}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)}
            stroke="var(--rule-mid)" strokeWidth="0.8"
            strokeDasharray="2 3" />
      {/* Filled area */}
      <path
        d={`${path} L ${x(points[points.length - 1][0])} ${H - PAD} L ${x(points[0][0])} ${H - PAD} Z`}
        fill="url(#iso-fill)" />
      {/* Control-point line */}
      <path d={path} stroke="var(--dawn-gold)" strokeWidth="1.4"
            fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {/* Control-point dots */}
      {points.map((p, i) => (
        <circle key={i} cx={x(p[0])} cy={y(p[1])} r="1.6"
                fill="var(--dawn-gold)" />
      ))}
      {/* Axis labels — sparse */}
      <text x={x(0)} y={H - 1} fill="var(--cloud-mute)"
            style={{ fontSize: 8, fontFamily: 'var(--font-mono)' }}>0</text>
      <text x={x(1) - 4} y={H - 1} fill="var(--cloud-mute)"
            style={{ fontSize: 8, fontFamily: 'var(--font-mono)' }}>1</text>
    </svg>
  );
}

/** One row in the per-city station-bias matrix. */
function BiasRow({ row, range }) {
  return (
    <div style={S.biasRow}>
      <div style={S.biasCity}>{row.city}</div>
      <BiasCell fit={row.high} range={range} />
      <BiasCell fit={row.low}  range={range} />
    </div>
  );
}

function BiasCell({ fit, range }) {
  if (!fit) {
    return (
      <div style={S.biasCellEmpty}>
        <span style={S.biasCellEmptyText}>—</span>
      </div>
    );
  }
  const bias = Number(fit.empirical_bias) || 0;
  const pct  = Math.min(1, Math.abs(bias) / range);
  const isPos = bias > 0;
  return (
    <div style={S.biasCell}>
      <div style={S.biasBarContainer}>
        <div style={S.biasBarTrack}>
          {/* Center tick */}
          <div style={S.biasCenterTick} />
          {/* The bar itself: starts from center, extends left or right */}
          <div style={{
            ...S.biasBarFill,
            left:  isPos ? '50%' : `${50 - pct * 50}%`,
            width: `${pct * 50}%`,
            background: isPos ? 'var(--dawn-gold)' : 'var(--sky-azure)',
          }} />
        </div>
      </div>
      <div style={S.biasNum}>
        <span style={{
          color: Math.abs(bias) > 4 ? 'var(--storm-violet)' : 'var(--cloud-pearl)',
          fontWeight: 500,
        }}>
          {bias > 0 ? '+' : ''}{bias.toFixed(2)}
        </span>
        <span style={S.biasN}>n={fmtInt(fit.n_samples)}</span>
      </div>
    </div>
  );
}

/** Histogram of all biases, ten bins from -range to +range. */
function BiasHistogram({ rows, range }) {
  const bins = 11;
  const counts = new Array(bins).fill(0);
  for (const r of rows) {
    const v = Number(r.empirical_bias);
    if (!Number.isFinite(v)) continue;
    // Map [-range, +range] to [0, bins-1].
    const norm = (v + range) / (2 * range);
    let idx = Math.floor(norm * bins);
    if (idx < 0) idx = 0;
    if (idx >= bins) idx = bins - 1;
    counts[idx] += 1;
  }
  const max = Math.max(...counts, 1);
  const W = 600, H = 80, BAR_GAP = 2;
  const barW = (W - BAR_GAP * (bins - 1)) / bins;
  return (
    <div style={S.histShell}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-2)', color: 'var(--cloud-mute)' }}>
        bias distribution · {fmtInt(rows.length)} active corrections
      </div>
      <svg width="100%" height={H + 14} viewBox={`0 0 ${W} ${H + 14}`} style={{ display: 'block' }}>
        {counts.map((c, i) => {
          const barH = (c / max) * H;
          const isCenter = (i === Math.floor(bins / 2));
          return (
            <g key={i}>
              <rect
                x={i * (barW + BAR_GAP)}
                y={H - barH}
                width={barW}
                height={barH}
                fill={isCenter ? 'var(--rule-mid)' : 'var(--sky-azure)'}
                opacity={c === 0 ? 0.2 : 0.9}
              />
              {c > 0 && (
                <text
                  x={i * (barW + BAR_GAP) + barW / 2}
                  y={H - barH - 2}
                  fill="var(--cloud-mute)"
                  textAnchor="middle"
                  style={{ fontSize: 8, fontFamily: 'var(--font-mono)' }}
                >
                  {c}
                </text>
              )}
            </g>
          );
        })}
        {/* Axis labels at edges + center */}
        <text x={0} y={H + 12} fill="var(--cloud-mute)"
              style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          {(-range).toFixed(1)}°F
        </text>
        <text x={W / 2} y={H + 12} fill="var(--cloud-haze)" textAnchor="middle"
              style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          0°F
        </text>
        <text x={W} y={H + 12} fill="var(--cloud-mute)" textAnchor="end"
              style={{ fontSize: 9, fontFamily: 'var(--font-mono)' }}>
          +{range.toFixed(1)}°F
        </text>
      </svg>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtFloat(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}
function fmtCoeff(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const x = Number(v);
  if (Math.abs(x) < 0.005) return x.toFixed(3);
  return x.toFixed(2);
}

// ─── Styles ──────────────────────────────────────────────────────────

const S = {
  // ── Aggregate banner
  aggregateCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    marginBottom: 'var(--space-5)',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 'var(--space-5)',
    alignItems: 'center',
  },
  aggregateLabel: {
    color: 'var(--cloud-haze)',
    fontSize: 'var(--type-small)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  aggregateLayers: {
    display: 'flex',
    gap: 'var(--space-4)',
  },

  // Layer health chip
  layerChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    paddingLeft: 'var(--space-3)',
    borderLeft: '1px solid var(--rule-faint)',
  },
  layerDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    boxShadow: '0 0 0 3px color-mix(in srgb, currentColor 18%, transparent)',
  },
  layerLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
  },
  layerState: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    letterSpacing: '0.02em',
  },

  // ── Panel wrapper
  panelOuter: {
    marginBottom: 'var(--space-6)',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
    borderBottom: '1px solid var(--rule-faint)',
    gap: 'var(--space-4)',
  },
  panelEyebrow: {
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-1)',
  },
  panelTitle: {
    fontFamily: 'var(--font-headings, var(--font-display))',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
  panelMeta: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
    textAlign: 'right',
    maxWidth: '40%',
  },
  panelBody: {},

  // ── Tile row
  tileRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  tile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    minHeight: 100,
  },
  tileValue: {
    fontSize: 'var(--type-display)',
    lineHeight: 1.05,
    marginTop: 'var(--space-2)',
  },
  tileSub: {
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-1)',
  },

  // ── Watchlist table
  cardSlab: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    overflowX: 'auto',
  },
  cardSlabEyebrow: {
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-3)',
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
  tdLeft: { textAlign: 'left',  padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-pearl)' },
  tdRight: { textAlign: 'right', padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-haze)' },
  cellMarketType: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  cellLead: {
    color: 'var(--cloud-mute)',
    fontSize: 'var(--type-micro)',
  },
  cellScope: {
    color: 'var(--cloud-haze)',
  },

  // ── Empty state
  empty: {
    padding: 'var(--space-5)',
    textAlign: 'center',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    lineHeight: 1.6,
  },

  // ── Isotonic
  isotonicGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'var(--space-3)',
  },
  isoCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },
  isoCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  isoCardMt: {
    fontFamily: 'var(--font-headings, var(--font-display))',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    letterSpacing: '0.04em',
  },
  isoMetrics: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    paddingTop: 'var(--space-2)',
    borderTop: '1px solid var(--rule-faint)',
  },
  isoMetricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  isoMetricValue: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
  },
  isoWindow: {
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    fontFamily: 'var(--font-mono)',
    paddingTop: 'var(--space-1)',
    textAlign: 'center',
  },

  // ── Bias panel
  biasShell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },
  biasGrid: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
  },
  biasRow: {
    display: 'grid',
    gridTemplateColumns: '120px 1fr 1fr',
    gap: 'var(--space-3)',
    paddingTop: 'var(--space-2)',
    paddingBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--rule-faint)',
    alignItems: 'center',
  },
  biasCity: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.01em',
  },
  biasCell: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 'var(--space-3)',
    alignItems: 'center',
  },
  biasCellEmpty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--cloud-mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
  },
  biasCellEmptyText: { opacity: 0.4 },
  biasBarContainer: {
    position: 'relative',
    width: '100%',
  },
  biasBarTrack: {
    position: 'relative',
    height: 8,
    background: 'var(--ink-mid)',
    borderRadius: 'var(--radius-pill)',
    overflow: 'hidden',
  },
  biasCenterTick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    background: 'var(--rule-mid)',
    zIndex: 2,
  },
  biasBarFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    transition: 'width var(--motion-glide), left var(--motion-glide)',
    zIndex: 1,
  },
  biasNum: {
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    minWidth: 88,
    textAlign: 'right',
  },
  biasN: {
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginTop: 1,
  },
  histShell: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
  },

  // ── Footnote
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-4)',
    maxWidth: '72ch',
    lineHeight: 1.6,
  },
};
