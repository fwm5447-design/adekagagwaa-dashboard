import React, { useState, useEffect, useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  Cell, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════════
// DESIGN: "Weather Station Terminal"
// Editorial serif display typography against dense monospace data.
// Deep navy-black (#0a0e14) with muted forest / amber / coral accents.
// Typography: Fraunces (display) + JetBrains Mono (data) — avoiding
// the generic Inter/Roboto/Space-Grotesk stack entirely.
// ═══════════════════════════════════════════════════════════════════════

// ── Sample data modeling the shape produced by core/dashboard_export.py ──
const SAMPLE = {
  version: 1,
  generated_at: "2026-04-24T14:23:10Z",
  status: {
    state: "OK", scan_mode: "HIGH_LAUNCH", cycles: 128,
    started_at: "2026-04-23T08:00:00Z",
    last_cycle_at: "2026-04-24T14:23:10Z",
    last_cycle_seconds: 2.3, next_cycle_in: 87,
    last_rainm_cycle_at: "2026-04-24T12:00:00Z",
    errors: 0, warnings: 2,
  },
  performance: {
    bankroll_start: 500.0, nav_current: 612.47, total_pnl: 112.47,
    win_rate: 0.614, wins: 27, losses: 17, decisive: 44,
    open_count: 8, settled_count: 44, total_trades: 52,
    wagered_open: 164.50, wagered_settled: 923.00, roi_pct: 12.18,
  },
  pnl_curve: [
    { t: "2026-04-13T12:00Z", pnl: 0 },
    { t: "2026-04-14T13:00Z", pnl: 8.25 },
    { t: "2026-04-14T14:00Z", pnl: -6.75 },
    { t: "2026-04-15T13:05Z", pnl: 12.44 },
    { t: "2026-04-16T13:00Z", pnl: 28.93 },
    { t: "2026-04-17T12:55Z", pnl: 21.93 },
    { t: "2026-04-18T13:00Z", pnl: 48.40 },
    { t: "2026-04-19T13:15Z", pnl: 37.40 },
    { t: "2026-04-20T13:00Z", pnl: 61.84 },
    { t: "2026-04-21T12:50Z", pnl: 74.28 },
    { t: "2026-04-22T13:00Z", pnl: 65.28 },
    { t: "2026-04-22T18:00Z", pnl: 89.72 },
    { t: "2026-04-23T13:00Z", pnl: 103.50 },
    { t: "2026-04-23T18:00Z", pnl: 95.50 },
    { t: "2026-04-24T08:00Z", pnl: 112.47 },
  ],
  by_type: {
    high:  { wins: 14, losses: 9, pnl: 58.22, trades: 23, open: 4, win_rate: 0.609 },
    low:   { wins: 10, losses: 7, pnl: 34.25, trades: 17, open: 3, win_rate: 0.588 },
    rainm: { wins: 3,  losses: 1, pnl: 20.00, trades: 4,  open: 1, win_rate: 0.750 },
  },
  by_grade: {
    A: { wins: 18, losses: 7, pnl: 74.30, win_rate: 0.720 },
    B: { wins: 9,  losses: 10, pnl: 38.17, win_rate: 0.474 },
  },
  by_city: [
    { city: "New York",      trades: 6, wins: 4, losses: 2, pnl: 22.80, win_rate: 0.667, by_type: { high: 3, low: 2, rainm: 1 } },
    { city: "Chicago",       trades: 4, wins: 2, losses: 2, pnl:  6.40, win_rate: 0.500, by_type: { high: 2, low: 2, rainm: 0 } },
    { city: "Los Angeles",   trades: 5, wins: 3, losses: 2, pnl: 18.20, win_rate: 0.600, by_type: { high: 3, low: 1, rainm: 1 } },
    { city: "Miami",         trades: 4, wins: 3, losses: 1, pnl: 31.00, win_rate: 0.750, by_type: { high: 1, low: 2, rainm: 1 } },
    { city: "Houston",       trades: 2, wins: 1, losses: 1, pnl:  2.44, win_rate: 0.500, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Phoenix",       trades: 3, wins: 3, losses: 0, pnl: 28.75, win_rate: 1.000, by_type: { high: 3, low: 0, rainm: 0 } },
    { city: "Dallas",        trades: 2, wins: 0, losses: 2, pnl:-21.00, win_rate: 0.000, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Austin",        trades: 2, wins: 1, losses: 1, pnl: -2.56, win_rate: 0.500, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Atlanta",       trades: 3, wins: 2, losses: 1, pnl:  9.80, win_rate: 0.667, by_type: { high: 2, low: 1, rainm: 0 } },
    { city: "Denver",        trades: 2, wins: 1, losses: 1, pnl:  1.22, win_rate: 0.500, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Seattle",       trades: 2, wins: 1, losses: 1, pnl:  4.40, win_rate: 0.500, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Boston",        trades: 3, wins: 2, losses: 1, pnl: 12.60, win_rate: 0.667, by_type: { high: 2, low: 1, rainm: 0 } },
    { city: "San Francisco", trades: 2, wins: 1, losses: 1, pnl:  1.44, win_rate: 0.500, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Philadelphia",  trades: 2, wins: 1, losses: 1, pnl:  0.20, win_rate: 0.500, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Washington",    trades: 1, wins: 0, losses: 1, pnl:-20.00, win_rate: 0.000, by_type: { high: 0, low: 1, rainm: 0 } },
    { city: "Minneapolis",   trades: 1, wins: 1, losses: 0, pnl: 18.00, win_rate: 1.000, by_type: { high: 1, low: 0, rainm: 0 } },
    { city: "Las Vegas",     trades: 2, wins: 2, losses: 0, pnl: 24.44, win_rate: 1.000, by_type: { high: 1, low: 1, rainm: 0 } },
    { city: "Oklahoma City", trades: 1, wins: 0, losses: 1, pnl:-15.00, win_rate: 0.000, by_type: { high: 0, low: 1, rainm: 0 } },
    { city: "New Orleans",   trades: 0, wins: 0, losses: 0, pnl:  0.00, win_rate: null,   by_type: { high: 0, low: 0, rainm: 0 } },
    { city: "San Antonio",   trades: 1, wins: 0, losses: 1, pnl:-10.44, win_rate: 0.000, by_type: { high: 1, low: 0, rainm: 0 } },
  ],
  open_positions: [
    { city: "Phoenix", market_type: "high", bet_side: "YES", threshold_low: 95, threshold_high: 100,
      entry_price: 0.35, size_usd: 18.0, grade: "A", edge_pct: 19.5, our_prob: 0.58, market_prob: 0.35,
      confidence: 0.78, potential_win: 30.08, target: "2026-04-25", is_rainm: false, ttl_sec: 32400 },
    { city: "New York", market_type: "rainm", bet_side: "NO", threshold_low: 4.0, threshold_high: null,
      entry_price: 0.55, size_usd: 22.0, grade: "B", edge_pct: 14.0, our_prob: 0.38, market_prob: 0.62,
      confidence: 0.68, potential_win: 16.20, target: "2026-04", is_rainm: true, ttl_sec: 587400,
      operator: "above", predictive_mean: 3.1, predictive_std: 1.4, observed_so_far: 2.1,
      days_remaining: 6, days_observed: 24, total_days_in_month: 30 },
    { city: "Miami", market_type: "low", bet_side: "YES", threshold_low: 70, threshold_high: null,
      entry_price: 0.48, size_usd: 15.0, grade: "A", edge_pct: 21.2, our_prob: 0.69, market_prob: 0.48,
      confidence: 0.72, potential_win: 14.63, target: "2026-04-25", is_rainm: false, ttl_sec: 28800,
      low_direction: "below", station_bias: 1.2 },
    { city: "Chicago", market_type: "high", bet_side: "NO", threshold_low: 68, threshold_high: null,
      entry_price: 0.62, size_usd: 12.0, grade: "B", edge_pct: 13.1, our_prob: 0.28, market_prob: 0.38,
      confidence: 0.65, potential_win: 6.70, target: "2026-04-25", is_rainm: false, ttl_sec: 25200 },
    { city: "Los Angeles", market_type: "low", bet_side: "YES", threshold_low: 58, threshold_high: 62,
      entry_price: 0.42, size_usd: 18.0, grade: "A", edge_pct: 17.8, our_prob: 0.61, market_prob: 0.42,
      confidence: 0.74, potential_win: 22.34, target: "2026-04-26", is_rainm: false, ttl_sec: 115200 },
    { city: "Boston", market_type: "high", bet_side: "YES", threshold_low: 72, threshold_high: null,
      entry_price: 0.40, size_usd: 20.0, grade: "A", edge_pct: 22.5, our_prob: 0.67, market_prob: 0.40,
      confidence: 0.81, potential_win: 27.00, target: "2026-04-26", is_rainm: false, ttl_sec: 115200 },
    { city: "Las Vegas", market_type: "high", bet_side: "YES", threshold_low: 92, threshold_high: null,
      entry_price: 0.45, size_usd: 16.0, grade: "B", edge_pct: 11.8, our_prob: 0.61, market_prob: 0.45,
      confidence: 0.67, potential_win: 17.60, target: "2026-04-25", is_rainm: false, ttl_sec: 36000 },
    { city: "Atlanta", market_type: "low", bet_side: "NO", threshold_low: 52, threshold_high: null,
      entry_price: 0.58, size_usd: 14.0, grade: "B", edge_pct: 12.4, our_prob: 0.31, market_prob: 0.42,
      confidence: 0.63, potential_win: 7.58, target: "2026-04-25", is_rainm: false, ttl_sec: 39600 },
  ],
  recent_settlements: [
    { settled_at: "2026-04-24T12:05Z", city: "Houston",  market_type: "high", threshold_low: 86, bet_side: "YES",
      outcome: "YES", status: "win",  pnl:  22.00, actual: 89.0, entry_price: 0.45, size_usd: 20, grade: "A" },
    { settled_at: "2026-04-24T12:05Z", city: "Phoenix",  market_type: "high", threshold_low: 94, bet_side: "YES",
      outcome: "YES", status: "win",  pnl:  16.50, actual: 97.0, entry_price: 0.55, size_usd: 20, grade: "A" },
    { settled_at: "2026-04-24T12:05Z", city: "Dallas",   market_type: "low",  threshold_low: 58, bet_side: "YES",
      outcome: "NO",  status: "loss", pnl: -15.00, actual: 62.0, entry_price: 0.60, size_usd: 15, grade: "B" },
    { settled_at: "2026-04-23T12:05Z", city: "Miami",    market_type: "low",  threshold_low: 72, bet_side: "YES",
      outcome: "YES", status: "win",  pnl:  24.44, actual: 69.0, entry_price: 0.45, size_usd: 20, grade: "A" },
    { settled_at: "2026-04-23T12:05Z", city: "New York", market_type: "high", threshold_low: 68, bet_side: "NO",
      outcome: "YES", status: "loss", pnl: -18.00, actual: 71.0, entry_price: 0.40, size_usd: 18, grade: "B" },
    { settled_at: "2026-04-22T12:05Z", city: "Chicago",  market_type: "high", threshold_low: 62, bet_side: "YES",
      outcome: "YES", status: "win",  pnl:  18.40, actual: 65.0, entry_price: 0.48, size_usd: 18, grade: "A" },
    { settled_at: "2026-04-22T12:05Z", city: "Austin",   market_type: "low",  threshold_low: 48, bet_side: "NO",
      outcome: "NO",  status: "win",  pnl:  14.22, actual: 52.0, entry_price: 0.55, size_usd: 18, grade: "B" },
    { settled_at: "2026-04-21T12:05Z", city: "Denver",   market_type: "high", threshold_low: 72, bet_side: "YES",
      outcome: "YES", status: "win",  pnl:  18.00, actual: 76.0, entry_price: 0.45, size_usd: 20, grade: "A" },
  ],
  recent_signals: [
    { grade: "A", city: "Phoenix",   market_type: "high",  threshold: 95,  edge: 19.5, conf: 78, bet_side: "YES", ts: "2026-04-24T10:15Z" },
    { grade: "A", city: "Boston",    market_type: "high",  threshold: 72,  edge: 22.5, conf: 81, bet_side: "YES", ts: "2026-04-24T10:18Z" },
    { grade: "A", city: "Miami",     market_type: "low",   threshold: 70,  edge: 21.2, conf: 72, bet_side: "YES", ts: "2026-04-24T06:15Z" },
    { grade: "B", city: "New York",  market_type: "rainm", threshold: 4.0, edge: 14.0, conf: 68, bet_side: "NO",  ts: "2026-04-24T12:00Z" },
    { grade: "B", city: "Chicago",   market_type: "high",  threshold: 68,  edge: 13.1, conf: 65, bet_side: "NO",  ts: "2026-04-24T10:20Z" },
    { grade: "B", city: "Las Vegas", market_type: "high",  threshold: 92,  edge: 11.8, conf: 67, bet_side: "YES", ts: "2026-04-24T10:25Z" },
    { grade: "C", city: "Atlanta",   market_type: "low",   threshold: 52,  edge:  8.0, conf: 55, bet_side: "NO",  ts: "2026-04-24T06:20Z" },
  ],
  signals_session: { a: 12, b: 23, c: 45, rainm_a: 3, rainm_b: 7, rainm_c: 11 },
  markets: { high: 84, low: 62, rainm: 18, forecasts_ok: 40, forecasts_total: 41, rainm_forecasts_ok: 6 },
  rainm: {
    months: [
      { month: "2026-04", trades: 1, exposure: 22.00, cities: ["New York"] },
      { month: "2026-05", trades: 0, exposure:  0.00, cities: [] },
    ],
    total_exposure: 22.00, portfolio_cap_pct: 0.20,
  },
  calibration: {
    brier_score: 0.187, decisive: 44, model_epoch: "2026-04-13",
    reliability: [
      { bin: 0.05, predicted: 0.05, empirical: 0.08, n: 2 },
      { bin: 0.15, predicted: 0.18, empirical: 0.20, n: 5 },
      { bin: 0.25, predicted: 0.24, empirical: 0.21, n: 4 },
      { bin: 0.35, predicted: 0.36, empirical: 0.40, n: 6 },
      { bin: 0.45, predicted: 0.45, empirical: 0.41, n: 7 },
      { bin: 0.55, predicted: 0.54, empirical: 0.62, n: 8 },
      { bin: 0.65, predicted: 0.66, empirical: 0.70, n: 6 },
      { bin: 0.75, predicted: 0.75, empirical: 0.80, n: 4 },
      { bin: 0.85, predicted: 0.85, empirical: 0.82, n: 2 },
    ],
  },
  station_biases: {
    updated_at: "2026-04-23T04:30:00Z",
    high: { "New York": 0.3, "Chicago": -0.8, "Phoenix": 1.2, "Miami": -0.4, "Boston": 0.1 },
    low:  { "New York": 0.6, "Chicago": 0.2,  "Miami": 1.2, "Atlanta": -0.7 },
  },
  config: {
    bankroll_usd: 500, min_edge_pct: 12, rainm_enabled: true,
    rainm_min_edge_pct: 10, max_portfolio_pct: 0.10,
    rainm_max_portfolio_pct: 0.20, scan_interval_min: 30,
  },
};

// ── Typography & theme tokens ──────────────────────────────────────────
const COLORS = {
  bg:       "#0a0e14",
  bgSoft:   "#0f1520",
  bgSofter: "#131b29",
  line:     "#1e2a3a",
  lineSoft: "#141d2c",
  ink:      "#e8ecf1",
  inkDim:   "#8a96a8",
  inkMuted: "#4a5668",
  amber:    "#e8a25c",   // live / alerts
  amberDim: "#7a5530",
  forest:   "#60a978",   // wins
  forestDim: "#2e5a42",
  coral:    "#e07b5c",   // losses
  coralDim: "#6e3a29",
  steel:    "#6a92b8",   // rainm
  steelDim: "#334e6a",
  grade_a:  "#e8a25c",
  grade_b:  "#a8a28f",
  grade_c:  "#607088",
};

// Inject typography + background atmosphere
function useBootStyles() {
  useEffect(() => {
    if (document.getElementById("ws-dashboard-styles")) return;
    const link = document.createElement("link");
    link.rel  = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..900,0..100&family=JetBrains+Mono:wght@300;400;500;600&display=swap";
    document.head.appendChild(link);

    const style = document.createElement("style");
    style.id = "ws-dashboard-styles";
    style.textContent = `
      .ws-app {
        background: ${COLORS.bg};
        color: ${COLORS.ink};
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-feature-settings: "ss01", "ss02", "tnum", "zero";
        letter-spacing: -0.005em;
        min-height: 100vh;
      }
      .ws-display {
        font-family: "Fraunces", Georgia, serif;
        font-feature-settings: "ss02", "ss03", "ss05";
        font-variation-settings: "opsz" 144, "SOFT" 50;
        letter-spacing: -0.02em;
      }
      .ws-eyebrow {
        font-family: "JetBrains Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 10px;
        color: ${COLORS.inkMuted};
        font-weight: 500;
      }
      .ws-hair {
        background: linear-gradient(90deg, transparent, ${COLORS.line} 20%, ${COLORS.line} 80%, transparent);
        height: 1px;
      }
      .ws-pulse {
        animation: ws-pulse 2.5s ease-in-out infinite;
      }
      @keyframes ws-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
      .ws-ticker-fade::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 60px;
        height: 100%;
        background: linear-gradient(90deg, ${COLORS.bg}, transparent);
        z-index: 2;
        pointer-events: none;
      }
      .ws-ticker-fade::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        width: 60px;
        height: 100%;
        background: linear-gradient(270deg, ${COLORS.bg}, transparent);
        z-index: 2;
        pointer-events: none;
      }
      @keyframes ws-ticker-scroll {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      .ws-ticker-track {
        animation: ws-ticker-scroll 60s linear infinite;
      }
      .ws-atmosphere::before {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        background:
          radial-gradient(ellipse 1200px 600px at 15% 0%, rgba(96, 169, 120, 0.05), transparent 60%),
          radial-gradient(ellipse 900px 500px at 85% 100%, rgba(106, 146, 184, 0.04), transparent 60%);
        z-index: 0;
      }
      .ws-atmosphere::after {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.015) 1px, transparent 0);
        background-size: 3px 3px;
        z-index: 0;
      }
      .ws-content { position: relative; z-index: 1; }
      /* tabular-nums applied at body */
      .ws-num { font-variant-numeric: tabular-nums; }
    `;
    document.head.appendChild(style);
  }, []);
}

// ── Utility formatters ─────────────────────────────────────────────────
const money = (n, opts = {}) => {
  const { sign = true, decimals = 2 } = opts;
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n).toFixed(decimals);
  if (!sign) return `$${abs}`;
  return (n < 0 ? "−$" : n > 0 ? "+$" : "$") + abs;
};
const pct = (n, d = 1) => n === null || n === undefined ? "—" : `${(n * 100).toFixed(d)}%`;
const colorPnl = (v) => v >= 0 ? COLORS.forest : COLORS.coral;
const colorGrade = (g) => ({ A: COLORS.grade_a, B: COLORS.grade_b, C: COLORS.grade_c }[g] ?? COLORS.inkMuted);
const formatTtl = (sec) => {
  if (sec === null || sec === undefined) return "—";
  if (sec < 0) return "OVERDUE";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
const relTime = (iso) => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now  = Date.now();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// ── Layout primitives ──────────────────────────────────────────────────
function Card({ children, className = "", title, eyebrow, right, noPad = false }) {
  return (
    <div
      className={className}
      style={{
        background: COLORS.bgSoft,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 2,
        position: "relative",
      }}
    >
      {(title || eyebrow) && (
        <div style={{
          padding: "14px 20px 10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: `1px solid ${COLORS.lineSoft}`,
        }}>
          <div>
            {eyebrow && <div className="ws-eyebrow">{eyebrow}</div>}
            {title && (
              <div className="ws-display" style={{ fontSize: 20, fontWeight: 400, marginTop: 2, color: COLORS.ink }}>
                {title}
              </div>
            )}
          </div>
          {right}
        </div>
      )}
      <div style={{ padding: noPad ? 0 : "16px 20px 20px" }}>{children}</div>
    </div>
  );
}

// ── Status bar (top strip) ─────────────────────────────────────────────
function StatusBar({ d }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const nextIn = Math.max(0, Math.round(d.status.next_cycle_in));
  const uptime = (() => {
    if (!d.status.started_at) return "—";
    const start = new Date(d.status.started_at).getTime();
    const s = Math.floor((now - start) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const days = Math.floor(h / 24);
    if (days > 0) return `${days}d ${h % 24}h ${m}m`;
    return `${h}h ${m}m`;
  })();

  const statusDot = d.status.state === "OK" ? COLORS.forest
    : d.status.state === "Scanning..." ? COLORS.amber
    : d.status.errors > 0 ? COLORS.coral : COLORS.amber;

  return (
    <div style={{
      borderBottom: `1px solid ${COLORS.line}`,
      padding: "12px 32px",
      display: "flex",
      alignItems: "center",
      gap: 32,
      fontSize: 11,
      background: COLORS.bgSofter,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <div
          className="ws-display"
          style={{
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: -0.015,
            fontVariationSettings: '"opsz" 144, "SOFT" 100',
            color: COLORS.ink,
          }}
        >
          Adekagagwaa
        </div>
        <div
          style={{
            width: 1,
            height: 18,
            background: COLORS.line,
            alignSelf: "center",
          }}
        />
        <div
          style={{
            color: COLORS.inkDim,
            fontSize: 10,
            letterSpacing: 0.22,
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Lord of the Weather
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <StatItem label="STATUS" value={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="ws-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: statusDot, display: "inline-block" }} />
          <span>{d.status.state}</span>
        </span>
      } />
      <StatItem label="MODE" value={d.status.scan_mode} />
      <StatItem label="CYCLES" value={d.status.cycles} />
      <StatItem label="UPTIME" value={uptime} />
      <StatItem label="NEXT SCAN" value={`${Math.max(0, nextIn)}s`} />
      <StatItem label="W/E" value={`${d.status.warnings}/${d.status.errors}`}
        valueStyle={{ color: d.status.errors > 0 ? COLORS.coral : d.status.warnings > 0 ? COLORS.amber : COLORS.inkDim }} />
    </div>
  );
}
function StatItem({ label, value, valueStyle }) {
  return (
    <div>
      <div className="ws-eyebrow" style={{ fontSize: 9 }}>{label}</div>
      <div className="ws-num" style={{ fontSize: 12, color: COLORS.ink, fontWeight: 500, ...valueStyle }}>{value}</div>
    </div>
  );
}

// ── Ticker tape (recent signals scroll) ────────────────────────────────
function Ticker({ signals }) {
  const items = useMemo(() => [...signals, ...signals], [signals]);
  return (
    <div className="ws-ticker-fade" style={{ position: "relative", overflow: "hidden", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.bgSofter, padding: "9px 0" }}>
      <div className="ws-ticker-track" style={{ display: "flex", gap: 48, whiteSpace: "nowrap", width: "max-content" }}>
        {items.map((s, i) => (
          <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 11 }}>
            <span style={{ padding: "2px 6px", background: colorGrade(s.grade) + "22", color: colorGrade(s.grade), border: `1px solid ${colorGrade(s.grade)}44`, fontWeight: 600, fontSize: 10 }}>
              {s.grade}
            </span>
            <span style={{ color: COLORS.inkDim, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.1 }}>
              {s.market_type === "rainm" ? "RAIN" : s.market_type}
            </span>
            <span style={{ color: COLORS.ink, fontWeight: 500 }}>{s.city}</span>
            <span style={{ color: COLORS.inkMuted }}>
              {s.market_type === "rainm" ? `${s.threshold.toFixed(2)}"` : `${s.threshold}°F`}
            </span>
            <span style={{ color: s.bet_side === "YES" ? COLORS.forest : COLORS.coral, fontWeight: 500 }}>{s.bet_side}</span>
            <span className="ws-num" style={{ color: COLORS.amber }}>+{s.edge.toFixed(1)}%</span>
            <span style={{ color: COLORS.inkMuted, fontSize: 10 }}>{relTime(s.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Hero KPIs ──────────────────────────────────────────────────────────
function HeroKPIs({ d }) {
  const p = d.performance;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr", gap: 1, background: COLORS.line }}>
      <div style={{ background: COLORS.bgSoft, padding: "28px 32px" }}>
        <div className="ws-eyebrow">Current NAV</div>
        <div className="ws-display ws-num" style={{ fontSize: 56, fontWeight: 300, lineHeight: 1.0, marginTop: 8, color: COLORS.ink }}>
          ${p.nav_current.toFixed(2)}
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 14, fontSize: 11, color: COLORS.inkDim }}>
          <div>Start <span className="ws-num" style={{ color: COLORS.ink }}>${p.bankroll_start.toFixed(0)}</span></div>
          <div style={{ color: colorPnl(p.total_pnl) }}>
            {p.total_pnl >= 0 ? "▲" : "▼"} <span className="ws-num">{money(p.total_pnl)}</span>
          </div>
          <div>ROI <span className="ws-num" style={{ color: colorPnl(p.roi_pct) }}>{p.roi_pct?.toFixed(2)}%</span></div>
        </div>
      </div>
      <div style={{ background: COLORS.bgSoft, padding: "28px 32px" }}>
        <div className="ws-eyebrow">Win Rate</div>
        <div className="ws-display ws-num" style={{ fontSize: 52, fontWeight: 300, lineHeight: 1.0, marginTop: 8, color: COLORS.ink }}>
          {(p.win_rate * 100).toFixed(1)}<span style={{ fontSize: 28, color: COLORS.inkDim }}>%</span>
        </div>
        <div style={{ fontSize: 11, color: COLORS.inkDim, marginTop: 14 }}>
          <span className="ws-num" style={{ color: COLORS.forest }}>{p.wins}W</span> <span style={{ color: COLORS.inkMuted }}>·</span>{" "}
          <span className="ws-num" style={{ color: COLORS.coral }}>{p.losses}L</span> <span style={{ color: COLORS.inkMuted }}>/</span>{" "}
          <span className="ws-num">{p.decisive}</span> decisive
        </div>
      </div>
      <div style={{ background: COLORS.bgSoft, padding: "28px 32px" }}>
        <div className="ws-eyebrow">Open Positions</div>
        <div className="ws-display ws-num" style={{ fontSize: 52, fontWeight: 300, lineHeight: 1.0, marginTop: 8, color: COLORS.ink }}>
          {p.open_count}
        </div>
        <div style={{ fontSize: 11, color: COLORS.inkDim, marginTop: 14 }}>
          <span className="ws-num">${p.wagered_open.toFixed(0)}</span> at risk
        </div>
      </div>
      <div style={{ background: COLORS.bgSoft, padding: "28px 32px" }}>
        <div className="ws-eyebrow">Session Signals</div>
        <div className="ws-display ws-num" style={{ fontSize: 52, fontWeight: 300, lineHeight: 1.0, marginTop: 8, color: COLORS.ink }}>
          {d.signals_session.a + d.signals_session.b + d.signals_session.c + d.signals_session.rainm_a + d.signals_session.rainm_b + d.signals_session.rainm_c}
        </div>
        <div style={{ fontSize: 11, color: COLORS.inkDim, marginTop: 14, display: "flex", gap: 12 }}>
          <span><span className="ws-num" style={{ color: COLORS.grade_a }}>{d.signals_session.a + d.signals_session.rainm_a}</span> A</span>
          <span><span className="ws-num" style={{ color: COLORS.grade_b }}>{d.signals_session.b + d.signals_session.rainm_b}</span> B</span>
          <span><span className="ws-num" style={{ color: COLORS.grade_c }}>{d.signals_session.c + d.signals_session.rainm_c}</span> C</span>
        </div>
      </div>
    </div>
  );
}

// ── P&L Chart ──────────────────────────────────────────────────────────
function PnLChart({ curve, modelEpoch }) {
  const data = curve.map(p => ({
    ...p,
    time: new Date(p.t).getTime(),
    label: new Date(p.t).toLocaleDateString("en", { month: "short", day: "numeric" }),
  }));
  const modelEpochMs = modelEpoch ? new Date(modelEpoch + "T00:00:00Z").getTime() : null;
  return (
    <Card eyebrow="Performance" title="Cumulative P&L" right={
      <div style={{ display: "flex", gap: 16, fontSize: 10, color: COLORS.inkDim }}>
        <LegendDot color={COLORS.forest} /> Profit
        <LegendDot color={COLORS.coral} /> Drawdown
        {modelEpoch && <><LegendDot color={COLORS.amber} /> Model epoch</>}
      </div>
    }>
      <div style={{ height: 280, marginLeft: -8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 20, right: 24, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="profitArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.forest} stopOpacity={0.30} />
                <stop offset="100%" stopColor={COLORS.forest} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLORS.lineSoft} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              stroke={COLORS.inkMuted}
              tick={{ fill: COLORS.inkMuted, fontSize: 10, fontFamily: "JetBrains Mono" }}
              tickLine={false}
              axisLine={{ stroke: COLORS.line }}
            />
            <YAxis
              stroke={COLORS.inkMuted}
              tick={{ fill: COLORS.inkMuted, fontSize: 10, fontFamily: "JetBrains Mono" }}
              tickLine={false}
              axisLine={{ stroke: COLORS.line }}
              tickFormatter={(v) => `$${v}`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                background: COLORS.bgSofter, border: `1px solid ${COLORS.line}`,
                borderRadius: 2, fontSize: 11, fontFamily: "JetBrains Mono",
                padding: "8px 12px",
              }}
              labelStyle={{ color: COLORS.inkDim, fontSize: 10, marginBottom: 4 }}
              itemStyle={{ color: COLORS.ink }}
              formatter={(v) => [`$${v.toFixed(2)}`, "P&L"]}
            />
            <ReferenceLine y={0} stroke={COLORS.inkMuted} strokeDasharray="3 3" />
            <Area
              type="monotone" dataKey="pnl"
              stroke={COLORS.forest} strokeWidth={1.5}
              fill="url(#profitArea)"
              dot={{ r: 2.5, fill: COLORS.bg, stroke: COLORS.forest, strokeWidth: 1.5 }}
              activeDot={{ r: 5, fill: COLORS.forest, stroke: COLORS.bg, strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
function LegendDot({ color }) {
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 4 }} />;
}

// ── Open positions ─────────────────────────────────────────────────────
function OpenPositions({ positions }) {
  const sorted = [...positions].sort((a, b) => {
    if (a.is_rainm !== b.is_rainm) return a.is_rainm ? 1 : -1;
    return (a.ttl_sec ?? 0) - (b.ttl_sec ?? 0);
  });
  return (
    <Card eyebrow="Live Book" title={`Open Positions · ${positions.length}`} noPad>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {sorted.map((p, i) => <PositionRow key={i} p={p} />)}
      </div>
    </Card>
  );
}
function PositionRow({ p }) {
  const isR = p.is_rainm;
  const typeColor = isR ? COLORS.steel : p.market_type === "low" ? COLORS.steel : COLORS.amber;
  const unit = isR ? '"' : "°F";
  const threshStr = p.threshold_high
    ? `${p.threshold_low}–${p.threshold_high}${unit}`
    : `${isR ? p.operator : p.market_type === "low" ? (p.low_direction === "above" ? ">" : "<") : ">"} ${p.threshold_low}${unit}`;

  // RAINM observation progress
  const obsProgress = isR && p.total_days_in_month
    ? p.days_observed / p.total_days_in_month
    : null;
  const predictiveProgress = isR && p.predictive_mean > 0 && p.observed_so_far !== null
    ? Math.min(1, p.observed_so_far / p.predictive_mean)
    : null;
  const thresholdProgress = isR && p.threshold_low > 0 && p.observed_so_far !== null
    ? Math.min(1, p.observed_so_far / p.threshold_low)
    : null;

  return (
    <div style={{
      padding: "16px 20px",
      borderBottom: `1px solid ${COLORS.lineSoft}`,
      display: "grid",
      gridTemplateColumns: isR ? "1fr auto" : "1fr auto",
      gap: 16,
      alignItems: "center",
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{
            padding: "1px 5px", fontSize: 9, fontWeight: 700,
            color: typeColor, border: `1px solid ${typeColor}55`,
            background: typeColor + "15", letterSpacing: 0.08,
          }}>
            {isR ? "RAIN" : p.market_type.toUpperCase()}
          </span>
          <span style={{
            padding: "1px 5px", fontSize: 9, fontWeight: 700,
            color: colorGrade(p.grade), border: `1px solid ${colorGrade(p.grade)}55`,
            background: colorGrade(p.grade) + "15",
          }}>
            {p.grade}
          </span>
          <span className="ws-display" style={{ fontSize: 15, fontWeight: 500, color: COLORS.ink }}>
            {p.city}
          </span>
          <span style={{ color: COLORS.inkMuted, fontSize: 11 }}>· {p.target}</span>
        </div>
        <div style={{ display: "flex", gap: 20, fontSize: 11, color: COLORS.inkDim }}>
          <span>{threshStr}</span>
          <span style={{ color: p.bet_side === "YES" ? COLORS.forest : COLORS.coral, fontWeight: 600 }}>{p.bet_side}</span>
          <span>@<span className="ws-num">{p.entry_price.toFixed(2)}</span></span>
          <span className="ws-num">${p.size_usd}</span>
          <span className="ws-num" style={{ color: COLORS.amber }}>+{p.edge_pct.toFixed(1)}%</span>
        </div>
        {isR && p.observed_so_far !== null && (
          <div style={{ marginTop: 10, fontSize: 10, color: COLORS.inkMuted }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span>Obs: <span className="ws-num" style={{ color: COLORS.ink }}>{p.observed_so_far?.toFixed(2)}"</span>
                {" "}/ Pred: <span className="ws-num" style={{ color: COLORS.ink }}>{p.predictive_mean?.toFixed(2)}"</span></span>
              <span>Day <span className="ws-num" style={{ color: COLORS.ink }}>{p.days_observed}/{p.total_days_in_month}</span></span>
            </div>
            {/* Dual-bar: threshold progress + month progress */}
            <div style={{ position: "relative", height: 4, background: COLORS.lineSoft, overflow: "hidden" }}>
              <div style={{
                height: 4, width: `${(thresholdProgress ?? 0) * 100}%`,
                background: thresholdProgress >= 1 ? COLORS.forest : COLORS.steel,
                opacity: 0.9,
              }} />
              <div style={{
                position: "absolute", top: 0, height: 4,
                width: `${(obsProgress ?? 0) * 100}%`,
                borderRight: `1px solid ${COLORS.amber}`,
                pointerEvents: "none",
              }} />
            </div>
          </div>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="ws-eyebrow" style={{ fontSize: 9 }}>Settles in</div>
        <div className="ws-num" style={{ fontSize: 13, color: COLORS.ink, fontWeight: 500 }}>
          {formatTtl(p.ttl_sec)}
        </div>
        <div className="ws-num" style={{ fontSize: 10, color: COLORS.forest, marginTop: 3 }}>
          +{money(p.potential_win, { sign: false, decimals: 2 })}
        </div>
      </div>
    </div>
  );
}

// ── Recent signals panel ──────────────────────────────────────────────
function SignalFeed({ signals }) {
  return (
    <Card eyebrow="Stream" title="Signal Feed" noPad>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        {signals.map((s, i) => (
          <div key={i} style={{
            padding: "11px 20px",
            borderBottom: `1px solid ${COLORS.lineSoft}`,
            display: "grid",
            gridTemplateColumns: "auto auto 1fr auto auto",
            gap: 10,
            alignItems: "center",
            fontSize: 11,
          }}>
            <span style={{
              padding: "2px 5px", fontSize: 9, fontWeight: 700,
              color: colorGrade(s.grade), border: `1px solid ${colorGrade(s.grade)}55`,
              background: colorGrade(s.grade) + "15", width: 18, textAlign: "center",
            }}>
              {s.grade}
            </span>
            <span style={{ color: COLORS.inkMuted, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.1, width: 38 }}>
              {s.market_type === "rainm" ? "RAIN" : s.market_type}
            </span>
            <div>
              <div className="ws-display" style={{ fontSize: 13, color: COLORS.ink, fontWeight: 500 }}>{s.city}</div>
              <div style={{ color: COLORS.inkMuted, fontSize: 10, marginTop: 1 }}>
                {s.market_type === "rainm" ? `${s.threshold.toFixed(2)}"` : `${s.threshold}°F`} · <span style={{ color: s.bet_side === "YES" ? COLORS.forest : COLORS.coral }}>{s.bet_side}</span>
              </div>
            </div>
            <div className="ws-num" style={{ color: COLORS.amber, fontWeight: 500 }}>+{s.edge.toFixed(1)}%</div>
            <div style={{ textAlign: "right" }}>
              <div className="ws-num" style={{ color: COLORS.inkDim, fontSize: 10 }}>{s.conf}%</div>
              <div style={{ color: COLORS.inkMuted, fontSize: 9, marginTop: 1 }}>{relTime(s.ts)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Recent settlements ─────────────────────────────────────────────────
function RecentSettlements({ items }) {
  return (
    <Card eyebrow="Ledger" title={`Recent Settlements · ${items.length}`} noPad>
      <div style={{ overflowY: "auto", maxHeight: 360 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ color: COLORS.inkMuted }}>
              {["Settled", "City", "Type", "Contract", "Side", "Actual", "Outcome", "P&L"].map(h => (
                <th key={h} className="ws-eyebrow" style={{
                  padding: "10px 14px 8px", textAlign: "left", fontSize: 9,
                  borderBottom: `1px solid ${COLORS.line}`, background: COLORS.bgSofter,
                  position: "sticky", top: 0, zIndex: 1,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((t, i) => {
              const isR = t.market_type === "rainm";
              const unit = isR ? '"' : "°F";
              const thresh = t.threshold_high
                ? `${t.threshold_low}–${t.threshold_high}${unit}`
                : `${t.threshold_low}${unit}`;
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${COLORS.lineSoft}` }}>
                  <td style={{ padding: "11px 14px", color: COLORS.inkDim }}>{relTime(t.settled_at)}</td>
                  <td style={{ padding: "11px 14px" }}><span className="ws-display" style={{ color: COLORS.ink }}>{t.city}</span></td>
                  <td style={{ padding: "11px 14px", color: COLORS.inkDim, textTransform: "uppercase", fontSize: 10 }}>
                    {isR ? "RAIN" : t.market_type}
                  </td>
                  <td style={{ padding: "11px 14px", color: COLORS.ink }} className="ws-num">{thresh}</td>
                  <td style={{ padding: "11px 14px", color: t.bet_side === "YES" ? COLORS.forest : COLORS.coral, fontWeight: 500 }}>
                    {t.bet_side}
                  </td>
                  <td style={{ padding: "11px 14px", color: COLORS.ink }} className="ws-num">{t.actual}{unit}</td>
                  <td style={{ padding: "11px 14px" }}>
                    <span style={{
                      padding: "1px 6px", fontSize: 10, fontWeight: 600,
                      color: t.status === "win" ? COLORS.forest : COLORS.coral,
                      background: (t.status === "win" ? COLORS.forest : COLORS.coral) + "15",
                      border: `1px solid ${(t.status === "win" ? COLORS.forest : COLORS.coral)}44`,
                    }}>
                      {t.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "11px 14px", color: colorPnl(t.pnl), fontWeight: 500 }} className="ws-num">
                    {money(t.pnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── By-type performance ────────────────────────────────────────────────
function ByTypePanel({ byType }) {
  const rows = Object.entries(byType).map(([k, v]) => ({ type: k, ...v }));
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  return (
    <Card eyebrow="Decomposition" title="Market Type">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {rows.map(r => {
          const color = r.type === "rainm" ? COLORS.steel : r.type === "low" ? "#a8a28f" : COLORS.amber;
          const typeLabel = r.type === "rainm" ? "RAIN" : r.type.toUpperCase();
          return (
            <div key={r.type}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <div>
                  <span style={{
                    padding: "1px 6px", fontSize: 9, fontWeight: 700,
                    color, border: `1px solid ${color}55`, background: color + "15",
                  }}>{typeLabel}</span>
                  <span style={{ marginLeft: 10, fontSize: 10, color: COLORS.inkDim }}>
                    <span className="ws-num">{r.wins}W</span> · <span className="ws-num">{r.losses}L</span> · <span className="ws-num">{r.open}</span> open
                  </span>
                </div>
                <div className="ws-display ws-num" style={{ fontSize: 18, color: colorPnl(r.pnl), fontWeight: 500 }}>
                  {money(r.pnl)}
                </div>
              </div>
              {/* Horizontal win/loss bar */}
              <div style={{ display: "flex", height: 4, background: COLORS.lineSoft, overflow: "hidden" }}>
                <div style={{ width: `${(r.wins / (r.wins + r.losses || 1)) * 100}%`, background: COLORS.forest }} />
                <div style={{ flex: 1, background: COLORS.coral }} />
              </div>
              <div style={{ marginTop: 5, fontSize: 10, color: COLORS.inkMuted, display: "flex", justifyContent: "space-between" }}>
                <span>Win rate <span className="ws-num" style={{ color: COLORS.ink }}>{pct(r.win_rate)}</span></span>
                <span>{r.trades} settled</span>
              </div>
            </div>
          );
        })}
        <div className="ws-hair" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span className="ws-eyebrow">Total</span>
          <span className="ws-display ws-num" style={{ fontSize: 18, color: colorPnl(totalPnl), fontWeight: 500 }}>
            {money(totalPnl)}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Calibration panel ─────────────────────────────────────────────────
function CalibrationPanel({ cal }) {
  const reliability = cal.reliability ?? [];
  const diag = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  return (
    <Card eyebrow="Model" title="Calibration">
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "center" }}>
        <div>
          <div className="ws-eyebrow">Brier Score</div>
          <div className="ws-display ws-num" style={{ fontSize: 38, fontWeight: 300, lineHeight: 1, color: COLORS.ink, marginTop: 6 }}>
            {cal.brier_score?.toFixed(3) ?? "—"}
          </div>
          <div style={{ fontSize: 10, color: COLORS.inkDim, marginTop: 6 }}>
            n=<span className="ws-num">{cal.decisive}</span> · since <span className="ws-num">{cal.model_epoch}</span>
          </div>
          <div style={{ marginTop: 14, fontSize: 10, color: COLORS.inkMuted, lineHeight: 1.5 }}>
            Lower is better.<br />
            <span style={{ color: COLORS.forest }}>&lt;0.20</span> excellent<br />
            <span style={{ color: COLORS.amber }}>0.20–0.25</span> acceptable<br />
            <span style={{ color: COLORS.coral }}>&gt;0.25</span> needs refit
          </div>
        </div>
        <div style={{ height: 200, marginLeft: -8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 8, bottom: 10, left: 0 }}>
              <CartesianGrid stroke={COLORS.lineSoft} strokeDasharray="2 4" />
              <XAxis type="number" dataKey="x" domain={[0, 1]} hide />
              <YAxis type="number" dataKey="y" domain={[0, 1]} hide />
              <Line type="linear" data={diag} dataKey="y" stroke={COLORS.inkMuted} strokeDasharray="2 3" dot={false} />
              <Scatter data={reliability.map(r => ({ x: r.predicted, y: r.empirical, n: r.n }))}
                fill={COLORS.amber}>
                {reliability.map((r, i) => (
                  <Cell key={i} fill={COLORS.amber} />
                ))}
              </Scatter>
              <Tooltip
                contentStyle={{
                  background: COLORS.bgSofter, border: `1px solid ${COLORS.line}`,
                  borderRadius: 2, fontSize: 10, fontFamily: "JetBrains Mono",
                }}
                formatter={(v, n) => [v.toFixed(2), n === "x" ? "Predicted" : n === "y" ? "Empirical" : n]}
                cursor={{ stroke: COLORS.inkMuted, strokeDasharray: "2 3" }}
              />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="ws-eyebrow" style={{ textAlign: "center", marginTop: 4 }}>
            Predicted → Empirical
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── City heatmap ──────────────────────────────────────────────────────
function CityGrid({ cities }) {
  const maxPnl = Math.max(...cities.map(c => Math.abs(c.pnl)));
  return (
    <Card eyebrow="Geography" title="City Performance · 20">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 1, background: COLORS.line }}>
        {cities.map(c => {
          const intensity = maxPnl > 0 ? Math.abs(c.pnl) / maxPnl : 0;
          const baseColor = c.pnl > 0 ? COLORS.forest : c.pnl < 0 ? COLORS.coral : COLORS.inkMuted;
          const bg = c.trades === 0 ? COLORS.bgSoft
            : `color-mix(in srgb, ${baseColor} ${Math.round(intensity * 35)}%, ${COLORS.bgSoft})`;
          return (
            <div key={c.city} style={{ background: bg, padding: "13px 14px", minHeight: 74 }}>
              <div className="ws-display" style={{ fontSize: 12, fontWeight: 500, color: COLORS.ink, lineHeight: 1.1 }}>
                {c.city}
              </div>
              {c.trades === 0 ? (
                <div style={{ color: COLORS.inkMuted, fontSize: 9, marginTop: 6 }}>— no trades</div>
              ) : (
                <>
                  <div className="ws-num" style={{ fontSize: 16, color: colorPnl(c.pnl), fontWeight: 500, marginTop: 3, letterSpacing: -0.02 }}>
                    {money(c.pnl, { decimals: 0 })}
                  </div>
                  <div style={{ fontSize: 9, color: COLORS.inkMuted, marginTop: 2, display: "flex", gap: 8 }}>
                    <span className="ws-num">{c.wins}W/{c.losses}L</span>
                    {c.win_rate !== null && <span className="ws-num">{pct(c.win_rate, 0)}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Markets snapshot ──────────────────────────────────────────────────
function MarketsSnapshot({ d }) {
  const m = d.markets;
  const successPct = m.forecasts_total > 0 ? (m.forecasts_ok / m.forecasts_total) : 0;
  return (
    <Card eyebrow="Intake" title="Data Streams">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <DataStream label="HIGH markets"  value={m.high}  color={COLORS.amber} />
        <DataStream label="LOW markets"   value={m.low}   color="#a8a28f" />
        <DataStream label="RAINM markets" value={m.rainm} color={COLORS.steel} />
        <div className="ws-hair" />
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: COLORS.inkDim }}>Forecast success</span>
            <span className="ws-num" style={{ color: COLORS.ink }}>
              {m.forecasts_ok}/{m.forecasts_total} · {pct(successPct, 0)}
            </span>
          </div>
          <div style={{ height: 3, background: COLORS.lineSoft, overflow: "hidden" }}>
            <div style={{ height: 3, width: `${successPct * 100}%`,
              background: successPct >= 0.95 ? COLORS.forest : successPct >= 0.85 ? COLORS.amber : COLORS.coral,
            }} />
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: COLORS.inkDim }}>RAINM forecasts</span>
            <span className="ws-num" style={{ color: COLORS.ink }}>{m.rainm_forecasts_ok}</span>
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: COLORS.inkDim, marginTop: 4 }}>
            <span>Last RAINM scan</span>
            <span>{relTime(d.status.last_rainm_cycle_at)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
function DataStream({ label, value, color }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center" }}>
      <span style={{ width: 6, height: 6, background: color, borderRadius: "50%" }} />
      <span style={{ fontSize: 11, color: COLORS.inkDim }}>{label}</span>
      <span className="ws-display ws-num" style={{ fontSize: 20, fontWeight: 400, color: COLORS.ink, minWidth: 40, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

// ── RAINM panel ──────────────────────────────────────────────────────
function RainmPanel({ rainm, cfg }) {
  const cap = rainm.portfolio_cap_pct * (cfg.bankroll_usd ?? 500);
  const exposurePct = cap > 0 ? rainm.total_exposure / cap : 0;
  return (
    <Card eyebrow="Monthly" title="RAINM Exposure" right={
      <span className="ws-eyebrow" style={{ color: COLORS.steel, fontSize: 10, letterSpacing: 0.1 }}>
        🌧  {cfg.rainm_enabled ? "ACTIVE" : "OFF"}
      </span>
    }>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span className="ws-eyebrow">Total allocated</span>
          <span className="ws-num" style={{ color: COLORS.inkDim, fontSize: 10 }}>
            cap ${cap.toFixed(0)} · {pct(rainm.portfolio_cap_pct, 0)}
          </span>
        </div>
        <div className="ws-display ws-num" style={{ fontSize: 32, fontWeight: 300, color: COLORS.ink, lineHeight: 1 }}>
          ${rainm.total_exposure.toFixed(2)}
        </div>
        <div style={{ height: 3, background: COLORS.lineSoft, marginTop: 10, overflow: "hidden" }}>
          <div style={{ height: 3, width: `${Math.min(100, exposurePct * 100)}%`,
            background: exposurePct >= 0.9 ? COLORS.coral : exposurePct >= 0.7 ? COLORS.amber : COLORS.steel,
          }} />
        </div>
      </div>
      <div className="ws-hair" style={{ marginTop: 20 }} />
      <div style={{ marginTop: 16 }}>
        <div className="ws-eyebrow" style={{ marginBottom: 10 }}>By target month</div>
        {rainm.months.map(m => (
          <div key={m.month} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 11 }}>
            <span>
              <span className="ws-num" style={{ color: COLORS.ink }}>{m.month}</span>
              {m.trades > 0 && (
                <span style={{ color: COLORS.inkDim, marginLeft: 8 }}>
                  · {m.trades} {m.trades === 1 ? "trade" : "trades"} · {m.cities.length} cit{m.cities.length === 1 ? "y" : "ies"}
                </span>
              )}
            </span>
            <span className="ws-num" style={{ color: m.exposure > 0 ? COLORS.ink : COLORS.inkMuted }}>
              ${m.exposure.toFixed(2)}
            </span>
          </div>
        ))}
        {rainm.months.length === 0 && (
          <div style={{ fontSize: 11, color: COLORS.inkMuted, fontStyle: "italic" }}>No open RAINM positions</div>
        )}
      </div>
    </Card>
  );
}

// ── By-grade breakdown ────────────────────────────────────────────────
function ByGradePanel({ byGrade }) {
  const rows = Object.entries(byGrade).map(([k, v]) => ({ grade: k, ...v }));
  return (
    <Card eyebrow="Confidence" title="By Grade">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map(r => (
          <div key={r.grade} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center", fontSize: 11 }}>
            <span style={{
              width: 26, height: 26, fontSize: 12, fontWeight: 700,
              color: colorGrade(r.grade), border: `1px solid ${colorGrade(r.grade)}88`,
              background: colorGrade(r.grade) + "15",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              {r.grade}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: COLORS.inkDim, marginBottom: 3 }}>
                <span className="ws-num">{r.wins}W</span> / <span className="ws-num">{r.losses}L</span> · <span className="ws-num">{pct(r.win_rate)}</span>
              </div>
              <div style={{ height: 3, background: COLORS.lineSoft, overflow: "hidden" }}>
                <div style={{ height: 3, width: `${(r.win_rate ?? 0) * 100}%`, background: colorGrade(r.grade) }} />
              </div>
            </div>
            <span className="ws-display ws-num" style={{ fontSize: 17, color: colorPnl(r.pnl), fontWeight: 500 }}>
              {money(r.pnl)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Station biases ────────────────────────────────────────────────────
function StationBiasesPanel({ biases }) {
  const highPairs = Object.entries(biases.high ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  const lowPairs  = Object.entries(biases.low  ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5);
  return (
    <Card eyebrow="Calibration" title="Station Biases" right={
      <span style={{ fontSize: 10, color: COLORS.inkMuted }}>upd {relTime(biases.updated_at)}</span>
    }>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <BiasColumn label="HIGH" pairs={highPairs} />
        <BiasColumn label="LOW"  pairs={lowPairs}  />
      </div>
    </Card>
  );
}
function BiasColumn({ label, pairs }) {
  const max = Math.max(0.01, ...pairs.map(([, v]) => Math.abs(v)));
  return (
    <div>
      <div className="ws-eyebrow" style={{ marginBottom: 8, fontSize: 9 }}>{label} · TOP 5</div>
      {pairs.length === 0 && <div style={{ fontSize: 11, color: COLORS.inkMuted, fontStyle: "italic" }}>no data</div>}
      {pairs.map(([city, v]) => (
        <div key={city} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginBottom: 6, alignItems: "center", fontSize: 10 }}>
          <div>
            <div style={{ color: COLORS.ink, fontSize: 11, marginBottom: 2 }}>{city}</div>
            <div style={{ position: "relative", height: 2, background: COLORS.lineSoft }}>
              <div style={{
                position: "absolute", top: 0, left: "50%", height: 2,
                width: `${(Math.abs(v) / max) * 50}%`,
                background: v > 0 ? COLORS.coral : COLORS.steel,
                transform: v > 0 ? "translateX(0)" : "translateX(-100%)",
              }} />
              <div style={{ position: "absolute", top: -1, left: "50%", width: 1, height: 4, background: COLORS.inkMuted }} />
            </div>
          </div>
          <span className="ws-num" style={{ color: v > 0 ? COLORS.coral : COLORS.steel, fontWeight: 500, minWidth: 38, textAlign: "right" }}>
            {v > 0 ? "+" : ""}{v.toFixed(1)}°
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Data loader: polls the bot's /dashboard.json endpoint ───────────────
//
// Configuration precedence:
//   1. Next.js env var: process.env.NEXT_PUBLIC_DASHBOARD_URL
//   2. Global set at runtime: window.__DASHBOARD_URL__
//   3. SAMPLE (dev/demo mode)
// Auth token follows the same pattern.
//
// Polls every 10 seconds.  Silently retains the last successful
// snapshot on failure rather than blanking the UI — a 30s Railway
// hiccup shouldn't wipe the display.
function useDashboardData() {
  const [data,    setData]    = React.useState(null);
  const [error,   setError]   = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [lastFetch, setLastFetch] = React.useState(null);

  const url = (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_DASHBOARD_URL)
    || (typeof window !== "undefined" && window.__DASHBOARD_URL__)
    || null;
  const token = (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_DASHBOARD_TOKEN)
    || (typeof window !== "undefined" && window.__DASHBOARD_TOKEN__)
    || null;

  useEffect(() => {
    // No URL configured → ship the artifact with SAMPLE so the design
    // is visible at demo-time without a live backend.
    if (!url) {
      setData(SAMPLE);
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function tick() {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(url, { headers, cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        setError(null);
        setLastFetch(Date.now());
      } catch (e) {
        if (cancelled) return;
        setError(String(e.message || e));
        // Don't null out data — keep showing last known good.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    tick();
    const id = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [url, token]);

  return { data, error, loading, lastFetch };
}

// ── Main dashboard ─────────────────────────────────────────────────────
export default function Dashboard() {
  useBootStyles();
  const { data: liveData, error, loading, lastFetch } = useDashboardData();
  const d = liveData || SAMPLE;
  const isDemo = liveData === SAMPLE || liveData === null;

  if (loading && !liveData) {
    return (
      <div className="ws-app ws-atmosphere" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="ws-content" style={{ textAlign: "center" }}>
          <div className="ws-eyebrow" style={{ marginBottom: 8 }}>Connecting</div>
          <div className="ws-display" style={{ fontSize: 32, color: COLORS.ink }}>Adekagagwaa</div>
          <div style={{ color: COLORS.inkMuted, fontSize: 11, marginTop: 6 }}>Lord of the Weather</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ws-app ws-atmosphere">
      <div className="ws-content">
        <StatusBar d={d} />
        <Ticker signals={d.recent_signals} />
        <HeroKPIs d={d} />

        {/* Error banner — shown if most recent fetch failed but we still
            have stale data to render */}
        {error && liveData && (
          <div style={{
            background: `${COLORS.coral}15`,
            borderBottom: `1px solid ${COLORS.coral}44`,
            padding: "8px 32px",
            fontSize: 11,
            color: COLORS.coral,
            display: "flex",
            justifyContent: "space-between",
          }}>
            <span>⚠ Stream error: {error} — showing last known state</span>
            <span style={{ color: COLORS.inkMuted }}>
              last fetch: {lastFetch ? relTime(new Date(lastFetch).toISOString()) : "—"}
            </span>
          </div>
        )}

        <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Row 1: Hero P&L chart */}
          <PnLChart curve={d.pnl_curve} modelEpoch={d.calibration.model_epoch} />

          {/* Row 2: Live book (open positions) + Signal feed */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 24 }}>
            <OpenPositions positions={d.open_positions} />
            <SignalFeed signals={d.recent_signals} />
          </div>

          {/* Row 3: Decomp panels */}
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 24 }}>
            <ByTypePanel byType={d.by_type} />
            <ByGradePanel byGrade={d.by_grade} />
            <MarketsSnapshot d={d} />
          </div>

          {/* Row 4: RAINM + Calibration */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 24 }}>
            <RainmPanel rainm={d.rainm} cfg={d.config} />
            <CalibrationPanel cal={d.calibration} />
          </div>

          {/* Row 5: City grid */}
          <CityGrid cities={d.by_city} />

          {/* Row 6: Station biases + Recent settlements */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 24 }}>
            <StationBiasesPanel biases={d.station_biases} />
            <RecentSettlements items={d.recent_settlements} />
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 0 8px", fontSize: 10, color: COLORS.inkMuted, borderTop: `1px solid ${COLORS.lineSoft}` }}>
            <span>
              v{d.version} · schema locked · generated {relTime(d.generated_at)} ·
              {isDemo ? " demo data (no backend)" : " live stream"}
            </span>
            <span>
              bankroll ${d.config.bankroll_usd} · min edge {d.config.min_edge_pct}% · temp {d.config.max_portfolio_pct * 100}%/city · rainm {d.config.rainm_max_portfolio_pct * 100}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
