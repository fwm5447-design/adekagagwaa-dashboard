'use client';

import { useEffect, useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import SectionFrame from '../layout/SectionFrame';

/**
 * WeatherMap — twenty cities, four+ views, one atmosphere.
 *
 * Each market we trade gets a marker on the US map.  Mode pills
 * change what each marker is colored and labeled by:
 *
 *   FORECAST — today's HIGH/LOW μ from the latest forecast cycle.
 *              Cool blue (cold) → ivory → warm gold (hot).
 *   SPREAD   — predictive σ.  Serene blue (agreement) →
 *              storm violet (disagreement = likely mispricing).
 *   MARKET   — Kalshi yes-mid for the active threshold.
 *              Coral 0¢ → ivory 50¢ → gold 100¢.
 *   MARINE   — coastal cities only; inland greyed.  Marine-layer
 *              data plumbed in v2.
 *   EDGE     — |μ − threshold| heatmap when thresholds are
 *              available; falls back to σ when not.
 *
 * Topology: us-atlas@3 states-10m.json from jsDelivr (~80KB,
 * browser-cached).  d3-geo's geoAlbersUsa handles AK/HI insets
 * gracefully even though we have no cities there.
 *
 * Data shape (passed via the `data` prop):
 *
 *   {
 *     forecasts: [{ city, market_type, mu_cal, sigma_cal,
 *                   q10, q50, q90, n_sources, target_date,
 *                   generated_at, ... }, ...],
 *     markets:   { [city]: { high|low: { yes_bid, yes_ask, threshold } } },
 *     thresholds:{ [city]: { high|low: number } }
 *   }
 *
 * forecasts is required.  markets and thresholds are optional;
 * when missing, MARKET/EDGE modes show graceful "—" states.
 */

// ─── 20 ASOS-anchored city coordinates (from core/cities.py) ────────
const CITIES = [
  { name: 'New York',      asos: 'KNYC', lat: 40.7789, lon:  -73.9692, marine: true  },
  { name: 'Los Angeles',   asos: 'KLAX', lat: 33.9425, lon: -118.4081, marine: true  },
  { name: 'Miami',         asos: 'KMIA', lat: 25.7959, lon:  -80.2870, marine: true  },
  { name: 'Chicago',       asos: 'KMDW', lat: 41.7868, lon:  -87.7522, marine: false },
  { name: 'Phoenix',       asos: 'KPHX', lat: 33.4373, lon: -112.0078, marine: false },
  { name: 'Austin',        asos: 'KAUS', lat: 30.1975, lon:  -97.6664, marine: false },
  { name: 'Atlanta',       asos: 'KATL', lat: 33.6407, lon:  -84.4277, marine: false },
  { name: 'Denver',        asos: 'KDEN', lat: 39.8561, lon: -104.6737, marine: false },
  { name: 'Seattle',       asos: 'KSEA', lat: 47.4502, lon: -122.3088, marine: true  },
  { name: 'Washington',    asos: 'KDCA', lat: 38.8521, lon:  -77.0377, marine: false },
  { name: 'Boston',        asos: 'KBOS', lat: 42.3631, lon:  -71.0064, marine: true  },
  { name: 'San Francisco', asos: 'KSFO', lat: 37.6213, lon: -122.3790, marine: true  },
  { name: 'Philadelphia',  asos: 'KPHL', lat: 39.8729, lon:  -75.2437, marine: false },
  { name: 'Minneapolis',   asos: 'KMSP', lat: 44.8848, lon:  -93.2223, marine: false },
  { name: 'Dallas',        asos: 'KDFW', lat: 32.8998, lon:  -97.0403, marine: false },
  { name: 'Las Vegas',     asos: 'KLAS', lat: 36.0840, lon: -115.1537, marine: false },
  { name: 'Houston',       asos: 'KHOU', lat: 29.6454, lon:  -95.2789, marine: true  },
  { name: 'Oklahoma City', asos: 'KOKC', lat: 35.3931, lon:  -97.6008, marine: false },
  { name: 'New Orleans',   asos: 'KMSY', lat: 29.9934, lon:  -90.2580, marine: true  },
  { name: 'San Antonio',   asos: 'KSAT', lat: 29.5337, lon:  -98.4698, marine: false },
];

const TOPO_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';
const MAP_W = 960;
const MAP_H = 600;

const MODES = [
  { id: 'forecast', label: 'Forecast', caption: "today's μ from the latest cycle" },
  { id: 'spread',   label: 'Spread',   caption: 'σ across the active ensemble' },
  { id: 'market',   label: 'Market',   caption: 'Kalshi yes-mid for the active threshold' },
  { id: 'marine',   label: 'Marine',   caption: 'coastal cities only · marine-layer plumbing in v2' },
  { id: 'edge',     label: 'Edge',     caption: '|μ − threshold| heat · largest gaps light up' },
];


export default function WeatherMap({ data, freshness }) {
  const forecasts  = data?.forecasts  || [];
  const markets    = data?.markets    || null;
  const thresholds = data?.thresholds || null;

  const [mode, setMode] = useState('forecast');
  const [marketType, setMarketType] = useState('high');
  const [hover, setHover] = useState(null);
  const [topo, setTopo] = useState(null);
  const [topoErr, setTopoErr] = useState(null);

  // Fetch TopoJSON once on mount
  useEffect(() => {
    let cancelled = false;
    fetch(TOPO_URL, { cache: 'force-cache' })
      .then((r) => { if (!r.ok) throw new Error(`Topology fetch ${r.status}`); return r.json(); })
      .then((json) => {
        if (cancelled) return;
        const states  = feature(json, json.objects.states);
        const borders = mesh(json, json.objects.states, (a, b) => a !== b);
        setTopo({ states, borders });
      })
      .catch((e) => { if (!cancelled) setTopoErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  // Projection + path generator — stable across renders
  const { projection, pathGen } = useMemo(() => {
    const proj = geoAlbersUsa().scale(1280).translate([MAP_W / 2, MAP_H / 2]);
    return { projection: proj, pathGen: geoPath(proj) };
  }, []);

  // Project the 20 cities into SVG space
  const projected = useMemo(() => {
    return CITIES.map((c) => {
      const xy = projection([c.lon, c.lat]);
      return { ...c, x: xy ? xy[0] : null, y: xy ? xy[1] : null };
    });
  }, [projection]);

  // Forecast lookup table
  const byCityMt = useMemo(() => {
    const m = new Map();
    for (const r of forecasts) m.set(`${r.city}::${r.market_type}`, r);
    return m;
  }, [forecasts]);

  // Per-city VALUES for the active mode
  const cityValues = useMemo(() => {
    return projected.map((c) => {
      const fcst = byCityMt.get(`${c.name}::${marketType}`);
      const mkt  = markets?.[c.name]?.[marketType] ?? null;
      const thr  = thresholds?.[c.name]?.[marketType] ?? null;

      let value = null, label = '—', active = true;

      switch (mode) {
        case 'forecast':
          if (fcst && Number.isFinite(Number(fcst.mu_cal))) {
            value = Number(fcst.mu_cal);
            label = `${value.toFixed(0)}°`;
          }
          break;
        case 'spread':
          if (fcst && Number.isFinite(Number(fcst.sigma_cal))) {
            value = Number(fcst.sigma_cal);
            label = value.toFixed(1);
          }
          break;
        case 'market':
          if (mkt && (mkt.yes_bid != null || mkt.yes_ask != null)) {
            const a = Number(mkt.yes_bid) || 0;
            const b = Number(mkt.yes_ask) || 0;
            const mid = (a + b) / 2;
            value = mid;
            label = `${(mid * 100).toFixed(0)}¢`;
          }
          break;
        case 'marine':
          active = c.marine;
          if (!active) { value = null; label = '·'; }
          else if (fcst && Number.isFinite(Number(fcst.sigma_cal))) {
            value = Number(fcst.sigma_cal);
            label = value.toFixed(1);
          }
          break;
        case 'edge':
          if (fcst && thr != null && Number.isFinite(Number(fcst.mu_cal))) {
            value = Math.abs(Number(fcst.mu_cal) - Number(thr));
            label = `${value.toFixed(1)}°`;
          } else if (fcst && Number.isFinite(Number(fcst.sigma_cal))) {
            value = Number(fcst.sigma_cal);
            label = `~${value.toFixed(1)}`;
          }
          break;
      }
      return { ...c, value, label, active, fcst, mkt, thr };
    });
  }, [projected, byCityMt, markets, thresholds, mode, marketType]);

  // Value range for color normalization
  const valueRange = useMemo(() => {
    const vals = cityValues
      .filter((c) => c.active && c.value != null && Number.isFinite(c.value))
      .map((c) => c.value);
    if (vals.length === 0) return { min: 0, max: 1, hasRange: false };
    return { min: Math.min(...vals), max: Math.max(...vals), hasRange: true };
  }, [cityValues]);

  // Color picker per mode
  function colorFor(c) {
    if (!c.active || c.value == null || !Number.isFinite(c.value)) {
      return { fill: 'var(--ink-mid)', stroke: 'var(--rule-mid)', text: 'var(--cloud-mute)' };
    }
    const t = valueRange.hasRange
      ? (c.value - valueRange.min) / Math.max(0.0001, valueRange.max - valueRange.min)
      : 0.5;
    if (mode === 'forecast')              return ramp3(t, [38, 85, 130], [220, 215, 195], [212, 169, 60]);
    if (mode === 'spread' || mode === 'marine') return ramp2(t, [38, 85, 130], [126, 79, 168]);
    if (mode === 'market')                return ramp3(Math.max(0, Math.min(1, c.value)),
                                                       [186, 78, 88], [220, 215, 195], [212, 169, 60]);
    if (mode === 'edge')                  return ramp2(t, [60, 70, 90], [212, 169, 60]);
    return { fill: 'var(--cloud-pearl)', stroke: 'var(--rule-mid)', text: 'var(--ink-deep)' };
  }

  // Drift cumulus particles — built once, deterministic positions
  const driftParticles = useMemo(() => buildDrift(18), []);

  return (
    <SectionFrame
      id="weather-map"
      invocation="The Atmosphere"
      title="The Atmosphere"
      subtitle="Twenty cities and the air above them.  Pick a lens and the cities re-color — what the model is forecasting, where it's uncertain, where Kalshi disagrees, where the marine layer presses inland."
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {/* Mode + market_type controls */}
      <div style={S.controlRow}>
        <div style={S.pillRow}>
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{ ...S.pill, ...(mode === m.id ? S.pillActive : null) }}
              aria-pressed={mode === m.id}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div style={S.toggleGroup}>
          <button onClick={() => setMarketType('high')}
                  style={{ ...S.miniPill, ...(marketType === 'high' ? S.miniPillActive : null) }}
                  aria-pressed={marketType === 'high'}>HIGH</button>
          <button onClick={() => setMarketType('low')}
                  style={{ ...S.miniPill, ...(marketType === 'low' ? S.miniPillActive : null) }}
                  aria-pressed={marketType === 'low'}>LOW</button>
        </div>
      </div>

      <div className="numeric" style={S.modeCaption}>
        {MODES.find((m) => m.id === mode)?.caption} · target_date {forecastTargetDate(forecasts) || '—'}
      </div>

      {/* Map */}
      <div style={S.mapShell}>
        <style>{driftKeyframes}</style>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={S.mapSvg}
             role="img" aria-label="Weather map of 20 US cities"
             preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="map-atmosphere" cx="50%" cy="55%" r="65%">
              <stop offset="0%" stopColor="var(--ink-mid)" stopOpacity="0.6">
                <animate attributeName="stop-opacity" values="0.6;0.85;0.6"
                         dur="32s" repeatCount="indefinite" />
              </stop>
              <stop offset="60%"  stopColor="var(--ink-deep)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--ink-deep)" stopOpacity="0.95" />
            </radialGradient>
            <filter id="map-particle-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <linearGradient id="state-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--ink-deep)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--ink-deep)" stopOpacity="0.45" />
            </linearGradient>
            <filter id="marker-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#map-atmosphere)" />

          <g style={{ mixBlendMode: 'screen' }}>
            {driftParticles.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={p.r}
                      fill="var(--cloud-pearl)" opacity={p.opacity}
                      filter="url(#map-particle-blur)"
                      style={{
                        animation: `${p.anim} ${p.dur}s linear infinite`,
                        animationDelay: `${p.delay}s`,
                      }} />
            ))}
          </g>

          {topo && (
            <g>
              <path d={topo.states.features.map((f) => pathGen(f)).join(' ')}
                    fill="url(#state-fill)" stroke="none" />
              <path d={pathGen(topo.borders)} fill="none"
                    stroke="var(--rule-faint)" strokeWidth="0.7"
                    strokeOpacity="0.65" strokeLinejoin="round" />
            </g>
          )}
          {!topo && !topoErr && (
            <text x={MAP_W / 2} y={MAP_H / 2} fill="var(--cloud-mute)"
                  textAnchor="middle"
                  style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 14 }}>
              Loading topology…
            </text>
          )}
          {topoErr && (
            <text x={MAP_W / 2} y={MAP_H / 2} fill="var(--storm-violet)"
                  textAnchor="middle"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              Topology load failed · {topoErr}
            </text>
          )}

          {/* City markers */}
          <g>
            {cityValues.map((c) => {
              if (c.x == null || c.y == null) return null;
              const col = colorFor(c);
              const r = c.active ? 26 : 14;
              return (
                <g key={c.name} transform={`translate(${c.x}, ${c.y})`}
                   onMouseEnter={() => setHover(c.name)}
                   onMouseLeave={() => setHover(null)}
                   style={{ cursor: 'pointer' }}>
                  {c.active && c.value != null && (
                    <circle cx="0" cy="0" r={r + 6}
                            fill={col.fill} opacity="0.28"
                            filter="url(#marker-glow)" />
                  )}
                  <rect x={-r} y={-r * 0.55} width={r * 2} height={r * 1.1} rx={3}
                        fill={col.fill} stroke={col.stroke} strokeWidth="0.8"
                        opacity={c.active ? 1 : 0.4} />
                  <text x="0" y="0" textAnchor="middle" dominantBaseline="middle"
                        fill={col.text}
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500,
                          letterSpacing: '-0.02em', pointerEvents: 'none',
                        }}>
                    {c.label}
                  </text>
                  <text x="0" y={r * 0.55 + 11} textAnchor="middle"
                        fill="var(--cloud-haze)"
                        style={{
                          fontFamily: 'var(--font-mono)', fontSize: 9,
                          letterSpacing: '0.04em', pointerEvents: 'none',
                          opacity: c.active ? 0.85 : 0.4,
                        }}>
                    {c.asos}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {hover && (
          <HoverCard
            city={cityValues.find((c) => c.name === hover)}
            marketType={marketType}
          />
        )}
      </div>

      <div style={S.legendRow}>
        <Legend mode={mode} valueRange={valueRange} marketType={marketType} />
        <div style={S.legendMeta}>
          {forecasts.length === 0 ? (
            <span style={{ color: 'var(--cloud-mute)' }}>
              awaiting forecasts · <code style={S.code}>analytics.v_map_today</code>
            </span>
          ) : (
            <>
              <span>{forecasts.length} forecasts</span>
              <span style={S.legendDot} />
              <span>{cityValues.filter((c) => c.value != null).length} of 20 active</span>
            </>
          )}
        </div>
      </div>
    </SectionFrame>
  );
}


