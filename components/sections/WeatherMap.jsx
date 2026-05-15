'use client';

import { useEffect, useMemo, useState } from 'react';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import SectionFrame from '../layout/SectionFrame';

/**
 * WeatherMap — twenty cities and the atmosphere above them.
 *
 * Each tracked market gets a marker on the US map.  Each marker shows
 * a weather glyph (sun / cloud / storm / snow / heat) derived from
 * the forecast's μ and σ — so the map reads as weather first, data
 * second.  The active mode (Forecast / Spread / Market / Marine /
 * Edge) overlays a value label below the glyph.
 *
 * Modes:
 *   FORECAST — today's HIGH / LOW μ from the latest forecast cycle.
 *              Cool blue → ivory → warm gold halo.
 *   SPREAD   — predictive σ.  Calm halo → storm-violet halo.
 *   MARKET   — Kalshi yes-mid for the at-the-money strike.  Pulls
 *              from analytics.v_map_market_today so every city
 *              renders, not just the ones we hold positions on.
 *   MARINE   — coastal cities only; inland greyed out.
 *   EDGE     — |μ − threshold|.  Largest gaps light up gold.
 *
 * Data shape (passed via the `data` prop):
 *   {
 *     forecasts: [{ city, market_type, mu_cal, sigma_cal,
 *                   q10, q50, q90, n_sources, target_date, ... }],
 *     markets:   { [city]: { high|low: { yes_bid, yes_ask, yes_mid,
 *                                        strike, threshold, ticker } } },
 *     thresholds:{ [city]: { high|low: number } }
 *   }
 */

// ─── 20 ASOS-anchored city coordinates (mirrors core/cities.py) ──────
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
const MAP_W = 1280;
const MAP_H = 760;
const MARKER_R = 26;       // marker radius
const GLYPH_SIZE = 32;     // weather glyph size inside marker

const MODES = [
  { id: 'forecast', label: 'Forecast', caption: "today's μ from the latest forecast cycle" },
  { id: 'spread',   label: 'Spread',   caption: 'σ across the active ensemble' },
  { id: 'market',   label: 'Market',   caption: 'Kalshi yes-mid for the at-the-money strike' },
  { id: 'marine',   label: 'Marine',   caption: 'coastal cities only · σ proxy for marine layer' },
  { id: 'edge',     label: 'Edge',     caption: '|μ − threshold| heat · largest gaps light up' },
];


