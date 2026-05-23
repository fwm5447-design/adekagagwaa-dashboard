'use client';

import { useMemo } from 'react';
import SectionFrame from '../layout/SectionFrame';

/**
 * BotHealth — composite operational dashboard for the four bot-state
 * observability views added during the 2026-05-23 end-to-end pipeline
 * audit.
 *
 * Four signals, each a "would-this-page-me-at-3am" tile:
 *
 *   1. Forecast accuracy drift — analytics.v_forecast_accuracy_drift_alert
 *      Per-(city, market_type) MAE recent vs prior 30-day baseline.
 *      CRITICAL when current MAE > 1.5x baseline AND delta > 0.5°F.
 *
 *   2. Per-cell P&L drift — analytics.v_cell_pnl_drift
 *      Per-(city, market_type) realized EV recent vs baseline.
 *      CRITICAL when was +EV, now clearly -EV.
 *
 *   3. Orphan settlements — analytics.v_orphan_settled_trades
 *      Trades whose settlement row exists but trades.status stayed open.
 *      orphan_reconciler.py heals every 5 min — should stay at 0.
 *
 *   4. Stuck unsettled trades — analytics.v_stuck_unsettled_trades
 *      Filled trades past target_date with zero settlement rows.
 *      Settler skipped them; either the strike-type path bug or operator
 *      backfill needed.
 *
 * The component shows compact tiles at top with the headline counts,
 * then drills down into per-cell detail tables for any non-OK signals.
 */
export default function BotHealth({ data, freshness }) {
  const driftForecast = data?.forecastDrift ?? [];
  const driftPnL      = data?.pnlDrift      ?? [];
  const orphans       = data?.orphans       ?? [];
  const stuck         = data?.stuck         ?? [];

  const summary = useMemo(() => {
    const countByLevel = (rows, key = 'alert_level') => rows.reduce((acc, r) => {
      const level = String(r[key] || 'OK');
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {});
    return {
      forecast: countByLevel(driftForecast),
      pnl:      countByLevel(driftPnL),
      orphans:  orphans.length,
      stuck:    stuck.length,
    };
  }, [driftForecast, driftPnL, orphans, stuck]);

  const driftForecastBad = useMemo(
    () => driftForecast.filter((r) => r.alert_level === 'CRITICAL' || r.alert_level === 'WARNING'),
    [driftForecast],
  );
  const driftPnLBad = useMemo(
    () => driftPnL.filter((r) => r.alert_level === 'CRITICAL' || r.alert_level === 'WARNING'),
    [driftPnL],
  );

  return (
    <SectionFrame
      id="bot-health"
      invocation="Watch"
      title="Bot Health Monitor"
      subtitle="Four observability views that catch the next class of drift before it costs money: per-cell forecast accuracy, per-cell realized EV, orphan settlements (settler mirror missed), and stuck unsettled trades (settler skipped entirely).  Each populates a daily-poll alert tile; non-OK rows surface in the detail tables below."
      freshnessAt={freshness}
      freshnessCadenceSec={3600}
    >
      {/* ── 4-tile health summary ────────────────────────────────── */}
      <div style={S.tileGrid}>
        <HealthTile
          label="Forecast MAE drift"
          critical={summary.forecast.CRITICAL || 0}
          warning={summary.forecast.WARNING  || 0}
          ok={summary.forecast.OK            || 0}
          insufficient={summary.forecast.INSUFFICIENT_DATA || 0}
        />
        <HealthTile
          label="Per-cell EV drift"
          critical={summary.pnl.CRITICAL || 0}
          warning={summary.pnl.WARNING  || 0}
          ok={summary.pnl.OK            || 0}
          insufficient={summary.pnl.INSUFFICIENT_DATA || 0}
        />
        <CountTile
          label="Orphan settlements"
          count={summary.orphans}
          good={summary.orphans === 0}
          help="reconciler auto-heals every 5 min"
        />
        <CountTile
          label="Stuck unsettled"
          count={summary.stuck}
          good={summary.stuck === 0}
          help="settler skipped these; manual backfill needed"
        />
      </div>

      {/* ── Forecast drift detail (only if any) ─────────────────── */}
      {driftForecastBad.length > 0 && (
        <DriftTable
          title="Forecast accuracy drift · per cell · 7d recent vs 30d baseline"
          rows={driftForecastBad}
          metricLabel="MAE (°F)"
          getRecent={(r) => r.mae_recent}
          getBaseline={(r) => r.mae_baseline}
          getDelta={(r) => r.mae_delta_f}
          getPct={(r) => r.pct_worse}
        />
      )}

      {/* ── P&L drift detail (only if any) ──────────────────────── */}
      {driftPnLBad.length > 0 && (
        <DriftTable
          title="Per-cell P&L drift · 7d recent vs 30d baseline · per $ wagered"
          rows={driftPnLBad}
          metricLabel="EV $/$"
          getRecent={(r) => r.ev_recent}
          getBaseline={(r) => r.ev_baseline}
          getDelta={(r) => r.ev_delta}
          getPct={null}
        />
      )}

      {/* ── Orphan settlements detail (only if any) ─────────────── */}
      {orphans.length > 0 && (
        <OrphanTable rows={orphans} />
      )}

      {/* ── Stuck unsettled detail (only if any) ────────────────── */}
      {stuck.length > 0 && (
        <StuckTable rows={stuck} />
      )}

      {/* ── All-green message ────────────────────────────────────── */}
      {driftForecastBad.length === 0
        && driftPnLBad.length === 0
        && orphans.length === 0
        && stuck.length === 0 && (
        <div style={S.allGood}>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>All-Clear</div>
          <div style={S.allGoodText}>
            Every cell within baseline tolerance. No orphans, no stuck trades.
          </div>
        </div>
      )}
    </SectionFrame>
  );
}


// ─── Tiles ──────────────────────────────────────────────────────────

function HealthTile({ label, critical, warning, ok, insufficient }) {
  const tone =
    critical > 0 ? 'negative'
    : warning  > 0 ? 'warning'
    : 'positive';
  const headline =
    critical > 0 ? `${critical} CRITICAL`
    : warning  > 0 ? `${warning} WARN`
    : `${ok} OK`;
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color: toneColor(tone) }}>
        {headline}
      </div>
      <div style={S.tileSub}>
        {[
          critical > 0 && `${critical} crit`,
          warning  > 0 && `${warning} warn`,
          ok       > 0 && `${ok} ok`,
          insufficient > 0 && `${insufficient} thin`,
        ].filter(Boolean).join(' · ') || 'no data'}
      </div>
    </div>
  );
}

