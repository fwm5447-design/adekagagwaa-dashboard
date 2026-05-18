'use client';

import { useMemo, useState } from 'react';
import SectionFrame from '../layout/SectionFrame';

/**
 * ForecastVsSettled — "Hindsight".
 *
 * Twenty small-multiples below the WeatherMap.  Each tile is one
 * city; inside it, the bot's pre-settle μ (dawn-gold) is overlaid
 * against the canonical observation (cloud-pearl) over the last
 * 21 days.  Days where |n_sigma| ≥ 2 get a violet marker so the
 * eye finds blowouts immediately.
 *
 * Data shape (rows from analytics.forecast_errors, ordered by
 * city, market_type, target_date ASC):
 *   { city, market_type, target_date, bot_mu, bot_sigma,
 *     observed_value, error, abs_error, n_sigma, ... }
 */

// Tile geometry.  Designed for a 4-wide grid that gracefully
// collapses to 2-wide / 1-wide on narrow viewports.
const TILE_W = 280;
const TILE_H = 140;
const PAD_L  = 30;   // left axis label space
const PAD_R  = 8;
const PAD_T  = 8;
const PAD_B  = 18;   // x-axis date label

// ASOS-anchored city order — keeps the grid stable even when one
// city has no rows yet (the placeholder still occupies its slot).
const CITY_ORDER = [
  'New York', 'Los Angeles',   'Miami',        'Chicago',
  'Phoenix',  'Austin',        'Atlanta',      'Denver',
  'Seattle',  'Washington',    'Boston',       'San Francisco',
  'Philadelphia', 'Minneapolis', 'Dallas',     'Las Vegas',
  'Houston',  'Oklahoma City', 'New Orleans',  'San Antonio',
];


export default function ForecastVsSettled({ rows, freshness }) {
  const allRows  = useMemo(() => Array.isArray(rows) ? rows : [], [rows]);
  const [marketType, setMarketType] = useState('high');

  // Filter to active market type, then group by city.  We key the
  // map by a normalized form (trimmed + lowercased) so a stray
  // whitespace or casing difference in the DB doesn't drop a city
  // from the grid.  CITY_ORDER's labels go through the same
  // normalization at lookup time.
  const byCity = useMemo(() => {
    const m = new Map();
    for (const r of allRows) {
      if (String(r.market_type || '').toLowerCase() !== marketType) continue;
      const key = cityKey(r.city);
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [allRows, marketType]);

  // Compute shared y-axis range across all visible cities so the
  // tiles read comparably.  Pad ±2°F so the lines don't kiss the
  // tile edges.
  const yRange = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const arr of byCity.values()) {
      for (const r of arr) {
        const mu  = num(r.bot_mu);
        const obs = num(r.observed_value);
        if (mu  != null) { if (mu  < lo) lo = mu;  if (mu  > hi) hi = mu;  }
        if (obs != null) { if (obs < lo) lo = obs; if (obs > hi) hi = obs; }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 100 };
    return { lo: lo - 2, hi: hi + 2 };
  }, [byCity]);

  // Shared x-axis: ordered list of unique target_dates across all
  // cities.  Most cities will have rows on the same days, but if
  // one is missing a day the tile shows a gap at that x-slot.
  const xDates = useMemo(() => {
    const set = new Set();
    for (const arr of byCity.values()) {
      for (const r of arr) {
        if (r.target_date) set.add(String(r.target_date).slice(0, 10));
      }
    }
    return Array.from(set).sort();
  }, [byCity]);

  // Aggregate stats across all paired (predicted, observed) rows in
  // the active mode — RMSE, bias, ≥2σ rate, ≥3σ rate.
  const agg = useMemo(() => {
    let n = 0, ss = 0, sumErr = 0, n2 = 0, n3 = 0;
    for (const arr of byCity.values()) {
      for (const r of arr) {
        const e = num(r.error);
        const ns = num(r.n_sigma);
        if (e == null) continue;
        n++;
        ss += e * e;
        sumErr += e;
        if (ns != null && Math.abs(ns) >= 2) n2++;
        if (ns != null && Math.abs(ns) >= 3) n3++;
      }
    }
    if (n === 0) return null;
    return {
      n,
      rmse: Math.sqrt(ss / n),
      bias: sumErr / n,
      pct2: (n2 / n) * 100,
      pct3: (n3 / n) * 100,
    };
  }, [byCity]);

  const targetWindow = useMemo(() => {
    if (xDates.length === 0) return '—';
    return `${shortDate(xDates[0])} → ${shortDate(xDates[xDates.length - 1])}`;
  }, [xDates]);

  const toolbar = (
    <div style={S.toggleGroup}>
      <button onClick={() => setMarketType('high')}
              style={{ ...S.miniPill, ...(marketType === 'high' ? S.miniPillActive : null) }}
              aria-pressed={marketType === 'high'}>HIGH</button>
      <button onClick={() => setMarketType('low')}
              style={{ ...S.miniPill, ...(marketType === 'low' ? S.miniPillActive : null) }}
              aria-pressed={marketType === 'low'}>LOW</button>
    </div>
  );

  return (
    <SectionFrame
      id="forecast-vs-settled"
      invocation="Hindsight"
      title="Predicted vs Settled"
      subtitle="Twenty cities, the last three weeks.  Each tile overlays the bot&rsquo;s pre-settle μ against the canonical settled observation.  Violet pulses are days the forecast missed by two or more sigmas — where the model was honestly surprised."
      freshnessAt={freshness}
      freshnessCadenceSec={86400}
      toolbar={toolbar}
    >
      {agg ? (
        <div style={S.statRow}>
          <Stat label="paired days" value={String(agg.n)} />
          <Stat label="RMSE"   value={`${agg.rmse.toFixed(2)}°`} accent="gold" />
          <Stat label="bias"   value={`${agg.bias >= 0 ? '+' : ''}${agg.bias.toFixed(2)}°`}
                accent={Math.abs(agg.bias) > 1 ? 'violet' : 'gold'} />
          <Stat label="≥2σ"    value={`${agg.pct2.toFixed(1)}%`}
                accent={agg.pct2 > 5 ? 'violet' : 'gold'}
                hint="target ≤ 5%" />
          <Stat label="≥3σ"    value={`${agg.pct3.toFixed(1)}%`}
                accent={agg.pct3 > 0.3 ? 'violet' : 'gold'}
                hint="target ≤ 0.3%" />
          <Stat label="window" value={targetWindow} />
        </div>
      ) : (
        <div style={S.empty}>
          awaiting paired forecasts · <code style={S.code}>analytics.forecast_errors</code>
        </div>
      )}

      <div style={S.grid}>
        {CITY_ORDER.map((city) => (
          <CityTile
            key={city}
            city={city}
            rows={byCity.get(cityKey(city)) || []}
            yLo={yRange.lo}
            yHi={yRange.hi}
            xDates={xDates}
          />
        ))}
      </div>

      <Legend />
    </SectionFrame>
  );
}