export default function WeatherMap({ data, freshness }) {
  const forecasts  = useMemo(() => data?.forecasts || [], [data?.forecasts]);
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
    const proj = geoAlbersUsa().scale(1700).translate([MAP_W / 2, MAP_H / 2 - 20]);
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
      const thr  = thresholds?.[c.name]?.[marketType] ?? mkt?.threshold ?? mkt?.strike ?? null;
      const mu    = fcst && Number.isFinite(Number(fcst.mu_cal))    ? Number(fcst.mu_cal)    : null;
      const sigma = fcst && Number.isFinite(Number(fcst.sigma_cal)) ? Number(fcst.sigma_cal) : null;

      let value = null, label = '—', active = true;

      switch (mode) {
        case 'forecast':
          if (mu != null) { value = mu; label = `${mu.toFixed(0)}°`; }
          break;
        case 'spread':
          if (sigma != null) { value = sigma; label = sigma.toFixed(1); }
          break;
        case 'market': {
          const mid = mkt?.yes_mid != null
            ? Number(mkt.yes_mid)
            : (mkt && (mkt.yes_bid != null || mkt.yes_ask != null)
                ? (Number(mkt.yes_bid ?? 0) + Number(mkt.yes_ask ?? 0)) / 2
                : null);
          if (mid != null && Number.isFinite(mid)) {
            value = mid;
            label = `${Math.round(mid * 100)}¢`;
          }
          break;
        }
        case 'marine':
          active = c.marine;
          if (!active) { value = null; label = '·'; }
          else if (sigma != null) { value = sigma; label = sigma.toFixed(1); }
          break;
        case 'edge':
          if (mu != null && thr != null) {
            value = Math.abs(mu - Number(thr));
            label = `${value.toFixed(1)}°`;
          } else if (sigma != null) {
            value = sigma;
            label = `~${sigma.toFixed(1)}`;
          }
          break;
      }
      return { ...c, value, label, active, mu, sigma, fcst, mkt, thr };
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

  // Color picker per mode (halo tone)
  function haloColor(c) {
    if (!c.active || c.value == null || !Number.isFinite(c.value)) {
      return 'rgba(245, 241, 232, 0.10)';
    }
    const t = valueRange.hasRange
      ? (c.value - valueRange.min) / Math.max(0.0001, valueRange.max - valueRange.min)
      : 0.5;
    if (mode === 'forecast')                     return ramp3rgba(t, [38, 85, 130, 0.55], [220, 215, 195, 0.45], [212, 169, 60, 0.65]);
    if (mode === 'spread' || mode === 'marine')  return ramp2rgba(t, [38, 85, 130, 0.45], [126, 79, 168, 0.7]);
    if (mode === 'market')                       return ramp3rgba(Math.max(0, Math.min(1, c.value)),
                                                                  [186, 78, 88, 0.55], [220, 215, 195, 0.45], [212, 169, 60, 0.65]);
    if (mode === 'edge')                         return ramp2rgba(t, [60, 70, 90, 0.35], [212, 169, 60, 0.75]);
    return 'rgba(245, 241, 232, 0.10)';
  }

  // Drift cumulus particles — built once, deterministic positions
  const driftParticles = useMemo(() => buildDrift(22), []);

  return (
    <SectionFrame
      id="weather-map"
      invocation="The Atmosphere"
      title="The Atmosphere"
      subtitle="Twenty cities and the air above them.  Each marker reads as weather first — sun for clear, cloud for cover, storm where the model can&rsquo;t agree, snow where it&rsquo;s cold.  Pick a lens and the value below the glyph re-renders."
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      <div style={S.mapShell}>
        <style>{driftKeyframes}</style>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={S.mapSvg}
             role="img" aria-label="Weather map of 20 US cities"
             preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="map-atmosphere" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="var(--ink-mid)" stopOpacity="0.55">
                <animate attributeName="stop-opacity" values="0.55;0.78;0.55"
                         dur="42s" repeatCount="indefinite" />
              </stop>
              <stop offset="55%"  stopColor="var(--ink-deep)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--ink-deep)" stopOpacity="0.95" />
            </radialGradient>
            <filter id="map-particle-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <linearGradient id="state-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--ink-deep)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--ink-deep)" stopOpacity="0.5" />
            </linearGradient>
            <filter id="marker-halo" x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>

          <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#map-atmosphere)" />

          {/* Atmospheric drift particles — slow cumulus crossing the page */}
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

          {/* US topology */}
          {topo && (
            <g>
              <path d={topo.states.features.map((f) => pathGen(f)).join(' ')}
                    fill="url(#state-fill)" stroke="none" />
              <path d={pathGen(topo.borders)} fill="none"
                    stroke="var(--rule-mid)" strokeWidth="0.8"
                    strokeOpacity="0.6" strokeLinejoin="round" />
            </g>
          )}
          {!topo && !topoErr && (
            <text x={MAP_W / 2} y={MAP_H / 2} fill="var(--cloud-mute)"
                  textAnchor="middle"
                  style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 16 }}>
              Loading topology…
            </text>
          )}
          {topoErr && (
            <text x={MAP_W / 2} y={MAP_H / 2} fill="var(--storm-violet)"
                  textAnchor="middle"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              Topology load failed · {topoErr}
            </text>
          )}

          {/* City markers — weather glyphs */}
          <g>
            {cityValues.map((c) => {
              if (c.x == null || c.y == null) return null;
              const isHover = hover === c.name;
              const halo = haloColor(c);
              const weather = classifyWeather(c.mu, c.sigma);
              return (
                <g key={c.name} transform={`translate(${c.x}, ${c.y})`}
                   onMouseEnter={() => setHover(c.name)}
                   onMouseLeave={() => setHover(null)}
                   style={{ cursor: 'pointer' }}>
                  {/* Halo */}
                  {c.active && c.value != null && (
                    <circle cx="0" cy="0" r={MARKER_R + 10}
                            fill={halo}
                            filter="url(#marker-halo)" />
                  )}
                  {/* Marker disk */}
                  <circle cx="0" cy="0" r={MARKER_R}
                          fill="rgba(10, 14, 20, 0.78)"
                          stroke={isHover ? 'var(--cloud-pearl)' : 'var(--rule-mid)'}
                          strokeWidth={isHover ? 1.6 : 0.8}
                          opacity={c.active ? 1 : 0.5} />
                  {/* Weather glyph */}
                  {c.active && (
                    <g transform={`translate(0, -2) scale(${isHover ? 1.05 : 1})`}
                       opacity={c.active ? 0.92 : 0.4}>
                      <WeatherGlyph type={weather} size={GLYPH_SIZE} cityIdx={CITIES.findIndex((cc) => cc.name === c.name)} />
                    </g>
                  )}
                  {/* Value label */}
                  <text x="0" y={MARKER_R - 6} textAnchor="middle" dominantBaseline="middle"
                        fill={c.active ? 'var(--cloud-pearl)' : 'var(--cloud-mute)'}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          fontWeight: 600,
                          letterSpacing: '-0.02em',
                          pointerEvents: 'none',
                        }}>
                    {c.label}
                  </text>
                  {/* City name on hover */}
                  {isHover && (
                    <text x="0" y={MARKER_R + 14} textAnchor="middle"
                          fill="var(--cloud-pearl)"
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: 12,
                            fontWeight: 500,
                            pointerEvents: 'none',
                          }}>
                      {c.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Floating mode controls overlay (top-left) */}
        <div style={S.controlOverlay}>
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
          <div className="numeric" style={S.modeCaption}>
            {MODES.find((m) => m.id === mode)?.caption}
            <span style={{ color: 'var(--cloud-mute)' }}>
              {' · target '}
              {forecastTargetDate(forecasts) || '—'}
            </span>
          </div>
        </div>

        {/* Hover card */}
        {hover && (
          <HoverCard
            city={cityValues.find((c) => c.name === hover)}
            marketType={marketType}
          />
        )}
      </div>

      {/* Legend + footer */}
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
              {mode === 'market' && (
                <>
                  <span style={S.legendDot} />
                  <span>{Object.keys(markets || {}).length} live prices</span>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </SectionFrame>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Weather classification — maps (μ, σ) → glyph type.
// ─────────────────────────────────────────────────────────────────────
function classifyWeather(mu, sigma) {
  if (!Number.isFinite(mu) || !Number.isFinite(sigma)) return 'unknown';
  // Storms / blizzards when σ is large (model can't agree).
  if (sigma >= 4.0) return mu < 38 ? 'blizzard' : 'storm';
  // Mid-σ → clouds; flavor by temperature.
  if (sigma >= 2.5) {
    if (mu < 36) return 'snow';
    if (mu < 50) return 'overcast';
    return 'partly_cloudy';
  }
  // Low σ → clear; flavor by temperature.
  if (mu >= 88) return 'heat';
  if (mu >= 70) return 'sunny';
  if (mu >= 50) return 'clear_cool';
  if (mu >= 36) return 'frost';
  return 'snow';
}


// ─────────────────────────────────────────────────────────────────────
// Weather glyph dispatch
// ─────────────────────────────────────────────────────────────────────
function WeatherGlyph({ type, size = 32, cityIdx = 0 }) {
  switch (type) {
    case 'heat':         return <SunGlyph size={size} color="#f0b243" glow />;
    case 'sunny':        return <SunGlyph size={size} color="#d4a44a" />;
    case 'clear_cool':   return <SunGlyph size={size} color="#e8d8a8" small />;
    case 'partly_cloudy':return <PartlyCloudyGlyph size={size} />;
    case 'overcast':     return <CloudGlyph size={size} color="#8a8a98" />;
    case 'storm':        return <StormGlyph size={size} cityIdx={cityIdx} />;
    case 'blizzard':     return <BlizzardGlyph size={size} cityIdx={cityIdx} />;
    case 'frost':        return <SnowflakeGlyph size={size} color="#c9e0ed" />;
    case 'snow':         return <SnowflakeGlyph size={size} color="#e8eef5" />;
    default:             return <UnknownGlyph size={size} />;
  }
}

function SunGlyph({ size = 32, color = '#d4a44a', glow = false, small = false }) {
  const coreR = size * (small ? 0.22 : 0.26);
  const inR   = size * 0.36;
  const outR  = size * 0.52;
  const rays = 8;
  // Rotate the entire glyph slowly.  Use CSS animation via inline style.
  return (
    <g style={{
      transformOrigin: 'center',
      transformBox: 'fill-box',
      animation: 'wm-sun-spin 60s linear infinite',
    }}>
      {glow && (
        <circle cx="0" cy="0" r={size * 0.55} fill={color} opacity="0.18" filter="url(#marker-halo)" />
      )}
      {Array.from({ length: rays }).map((_, i) => {
        const angle = (i * 2 * Math.PI) / rays;
        const x1 = Math.cos(angle) * inR;
        const y1 = Math.sin(angle) * inR;
        const x2 = Math.cos(angle) * outR;
        const y2 = Math.sin(angle) * outR;
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color} strokeWidth={small ? 1.1 : 1.6}
                strokeLinecap="round" opacity={0.85} />
        );
      })}
      <circle cx="0" cy="0" r={coreR} fill={color} opacity={glow ? 0.95 : 0.9} />
    </g>
  );
}

function CloudGlyph({ size = 32, color = '#8a8a98', opacity = 0.92, dx = 0, dy = 0 }) {
  const r = size * 0.26;
  return (
    <g fill={color} opacity={opacity} transform={`translate(${dx}, ${dy})`}>
      <circle cx={-r * 0.9} cy={r * 0.1} r={r * 0.78} />
      <circle cx={0} cy={-r * 0.45} r={r * 0.95} />
      <circle cx={r * 0.9} cy={r * 0.1} r={r * 0.78} />
      <ellipse cx="0" cy={r * 0.55} rx={r * 1.7} ry={r * 0.62} />
    </g>
  );
}

function PartlyCloudyGlyph({ size = 32 }) {
  // Sun + cloud overlay
  return (
    <g>
      <g transform={`translate(${size * 0.18}, ${-size * 0.16}) scale(0.75)`}>
        <SunGlyph size={size} color="#d4a44a" small />
      </g>
      <g transform={`translate(${-size * 0.12}, ${size * 0.08})`}>
        <CloudGlyph size={size * 0.95} color="#9aa1ad" opacity={0.94} />
      </g>
    </g>
  );
}

function StormGlyph({ size = 32, cityIdx = 0 }) {
  // Dark cloud + lightning bolt that flashes periodically.  Offset
  // the flash by city index so 20 storms don't all light up at once.
  const lightX = -size * 0.06;
  const flashDelay = (cityIdx * 0.37) % 3.5;
  return (
    <g>
      <CloudGlyph size={size} color="#5d4775" opacity={0.95} />
      <polygon
        points={`${lightX + 2},${size * 0.1} ${lightX - size * 0.10},${size * 0.34} ${lightX + 1},${size * 0.34} ${lightX - size * 0.05},${size * 0.55} ${lightX + size * 0.12},${size * 0.22} ${lightX + 1},${size * 0.22}`}
        fill="#e8c069">
        <animate attributeName="opacity"
                 values="0.95;0.95;0.25;0.95;0.95"
                 dur="3.2s"
                 begin={`${flashDelay}s`}
                 keyTimes="0;0.4;0.5;0.6;1"
                 repeatCount="indefinite" />
      </polygon>
    </g>
  );
}

function BlizzardGlyph({ size = 32, cityIdx = 0 }) {
  // Storm cloud + falling snowflakes
  return (
    <g>
      <CloudGlyph size={size} color="#5d6776" opacity={0.92} />
      {[0, 1, 2].map((i) => {
        const x = (i - 1) * (size * 0.18);
        return (
          <circle key={i} cx={x} cy={size * 0.32 + i * 1.5} r={1.6}
                  fill="#e8eef5" opacity="0.9">
            <animate
              attributeName="cy"
              values={`${size * 0.18};${size * 0.55}`}
              dur={`${1.4 + ((cityIdx + i) % 3) * 0.4}s`}
              repeatCount="indefinite" />
            <animate
              attributeName="opacity"
              values="0;0.9;0"
              dur={`${1.4 + ((cityIdx + i) % 3) * 0.4}s`}
              repeatCount="indefinite" />
          </circle>
        );
      })}
    </g>
  );
}

function SnowflakeGlyph({ size = 32, color = '#c9e0ed' }) {
  // Stylized 6-arm snowflake
  return (
    <g stroke={color} strokeWidth={1.2} fill="none" strokeLinecap="round"
       style={{
         transformOrigin: 'center',
         transformBox: 'fill-box',
         animation: 'wm-snow-spin 50s linear infinite',
       }}>
      {[0, 60, 120].map((deg) => (
        <g key={deg} transform={`rotate(${deg})`}>
          <line x1={-size * 0.36} y1="0" x2={size * 0.36} y2="0" />
          <line x1={-size * 0.22} y1="0" x2={-size * 0.16} y2={-size * 0.08} />
          <line x1={-size * 0.22} y1="0" x2={-size * 0.16} y2={size * 0.08} />
          <line x1={size * 0.22} y1="0" x2={size * 0.16} y2={-size * 0.08} />
          <line x1={size * 0.22} y1="0" x2={size * 0.16} y2={size * 0.08} />
        </g>
      ))}
      <circle cx="0" cy="0" r="1.6" fill={color} stroke="none" />
    </g>
  );
}

function UnknownGlyph({ size = 32 }) {
  return (
    <g>
      <circle cx="0" cy="0" r={size * 0.32}
              fill="none" stroke="var(--cloud-mute)" strokeWidth="1"
              strokeDasharray="3 4" opacity="0.6" />
    </g>
  );
}


// ─────────────────────────────────────────────────────────────────────
// Hover card
// ─────────────────────────────────────────────────────────────────────
function HoverCard({ city, marketType }) {
  if (!city) return null;
  const f = city.fcst;
  const m = city.mkt;
  const weather = classifyWeather(city.mu, city.sigma);
  return (
    <div style={S.hoverCard}>
      <div style={S.hoverHead}>
        <div>
          <div style={S.hoverCity}>{city.name}</div>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
            {city.asos} · {marketType.toUpperCase()}
          </div>
        </div>
        <div style={S.hoverWeatherCell}>
          <svg viewBox="-22 -22 44 44" width={44} height={44}>
            <WeatherGlyph type={weather} size={32} cityIdx={0} />
          </svg>
          <div style={S.hoverWeatherLabel}>{prettyWeather(weather)}</div>
        </div>
      </div>

      {f ? (
        <div style={S.hoverBlock}>
          <div className="eyebrow" style={S.hoverEyebrow}>forecast</div>
          <div style={S.hoverGrid}>
            <Row label="μ"       value={fmt1(f.mu_cal)}    unit="°F" />
            <Row label="σ"       value={fmt1(f.sigma_cal)} unit="°F" />
            <Row label="p10"     value={fmt0(f.q10)}       unit="°F" />
            <Row label="p50"     value={fmt0(f.q50)}       unit="°F" />
            <Row label="p90"     value={fmt0(f.q90)}       unit="°F" />
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
            {(m.strike != null || m.threshold != null) && (
              <Row label="strike" value={fmt1(m.strike ?? m.threshold)} unit="°F" />
            )}
            {m.volume_24h != null && (
              <Row label="vol 24h" value={fmt0(m.volume_24h)} unit="" />
            )}
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


// ─────────────────────────────────────────────────────────────────────
// Legend
// ─────────────────────────────────────────────────────────────────────
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
      <Bar title="yes-mid · ¢ · at-the-money strike" sub={marketType.toUpperCase()}
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


// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
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

function prettyWeather(w) {
  switch (w) {
    case 'heat':           return 'heat dome';
    case 'sunny':          return 'sunny';
    case 'clear_cool':     return 'clear';
    case 'partly_cloudy':  return 'partly cloudy';
    case 'overcast':       return 'overcast';
    case 'storm':          return 'storm watch';
    case 'blizzard':       return 'winter storm';
    case 'frost':          return 'frost';
    case 'snow':           return 'snow';
    default:               return '—';
  }
}

const fmt0 = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(0);
const fmt1 = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : Number(v).toFixed(1);
const fmtCents = (v) => (v == null || !Number.isFinite(Number(v)))
  ? '—' : `${(Number(v) * 100).toFixed(0)}¢`;

function ramp2rgba(t, c0, c1) {
  const tt = Math.max(0, Math.min(1, t));
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * tt);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * tt);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * tt);
  const a = c0[3] + (c1[3] - c0[3]) * tt;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}
function ramp3rgba(t, c0, c1, c2) {
  const tt = Math.max(0, Math.min(1, t));
  if (tt <= 0.5) return ramp2rgba(tt * 2, c0, c1);
  return ramp2rgba((tt - 0.5) * 2, c1, c2);
}

// Build N drifting cumulus particles.  Deterministic positions via index
// so SSR and CSR agree (no React hydration mismatch).
function buildDrift(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const yBand  = (i / n) * 0.88 + 0.04;
    const startX = ((i * 137) % 100) - 30;
    const r = 20 + ((i * 31) % 26);
    const dur = 90 + ((i * 53) % 110);
    const delay = -((i * 11) % dur);
    const opacity = 0.05 + ((i * 7) % 11) / 100;
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
  0%   { transform: translate3d(-200px, 0, 0); }
  100% { transform: translate3d(${MAP_W + 280}px, 0, 0); }
}
@keyframes wm-drift-2 {
  0%   { transform: translate3d(-220px, -8px, 0); }
  50%  { transform: translate3d(${(MAP_W / 2)}px, 8px, 0); }
  100% { transform: translate3d(${MAP_W + 320}px, -4px, 0); }
}
@keyframes wm-drift-3 {
  0%   { transform: translate3d(-260px, 4px, 0); }
  100% { transform: translate3d(${MAP_W + 340}px, -6px, 0); }
}
@keyframes wm-sun-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes wm-snow-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(-360deg); }
}
`;


// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const S = {
  mapShell: {
    position: 'relative',
    background:
      'radial-gradient(circle at 50% 55%, var(--ink-mid) 0%, var(--ink-deep) 75%)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    aspectRatio: `${MAP_W} / ${MAP_H}`,
    minHeight: 600,
  },
  mapSvg: {
    display: 'block',
    width: '100%',
    height: '100%',
  },

  controlOverlay: {
    position: 'absolute',
    top: 'var(--space-4)',
    left: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    padding: 'var(--space-3) var(--space-4)',
    background: 'color-mix(in srgb, var(--ink-deep) 85%, transparent)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-card)',
    zIndex: 4,
    maxWidth: '60%',
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
    color: 'var(--cloud-haze)',
    marginTop: 'var(--space-1)',
  },

  hoverCard: {
    position: 'absolute',
    top: 'var(--space-4)',
    right: 'var(--space-4)',
    width: 300,
    background: 'color-mix(in srgb, var(--ink-deep) 92%, transparent)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    boxShadow: '0 12px 40px -16px rgba(0,0,0,0.65)',
    zIndex: 5,
    pointerEvents: 'none',
  },
  hoverHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-3)',
  },
  hoverCity: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.01em',
    fontWeight: 500,
  },
  hoverWeatherCell: {
    textAlign: 'center',
    minWidth: 70,
  },
  hoverWeatherLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    color: 'var(--cloud-mute)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginTop: 'var(--space-1)',
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