function CountTile({ label, count, good, help }) {
  const tone = good ? 'positive' : (count < 5 ? 'warning' : 'negative');
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color: toneColor(tone) }}>
        {count}
      </div>
      <div style={S.tileSub}>{help}</div>
    </div>
  );
}


// ─── Detail tables ──────────────────────────────────────────────────

function DriftTable({ title, rows, metricLabel, getRecent, getBaseline, getDelta, getPct }) {
  return (
    <div style={S.tableCard}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>{title}</div>
      <table style={S.table}>
        <thead>
          <tr style={S.theadRow}>
            <th style={S.thLeft}>City</th>
            <th style={S.thLeft}>Type</th>
            <th style={S.thRight}>n recent</th>
            <th style={S.thRight}>baseline {metricLabel}</th>
            <th style={S.thRight}>recent {metricLabel}</th>
            <th style={S.thRight}>delta</th>
            {getPct && <th style={S.thRight}>% worse</th>}
            <th style={S.thLeft}>Level</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.city}-${r.market_type}-${i}`} style={S.tbodyRow}>
              <td style={S.tdLeft}>{r.city}</td>
              <td style={S.tdLeft}>{r.market_type}</td>
              <td style={S.tdRight}>{fmtInt(r.n_recent)}</td>
              <td style={S.tdRight}>{fmt(getBaseline(r), 2)}</td>
              <td style={S.tdRight}>{fmt(getRecent(r), 2)}</td>
              <td style={{
                ...S.tdRight,
                color: (Number(getDelta(r)) > 0 ? 'var(--coral-flare)' : '#7da78d'),
                fontWeight: 600,
              }}>
                {fmt(getDelta(r), 2)}
              </td>
              {getPct && (
                <td style={S.tdRight}>{fmt(getPct(r), 1)}%</td>
              )}
              <td style={{ ...S.tdLeft, color: levelColor(r.alert_level), fontWeight: 700 }}>
                {r.alert_level}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrphanTable({ rows }) {
  return (
    <div style={S.tableCard}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Orphan settlements · trades.status='open' but settlement row exists
      </div>
      <p style={S.tableNote}>
        The orphan-settlement reconciler auto-heals every 5 minutes.
        Non-zero counts here mean the periodic task is delayed or
        wedged.  Inspect <code>core/orphan_reconciler.py</code> logs.
      </p>
      <table style={S.table}>
        <thead>
          <tr style={S.theadRow}>
            <th style={S.thRight}>trade id</th>
            <th style={S.thLeft}>target</th>
            <th style={S.thLeft}>city</th>
            <th style={S.thLeft}>type</th>
            <th style={S.thLeft}>side</th>
            <th style={S.thLeft}>settlement status</th>
            <th style={S.thRight}>won</th>
            <th style={S.thRight}>pnl</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.trade_id || i} style={S.tbodyRow}>
              <td style={S.tdRight}>{r.trade_id}</td>
              <td style={S.tdLeft}>{r.target_date}</td>
              <td style={S.tdLeft}>{r.city}</td>
              <td style={S.tdLeft}>{r.market_type}</td>
              <td style={S.tdLeft}>{r.bet_side}</td>
              <td style={S.tdLeft}>{r.settlement_status}</td>
              <td style={S.tdRight}>{r.latest_won ? '✓' : '✗'}</td>
              <td style={{
                ...S.tdRight,
                color: Number(r.latest_pnl) >= 0 ? '#7da78d' : 'var(--coral-flare)',
              }}>
                {fmt(r.latest_pnl, 2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StuckTable({ rows }) {
  return (
    <div style={S.tableCard}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
        Stuck unsettled · filled past target_date, zero settlement rows
      </div>
      <p style={S.tableNote}>
        Settler skipped these entirely.  Requires either a fix to the
        settler's skip condition or operator backfill via
        manual_override.  See <code>analytics.v_stuck_unsettled_trades</code>.
      </p>
      <table style={S.table}>
        <thead>
          <tr style={S.theadRow}>
            <th style={S.thRight}>trade id</th>
            <th style={S.thLeft}>target</th>
            <th style={S.thLeft}>city</th>
            <th style={S.thLeft}>type</th>
            <th style={S.thLeft}>side</th>
            <th style={S.thRight}>thr low</th>
            <th style={S.thRight}>thr high</th>
            <th style={S.thRight}>days past</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.trade_id || i} style={S.tbodyRow}>
              <td style={S.tdRight}>{r.trade_id}</td>
              <td style={S.tdLeft}>{r.target_date}</td>
              <td style={S.tdLeft}>{r.city}</td>
              <td style={S.tdLeft}>{r.market_type}</td>
              <td style={S.tdLeft}>{r.bet_side}</td>
              <td style={S.tdRight}>{fmt(r.threshold_low, 1)}</td>
              <td style={S.tdRight}>{r.threshold_high == null ? '—' : fmt(r.threshold_high, 1)}</td>
              <td style={{
                ...S.tdRight,
                color: Number(r.days_past_target) > 2 ? 'var(--coral-flare)' : 'var(--dawn-amber)',
                fontWeight: 600,
              }}>
                {fmtInt(r.days_past_target)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ─── Helpers ────────────────────────────────────────────────────────

function fmt(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}
function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Math.round(Number(v)).toLocaleString('en-US');
}
function toneColor(tone) {
  return tone === 'positive' ? '#7da78d'
    : tone === 'warning' ? 'var(--dawn-amber)'
    : tone === 'negative' ? 'var(--coral-flare)'
    : 'var(--cloud-pearl)';
}
function levelColor(level) {
  return level === 'CRITICAL' ? 'var(--coral-flare)'
    : level === 'WARNING'    ? 'var(--dawn-amber)'
    : level === 'OK'         ? '#7da78d'
    : 'var(--cloud-mute)';
}


// ─── Styles ─────────────────────────────────────────────────────────

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
    minHeight: 110,
  },
  tileValue: {
    fontSize: 'var(--type-display)',
    lineHeight: 1.05,
    marginTop: 'var(--space-2)',
  },
  tileSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-2)',
  },
  allGood: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    textAlign: 'center',
  },
  allGoodText: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-h3)',
    color: '#7da78d',
    marginTop: 'var(--space-2)',
  },
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
    overflowX: 'auto',
  },
  tableNote: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    marginBottom: 'var(--space-3)',
    lineHeight: 1.5,
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
    color: 'var(--cloud-mute)', fontWeight: 500,
    fontSize: 'var(--type-micro)', textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  thRight: {
    textAlign: 'right', padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-mute)', fontWeight: 500,
    fontSize: 'var(--type-micro)', textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  tbodyRow: { borderBottom: '1px solid var(--rule-faint)' },
  tdLeft:  { textAlign: 'left',  padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-pearl)' },
  tdRight: { textAlign: 'right', padding: 'var(--space-2) var(--space-3)', color: 'var(--cloud-haze)' },
};