// ─────────────────────────────────────────────────────────────────────
// CityTile — one small-multiple
// ─────────────────────────────────────────────────────────────────────
function CityTile({ city, rows, yLo, yHi, xDates }) {
  const plotW = TILE_W - PAD_L - PAD_R;
  const plotH = TILE_H - PAD_T - PAD_B;

  // Index rows by date so we can walk xDates and emit ordered points.
  const byDate = new Map();
  for (const r of rows) {
    if (r.target_date) byDate.set(String(r.target_date).slice(0, 10), r);
  }

  // Build pred & obs polylines aligned to the shared date axis.
  const xN = Math.max(1, xDates.length - 1);
  const xFor = (i) => PAD_L + (xDates.length === 1 ? plotW / 2 : (i / xN) * plotW);
  const yFor = (v) => {
    const t = (v - yLo) / Math.max(0.0001, yHi - yLo);
    return PAD_T + plotH - t * plotH;
  };

  const predPts = [];
  const obsPts  = [];
  const blowouts = [];
  let latest = null;

  xDates.forEach((d, i) => {
    const r = byDate.get(d);
    if (!r) return;
    const mu  = num(r.bot_mu);
    const obs = num(r.observed_value);
    const ns  = num(r.n_sigma);
    if (mu  != null) predPts.push([xFor(i), yFor(mu)]);
    if (obs != null) obsPts.push([xFor(i), yFor(obs), { ns, mu, obs, d }]);
    if (mu != null && obs != null && ns != null && Math.abs(ns) >= 2) {
      blowouts.push({ x: xFor(i), yMu: yFor(mu), yObs: yFor(obs), ns });
    }
    if (mu != null || obs != null) {
      latest = { d, mu, obs, ns, sigma: num(r.bot_sigma), err: num(r.error) };
    }
  });

  const path = (pts) => pts.length === 0
    ? ''
    : pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const hasData = predPts.length > 0 || obsPts.length > 0;

  // Y-axis tick marks at lo, mid, hi.
  const ticks = [yLo, (yLo + yHi) / 2, yHi];

  return (
    <div style={S.tile}>
      <div style={S.tileHead}>
        <div style={S.tileCity}>{city}</div>
        {latest && (
          <div style={S.tileLatest}>
            <span style={S.tileLatestPred}>{fmt0(latest.mu)}°</span>
            <span style={S.tileLatestArrow}>→</span>
            <span style={S.tileLatestObs}>{fmt0(latest.obs)}°</span>
            {latest.ns != null && Math.abs(latest.ns) >= 2 && (
              <span style={S.tileSigmaChip}>
                {latest.ns >= 0 ? '+' : ''}{latest.ns.toFixed(1)}σ
              </span>
            )}
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${TILE_W} ${TILE_H}`} style={S.tileSvg}
           preserveAspectRatio="none"
           role="img"
           aria-label={`${city} predicted vs settled, last ${xDates.length} days`}>
        {/* Plot frame */}
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH}
              fill="rgba(10, 14, 20, 0.4)"
              stroke="var(--rule-faint)" strokeWidth="0.5" />

        {/* Y gridlines */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={PAD_L + plotW}
                  y1={yFor(t)} y2={yFor(t)}
                  stroke="var(--rule-faint)" strokeWidth="0.5"
                  strokeDasharray="2 3" />
            <text x={PAD_L - 4} y={yFor(t) + 3}
                  textAnchor="end"
                  fill="var(--cloud-mute)"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 8 }}>
              {t.toFixed(0)}°
            </text>
          </g>
        ))}

        {hasData ? (
          <>
            {/* Connector segments between pred and obs on blowout days */}
            {blowouts.map((b, i) => (
              <line key={`bl-${i}`}
                    x1={b.x} x2={b.x}
                    y1={b.yMu} y2={b.yObs}
                    stroke="var(--storm-violet)"
                    strokeWidth="1.2"
                    opacity="0.55" />
            ))}

            {/* Predicted line — dawn-gold */}
            <path d={path(predPts)}
                  fill="none"
                  stroke="var(--dawn-gold)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.95" />
            {/* Predicted dots */}
            {predPts.map(([x, y], i) => (
              <circle key={`p-${i}`} cx={x} cy={y} r="1.6"
                      fill="var(--dawn-gold)" opacity="0.9" />
            ))}

            {/* Observed line — cloud-pearl */}
            <path d={path(obsPts.map(([x, y]) => [x, y]))}
                  fill="none"
                  stroke="var(--cloud-pearl)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.85" />
            {/* Observed dots — violet ring for ≥2σ misses */}
            {obsPts.map(([x, y, meta], i) => {
              const big = meta?.ns != null && Math.abs(meta.ns) >= 2;
              return (
                <g key={`o-${i}`}>
                  {big && (
                    <circle cx={x} cy={y} r="4"
                            fill="none"
                            stroke="var(--storm-violet)"
                            strokeWidth="1.1"
                            opacity="0.85">
                      <animate attributeName="r" values="3;5;3"
                               dur="2.4s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.85;0.35;0.85"
                               dur="2.4s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={x} cy={y} r="1.8"
                          fill="var(--cloud-pearl)" opacity="0.95" />
                </g>
              );
            })}
          </>
        ) : (
          <text x={PAD_L + plotW / 2} y={PAD_T + plotH / 2}
                textAnchor="middle" dominantBaseline="middle"
                fill="var(--cloud-mute)"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontStyle: 'italic',
                  fontSize: 11,
                }}>
            no paired data
          </text>
        )}

        {/* X axis labels — first + last */}
        {xDates.length > 0 && (
          <>
            <text x={PAD_L} y={TILE_H - 4}
                  textAnchor="start"
                  fill="var(--cloud-mute)"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 8 }}>
              {shortDate(xDates[0])}
            </text>
            <text x={PAD_L + plotW} y={TILE_H - 4}
                  textAnchor="end"
                  fill="var(--cloud-mute)"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 8 }}>
              {shortDate(xDates[xDates.length - 1])}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Stat / Legend
// ─────────────────────────────────────────────────────────────────────
function Stat({ label, value, accent, hint }) {
  const color = accent === 'violet'
    ? 'var(--storm-violet)'
    : accent === 'gold'
      ? 'var(--dawn-gold)'
      : 'var(--cloud-pearl)';
  return (
    <div style={S.stat}>
      <div className="eyebrow" style={S.statLabel}>{label}</div>
      <div className="numeric" style={{ ...S.statValue, color }}>{value}</div>
      {hint && <div style={S.statHint}>{hint}</div>}
    </div>
  );
}

function Legend() {
  return (
    <div style={S.legendRow}>
      <div style={S.legendItem}>
        <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3"
              stroke="var(--dawn-gold)" strokeWidth="1.8" /></svg>
        <span style={S.legendLabel}>predicted μ</span>
      </div>
      <div style={S.legendItem}>
        <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3"
              stroke="var(--cloud-pearl)" strokeWidth="1.8" /></svg>
        <span style={S.legendLabel}>settled observation</span>
      </div>
      <div style={S.legendItem}>
        <svg width="14" height="14" viewBox="-7 -7 14 14">
          <circle cx="0" cy="0" r="4.5" fill="none"
                  stroke="var(--storm-violet)" strokeWidth="1.1" />
        </svg>
        <span style={S.legendLabel}>|n_sigma| ≥ 2</span>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function cityKey(name) {
  if (name == null) return '';
  return String(name).trim().toLowerCase();
}
function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmt0(v) {
  const n = num(v);
  return n == null ? '—' : n.toFixed(0);
}
function shortDate(iso) {
  if (!iso) return '—';
  const s = String(iso).slice(0, 10);
  // 2026-05-12 → 5/12
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}


// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const S = {
  toggleGroup: {
    display: 'flex',
    gap: 'var(--space-1)',
  },
  miniPill: {
    appearance: 'none',
    background: 'var(--ink-deep)',
    color: 'var(--cloud-haze)',
    border: '1px solid var(--rule-faint)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    letterSpacing: '0.08em',
    padding: '5px 10px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'all var(--motion-glide)',
  },
  miniPillActive: {
    background: 'var(--dawn-gold)',
    color: 'var(--ink-deep)',
    borderColor: 'var(--dawn-gold)',
    fontWeight: 500,
  },

  statRow: {
    display: 'flex',
    gap: 'var(--space-5)',
    flexWrap: 'wrap',
    padding: 'var(--space-3) var(--space-4)',
    background: 'rgba(10, 14, 20, 0.45)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 80,
  },
  statLabel: {
    color: 'var(--cloud-mute)',
  },
  statValue: {
    fontSize: 'var(--type-large)',
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },
  statHint: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    color: 'var(--cloud-shade)',
    letterSpacing: '0.04em',
  },

  empty: {
    padding: 'var(--space-4)',
    background: 'rgba(10, 14, 20, 0.45)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
    color: 'var(--cloud-mute)',
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
  },
  code: {
    fontFamily: 'var(--font-mono)',
    fontStyle: 'normal',
    background: 'var(--ink-mid)',
    padding: '1px 6px',
    borderRadius: 3,
    color: 'var(--cloud-pearl)',
  },

  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 'var(--space-3)',
  },

  tile: {
    background: 'rgba(19, 26, 35, 0.55)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-2) var(--space-3) var(--space-1)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  tileHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 'var(--space-2)',
  },
  tileCity: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    fontWeight: 500,
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.01em',
  },
  tileLatest: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
  },
  tileLatestPred: {
    color: 'var(--dawn-gold)',
    fontWeight: 500,
  },
  tileLatestArrow: {
    color: 'var(--cloud-mute)',
    fontSize: 9,
  },
  tileLatestObs: {
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
  },
  tileSigmaChip: {
    marginLeft: 4,
    padding: '1px 5px',
    background: 'color-mix(in srgb, var(--storm-violet) 25%, transparent)',
    color: 'var(--cloud-pearl)',
    border: '1px solid color-mix(in srgb, var(--storm-violet) 55%, transparent)',
    borderRadius: 'var(--radius-pill)',
    fontSize: 9,
  },
  tileSvg: {
    width: '100%',
    height: TILE_H,
    display: 'block',
  },

  legendRow: {
    display: 'flex',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
    marginTop: 'var(--space-3)',
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--rule-faint)',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  legendLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-haze)',
    letterSpacing: '0.04em',
  },
};