// ─── Hover card ──────────────────────────────────────────────────────
function HoverCard({ city, marketType }) {
  if (!city) return null;
  const f = city.fcst;
  const m = city.mkt;
  return (
    <div style={S.hoverCard}>
      <div style={S.hoverHead}>
        <div>
          <div style={S.hoverCity}>{city.name}</div>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
            {city.asos} · {marketType.toUpperCase()}
          </div>
        </div>
        {city.marine && <div style={S.hoverChip}>marine</div>}
      </div>

      {f ? (
        <div style={S.hoverBlock}>
          <div className="eyebrow" style={S.hoverEyebrow}>forecast</div>
          <div style={S.hoverGrid}>
            <Row label="μ"       value={fmt1(f.mu_cal)}     unit="°F" />
            <Row label="σ"       value={fmt1(f.sigma_cal)}  unit="°F" />
            <Row label="p10"     value={fmt0(f.q10)}        unit="°F" />
            <Row label="p50"     value={fmt0(f.q50)}        unit="°F" />
            <Row label="p90"     value={fmt0(f.q90)}        unit="°F" />
            <Row label="sources" value={f.n_sources ?? '—'} unit="" />
          </div>
        </div>
      ) : (
        <div style={S.hoverEmpty}>no recent forecast</div>
      )}

      {m && (m.yes_bid != null || m.yes_ask != null) && (
        <div style={S.hoverBlock}>
          <div className="eyebrow" style={S.hoverEyebrow}>market</div>
          <div style={S.hoverGrid}>
            <Row label="yes bid" value={fmtCents(m.yes_bid)} unit="" />
            <Row label="yes ask" value={fmtCents(m.yes_ask)} unit="" />
            {m.threshold != null && <Row label="strike" value={fmt0(m.threshold)} unit="°F" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, unit }) {
  return (
    <div style={S.hoverRow}>
      <span className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</span>
      <span className="numeric" style={S.hoverValue}>
        {value}{unit && <span style={S.hoverUnit}> {unit}</span>}
      </span>
    </div>
  );
}


// ─── Legend ──────────────────────────────────────────────────────────
function Legend({ mode, valueRange, marketType }) {
  if (mode === 'forecast') {
    return (
      <Bar title="temperature · °F" sub={marketType.toUpperCase()}
           leftColor="rgb(38, 85, 130)" midColor="rgb(220, 215, 195)" rightColor="rgb(212, 169, 60)"
           leftLabel={valueRange.hasRange ? `${valueRange.min.toFixed(0)}°` : 'cool'}
           rightLabel={valueRange.hasRange ? `${valueRange.max.toFixed(0)}°` : 'warm'} />
    );
  }
  if (mode === 'spread' || mode === 'marine') {
    return (
      <Bar title={mode === 'spread' ? 'ensemble σ · °F' : 'σ proxy · °F'} sub={marketType.toUpperCase()}
           leftColor="rgb(38, 85, 130)" rightColor="rgb(126, 79, 168)"
           leftLabel={valueRange.hasRange ? valueRange.min.toFixed(1) : 'low'}
           rightLabel={valueRange.hasRange ? valueRange.max.toFixed(1) : 'high'} />
    );
  }
  if (mode === 'market') {
    return (
      <Bar title="yes-mid · ¢" sub={marketType.toUpperCase()}
           leftColor="rgb(186, 78, 88)" midColor="rgb(220, 215, 195)" rightColor="rgb(212, 169, 60)"
           leftLabel="0¢" rightLabel="100¢" />
    );
  }
  if (mode === 'edge') {
    return (
      <Bar title="|μ − threshold| · °F" sub={marketType.toUpperCase()}
           leftColor="rgb(60, 70, 90)" rightColor="rgb(212, 169, 60)"
           leftLabel={valueRange.hasRange ? valueRange.min.toFixed(1) : 'small'}
           rightLabel={valueRange.hasRange ? valueRange.max.toFixed(1) : 'large'} />
    );
  }
  return null;
}

function Bar({ title, sub, leftColor, midColor, rightColor, leftLabel, rightLabel }) {
  const grad = midColor
    ? `linear-gradient(90deg, ${leftColor}, ${midColor}, ${rightColor})`
    : `linear-gradient(90deg, ${leftColor}, ${rightColor})`;
  return (
    <div style={S.legendBar}>
      <div style={S.legendBarHead}>
        <span className="eyebrow" style={{ color: 'var(--cloud-haze)' }}>{title}</span>
        <span className="numeric" style={{ color: 'var(--cloud-mute)', fontSize: 'var(--type-micro)' }}>
          {sub}
        </span>
      </div>
      <div style={{ ...S.legendBarTrack, background: grad }} />
      <div style={S.legendBarLabels}>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}


// ─── Helpers ─────────────────────────────────────────────────────────

function forecastTargetDate(forecasts) {
  if (!forecasts || forecasts.length === 0) return null;
  const counts = new Map();
  for (const f of forecasts) {
    const d = String(f.target_date || '');
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [d, n] of counts.entries()) if (n > bestN) { bestN = n; best = d; }
  return best;
}

const fmt0 = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(0);
const fmt1 = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(1);
const fmtCents = (v) => (v == null || !Number.isFinite(Number(v)))
  ? '—' : `${(Number(v) * 100).toFixed(0)}¢`;

function ramp2(t, c0, c1) {
  const tt = Math.max(0, Math.min(1, t));
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * tt);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * tt);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * tt);
  return { fill: `rgb(${r},${g},${b})`, stroke: 'rgba(255,255,255,0.18)', text: textOnFill(r, g, b) };
}
function ramp3(t, c0, c1, c2) {
  const tt = Math.max(0, Math.min(1, t));
  if (tt <= 0.5) return ramp2(tt * 2, c0, c1);
  return ramp2((tt - 0.5) * 2, c1, c2);
}
function textOnFill(r, g, b) {
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? 'rgba(15, 17, 22, 0.92)' : 'rgba(245, 245, 240, 0.92)';
}

// Build N drifting cumulus particles.  Deterministic positions via index
// so SSR and CSR agree (no React hydration mismatch).
function buildDrift(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const yBand = (i / n) * 0.85 + 0.05;
    const startX = ((i * 137) % 100) - 30;          // jitter
    const r = 18 + ((i * 31) % 22);
    const dur = 70 + ((i * 53) % 90);
    const delay = -((i * 11) % dur);
    const opacity = 0.06 + ((i * 7) % 12) / 100;
    out.push({
      x: (startX / 100) * MAP_W,
      y: yBand * MAP_H,
      r, dur, delay, opacity,
      anim: `wm-drift-${(i % 3) + 1}`,
    });
  }
  return out;
}

