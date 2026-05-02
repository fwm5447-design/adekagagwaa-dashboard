'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * OperationalPulse — mv_api_call_health_24h.
 *
 * Per-endpoint summary of HTTP traffic over the last 24 hours.
 * Surfaces three distinct concerns:
 *
 *   1. Latency distribution per endpoint (p50, p95, p99) — for
 *      detecting upstream degradation before it becomes outage.
 *
 *   2. Error rate per endpoint — 4xx and 5xx broken out.  Sustained
 *      4xx on a known-good endpoint means our auth or our request
 *      shape drifted; sustained 5xx means upstream.
 *
 *   3. Rate-limit headroom — `rate_limit_min_remaining` is the
 *      worst-case remaining quota seen in the window.  When this
 *      approaches zero we're being throttled; that's a tuning signal
 *      for scan cadence.
 */
export default function OperationalPulse({ rows = [], freshness }) {
  const data = useMemo(() => {
    return [...rows]
      .filter((r) => Number(r.n_calls) > 0)
      .map((r) => ({
        endpoint: String(r.endpoint_class || '?'),
        n_calls: Number(r.n_calls) || 0,
        n_errors: Number(r.n_errors) || 0,
        n_4xx: Number(r.n_4xx) || 0,
        n_5xx: Number(r.n_5xx) || 0,
        p50: Number(r.p50_duration_ms) || 0,
        p95: Number(r.p95_duration_ms) || 0,
        p99: Number(r.p99_duration_ms) || 0,
        total_bytes: Number(r.total_bytes) || 0,
        mean_bytes: Number(r.mean_bytes) || 0,
        rl_min: r.rate_limit_min_remaining == null ? null : Number(r.rate_limit_min_remaining),
        rl_mean: r.rate_limit_mean_remaining == null ? null : Number(r.rate_limit_mean_remaining),
        error_rate: (Number(r.n_calls) > 0)
          ? (Number(r.n_errors) || 0) / Number(r.n_calls)
          : 0,
      }))
      .sort((a, b) => b.n_calls - a.n_calls);
  }, [rows]);

  const totals = useMemo(() => {
    let calls = 0, errors = 0, e4xx = 0, e5xx = 0, bytes = 0;
    let throttled_endpoints = 0;
    for (const d of data) {
      calls += d.n_calls;
      errors += d.n_errors;
      e4xx += d.n_4xx;
      e5xx += d.n_5xx;
      bytes += d.total_bytes;
      if (d.rl_min !== null && d.rl_min < 100) throttled_endpoints += 1;
    }
    return {
      calls, errors, e4xx, e5xx, bytes,
      error_rate: calls > 0 ? errors / calls : 0,
      throttled_endpoints,
    };
  }, [data]);

  return (
    <SectionFrame
      id="pulse"
      invocation="Operational Pulse"
      title="Operational Pulse"
      subtitle="Every external call the bot makes — Kalshi, Open-Meteo, NWS, ACIS — passes through an instrumented session that records its latency, status, and remaining quota.  Sustained drift in any of these is the canary for upstream degradation."
      freshnessAt={freshness}
      freshnessCadenceSec={1800}
    >
      {/* Headline tiles */}
      <div style={S.tileGrid}>
        <Tile label="calls · 24h"   value={fmtInt(totals.calls)}  tone="neutral" />
        <Tile
          label="error rate"
          value={pct(totals.error_rate)}
          tone={totals.error_rate < 0.005 ? 'positive' : totals.error_rate < 0.02 ? 'warning' : 'negative'}
        />
        <Tile
          label="5xx · upstream"
          value={fmtInt(totals.e5xx)}
          tone={totals.e5xx === 0 ? 'positive' : 'negative'}
        />
        <Tile
          label="throttled endpoints"
          value={fmtInt(totals.throttled_endpoints)}
          tone={totals.throttled_endpoints === 0 ? 'positive' : 'warning'}
        />
      </div>

      {/* Latency chart */}
      <div style={S.chartCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Latency by endpoint · ms · p50 / p95 / p99
        </div>
        <ResponsiveContainer width="100%" height={Math.max(280, data.length * 36)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
              stroke="var(--rule-mid)"
            />
            <YAxis
              type="category"
              dataKey="endpoint"
              tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-haze)' }}
              stroke="var(--rule-mid)"
              width={180}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--ink-deep)',
                border: '1px solid var(--rule-mid)',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              formatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)} ms` : v)}
            />
            <Bar dataKey="p50" name="p50" fill="var(--sky-azure)" />
            <Bar dataKey="p95" name="p95" fill="var(--dawn-amber)" />
            <Bar dataKey="p99" name="p99" fill="var(--storm-violet)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed endpoint table */}
      <div style={S.tableCard}>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
          Per-endpoint detail
        </div>
        <table style={S.table}>
          <thead>
            <tr style={S.theadRow}>
              <th style={S.thLeft}>Endpoint</th>
              <th style={S.thRight}>n calls</th>
              <th style={S.thRight}>err rate</th>
              <th style={S.thRight}>4xx</th>
              <th style={S.thRight}>5xx</th>
              <th style={S.thRight}>p50 ms</th>
              <th style={S.thRight}>p95 ms</th>
              <th style={S.thRight}>p99 ms</th>
              <th style={S.thRight}>RL min</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr><td colSpan={9} style={S.tdEmpty}>No HTTP traffic recorded in the last 24 hours.</td></tr>
            )}
            {data.map((d, i) => {
              const errColor =
                d.error_rate < 0.005 ? '#7da78d'
                : d.error_rate < 0.02 ? 'var(--dawn-amber)'
                : 'var(--coral-flare)';
              const rlColor = d.rl_min == null ? 'var(--cloud-mute)'
                : d.rl_min < 50 ? 'var(--coral-flare)'
                : d.rl_min < 200 ? 'var(--dawn-amber)'
                : '#7da78d';
              return (
                <tr key={i} style={S.tbodyRow}>
                  <td style={S.tdLeft}>{d.endpoint}</td>
                  <td style={S.tdRight}>{fmtInt(d.n_calls)}</td>
                  <td style={{ ...S.tdRight, color: errColor, fontWeight: 600 }}>
                    {pct(d.error_rate)}
                  </td>
                  <td style={{ ...S.tdRight, color: d.n_4xx > 0 ? 'var(--dawn-amber)' : 'var(--cloud-mute)' }}>
                    {fmtInt(d.n_4xx)}
                  </td>
                  <td style={{ ...S.tdRight, color: d.n_5xx > 0 ? 'var(--coral-flare)' : 'var(--cloud-mute)' }}>
                    {fmtInt(d.n_5xx)}
                  </td>
                  <td style={S.tdRight}>{Math.round(d.p50)}</td>
                  <td style={S.tdRight}>{Math.round(d.p95)}</td>
                  <td style={S.tdRight}>{Math.round(d.p99)}</td>
                  <td style={{ ...S.tdRight, color: rlColor }}>
                    {d.rl_min == null ? '—' : fmtInt(d.rl_min)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}

function Tile({ label, value, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? '#7da78d'
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

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
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
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-5)',
  },
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    overflowX: 'auto',
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
  tdEmpty: {
    textAlign: 'center', padding: 'var(--space-5)',
    color: 'var(--cloud-mute)', fontStyle: 'italic',
  },
};