const driftKeyframes = `
@keyframes wm-drift-1 {
  0%   { transform: translate3d(-120px, 0, 0); }
  100% { transform: translate3d(${MAP_W + 200}px, 0, 0); }
}
@keyframes wm-drift-2 {
  0%   { transform: translate3d(-160px, -8px, 0); }
  50%  { transform: translate3d(${(MAP_W / 2)}px, 8px, 0); }
  100% { transform: translate3d(${MAP_W + 240}px, -4px, 0); }
}
@keyframes wm-drift-3 {
  0%   { transform: translate3d(-200px, 4px, 0); }
  100% { transform: translate3d(${MAP_W + 260}px, -6px, 0); }
}
`;


// ─── Styles ──────────────────────────────────────────────────────────
const S = {
  controlRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-2)',
    flexWrap: 'wrap',
  },
  pillRow: {
    display: 'flex',
    gap: 'var(--space-1)',
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-pill)',
    padding: 4,
  },
  pill: {
    appearance: 'none',
    background: 'transparent',
    color: 'var(--cloud-haze)',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    letterSpacing: '0.04em',
    padding: '6px 14px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'background var(--motion-glide), color var(--motion-glide)',
  },
  pillActive: {
    background: 'var(--ink-mid)',
    color: 'var(--cloud-pearl)',
    boxShadow: 'inset 0 0 0 1px var(--rule-mid)',
  },
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

  modeCaption: {
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-3)',
  },

  mapShell: {
    position: 'relative',
    background:
      'radial-gradient(circle at 50% 60%, var(--ink-mid) 0%, var(--ink-deep) 70%)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    aspectRatio: `${MAP_W} / ${MAP_H}`,
  },
  mapSvg: {
    display: 'block',
    width: '100%',
    height: '100%',
  },

  hoverCard: {
    position: 'absolute',
    top: 'var(--space-3)',
    right: 'var(--space-3)',
    width: 280,
    background: 'color-mix(in srgb, var(--ink-deep) 92%, transparent)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    boxShadow: 'var(--shadow-elev, 0 8px 24px rgba(0,0,0,0.45))',
    zIndex: 5,
    pointerEvents: 'none',
  },
  hoverHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 'var(--space-3)',
  },
  hoverCity: {
    fontFamily: 'var(--font-headings, var(--font-display))',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.01em',
    fontWeight: 500,
  },
  hoverChip: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    letterSpacing: '0.08em',
    padding: '2px 8px',
    borderRadius: 'var(--radius-pill)',
    background: 'color-mix(in srgb, var(--sky-azure) 18%, transparent)',
    color: 'var(--sky-azure)',
    textTransform: 'uppercase',
  },
  hoverBlock: {
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--rule-faint)',
  },
  hoverEyebrow: {
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-2)',
  },
  hoverGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-2) var(--space-3)',
  },
  hoverRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  hoverValue: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
  },
  hoverUnit: {
    color: 'var(--cloud-mute)',
    fontWeight: 400,
    fontSize: 'var(--type-micro)',
  },
  hoverEmpty: {
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--rule-faint)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    textAlign: 'center',
  },

  legendRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 'var(--space-4)',
    marginTop: 'var(--space-3)',
    flexWrap: 'wrap',
  },
  legendBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    minWidth: 280,
  },
  legendBarHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  legendBarTrack: {
    height: 8,
    borderRadius: 'var(--radius-pill)',
    border: '1px solid var(--rule-faint)',
  },
  legendBarLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-haze)',
  },
  legendMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-haze)',
    letterSpacing: '0.04em',
  },
  legendDot: {
    width: 4, height: 4,
    background: 'var(--rule-mid)',
    borderRadius: '50%',
  },
  code: {
    fontFamily: 'var(--font-mono)',
    background: 'var(--ink-mid)',
    padding: '1px 6px',
    borderRadius: 3,
    color: 'var(--cloud-pearl)',
  },
};
