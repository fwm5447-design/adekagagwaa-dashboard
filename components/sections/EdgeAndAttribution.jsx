'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';

/**
 * EdgeAndAttribution — replaces the prior RealizedEdge + ClosingLineCoverage
 * sections.  Folds them into one four-tier story:
 *
 *   TIER 1 — Realized P&L          (mv_trades_full, settler-truth, always lit)
 *   TIER 2 — Closing-line capture  (mv_closing_line_coverage, data quality gate)
 *   TIER 3 — Attribution pipeline  (v_attribution_pipeline_counts, drop diagnostic)
 *   TIER 4 — Closing-line decomposition (mv_pnl_attribution, per-contract edge)
 *
 * The verdict tile at top summarizes the overall earnings + the
 * capture state in a single banner.  Each tier is a self-contained
 * panel with its own status pill.
 *
 * Data shape:
 *   data.realized_summary  — per-market totals from mv_trades_full
 *   data.coverage          — per-day×market_type rows from mv_closing_line_coverage
 *   data.pipeline_counts   — single object with the 4-stage counts
 *   data.attribution       — per-trade rows from mv_pnl_attribution
 *   freshness              — ISO timestamp, treated as attribution freshness
 *                            (the headline P&L number drives off that view)
 */
export default function EdgeAndAttribution({ data = {}, freshness }) {
  const realizedSummary = useMemo(() => Array.isArray(data.realized_summary) ? data.realized_summary : [], [data.realized_summary]);
  const coverageRows    = useMemo(() => Array.isArray(data.coverage)         ? data.coverage         : [], [data.coverage]);
  const attributionRows = useMemo(() => Array.isArray(data.attribution)      ? data.attribution      : [], [data.attribution]);
  const pipelineCounts  = data.pipeline_counts || null;

  // ── TIER 1 — Realized P&L aggregates ─────────────────────────────
  const realizedByMarket = useMemo(() => {
    return [...realizedSummary]
      .map((r) => ({
        market_type: String(r.market_type),
        n_settled: Number(r.n_settled) || 0,
        n_won:     Number(r.n_won)     || 0,
        n_lost:    Number(r.n_lost)    || 0,
        pnl_net:   Number(r.total_pnl_net)   || 0,
        pnl_gross: Number(r.total_pnl_gross) || 0,
        size:      Number(r.total_intent_size_usd) || 0,
        fees:      Number(r.total_fees_paid) || 0,
      }))
      .sort((a, b) => a.market_type.localeCompare(b.market_type));
  }, [realizedSummary]);

  const realizedTotals = useMemo(() => {
    let n_settled = 0, n_won = 0, n_lost = 0;
    let pnl_net = 0, pnl_gross = 0, fees = 0, size = 0;
    for (const r of realizedByMarket) {
      n_settled += r.n_settled;
      n_won     += r.n_won;
      n_lost    += r.n_lost;
      pnl_net   += r.pnl_net;
      pnl_gross += r.pnl_gross;
      fees      += r.fees;
      size      += r.size;
    }
    const decisive = n_won + n_lost;
    return {
      n_settled, n_won, n_lost, decisive,
      pnl_net, pnl_gross, fees, size,
      roi:       size > 0     ? pnl_net / size      : 0,
      win_rate:  decisive > 0 ? n_won / decisive    : null,
    };
  }, [realizedByMarket]);

  // ── TIER 2 — Closing-line capture aggregates ─────────────────────
  // Distinguish "pending" (target_date >= today, can't be captured yet)
  // from "complete" (target_date < today, eligible window is closed).
  // The headline capture rate uses complete-only as denominator;
  // pending counts are surfaced separately so they don't drag the rate.
  const coverageAgg = useMemo(() => {
    const today = todayISO();
    const sevenDaysAgo = daysBeforeISO(today, 7);

    let pendingEligible = 0;
    let completeEligible = 0;
    let completeCaptured = 0;
    let completeMissed = 0;

    let recentEligible = 0;
    let recentCaptured = 0;
    let recentMissed   = 0;

    const dayRows = [];
    const dayMap = new Map();

    for (const r of coverageRows) {
      const dateStr = String(r.target_date_norm || '').slice(0, 10);
      if (!dateStr) continue;
      const eligible = Number(r.n_trades_eligible) || 0;
      const captured = Number(r.n_trades_captured) || 0;
      const missed   = Number(r.n_trades_missed)   || 0;
      const mt       = String(r.market_type || 'unknown');
      const isPending = dateStr >= today;
      const isRecent  = dateStr >= sevenDaysAgo && dateStr < today;

      if (isPending) {
        pendingEligible += eligible;
      } else {
        completeEligible += eligible;
        completeCaptured += captured;
        completeMissed   += missed;
        if (isRecent) {
          recentEligible += eligible;
          recentCaptured += captured;
          recentMissed   += missed;
        }
      }

      // Per-day pivot for the chart
      if (!dayMap.has(dateStr)) {
        dayMap.set(dateStr, { date: dateStr, isPending });
        dayRows.push(dayMap.get(dateStr));
      }
      const row = dayMap.get(dateStr);
      row[mt] = isPending ? null : Number(r.capture_rate);
      row[`${mt}__captured`] = captured;
      row[`${mt}__missed`]   = missed;
      row[`${mt}__eligible`] = eligible;
    }

    dayRows.sort((a, b) => a.date.localeCompare(b.date));

    return {
      pendingEligible, completeEligible, completeCaptured, completeMissed,
      recentEligible, recentCaptured, recentMissed,
      completeRate: completeEligible > 0 ? completeCaptured / completeEligible : null,
      recentRate:   recentEligible   > 0 ? recentCaptured   / recentEligible   : null,
      dayRows,
      marketTypes: Array.from(new Set(coverageRows.map((r) => String(r.market_type || 'unknown')))).sort(),
    };
  }, [coverageRows]);

  // ── TIER 3 — Pipeline counts (already a single object) ───────────
  // Just reformat into stages for the funnel rendering.
  const pipelineStages = useMemo(() => {
    if (!pipelineCounts) return null;
    const stages = [
      { key: 'n_settled',                 label: 'settled',           caption: 'trades with a settlement record' },
      { key: 'n_with_closing_line',       label: 'closing line',      caption: 'closing-line snapshot captured' },
      { key: 'n_with_orderbook_captured', label: 'orderbook',          caption: 'orderbook snapshot captured + non-empty' },
      { key: 'n_in_attribution',          label: 'in attribution',    caption: 'derived closing mid is finite' },
    ];
    const values = stages.map((s) => ({ ...s, value: Number(pipelineCounts[s.key]) || 0 }));
    const max = Math.max(...values.map((v) => v.value), 1);
    return values.map((v, i) => {
      const prev = i === 0 ? null : values[i - 1].value;
      const drop = prev != null ? prev - v.value : null;
      const dropPct = (prev != null && prev > 0) ? (drop / prev) * 100 : null;
      return { ...v, max, drop, dropPct };
    });
  }, [pipelineCounts]);

  // ── TIER 4 — Closing-line attribution decomposition ──────────────
  const byMarketType = useMemo(() => {
    const buckets = new Map();
    for (const r of attributionRows) {
      const mt = String(r.market_type || '?');
      if (!buckets.has(mt)) {
        buckets.set(mt, {
          market_type: mt,
          n_trades: 0,
          n_contracts_sum: 0,
          edge_sum: 0, variance_sum: 0,
          fees_sum: 0, slippage_sum: 0, realized_sum: 0,
        });
      }
      const b = buckets.get(mt);
      const n_contracts = Number(r.n_contracts) || 0;
      b.n_trades += 1;
      b.n_contracts_sum += n_contracts;
      b.edge_sum     += (Number(r.edge_per_contract)         || 0) * n_contracts;
      b.variance_sum += (Number(r.variance_per_contract)     || 0) * n_contracts;
      b.fees_sum     += (Number(r.fees_per_contract)         || 0) * n_contracts;
      b.slippage_sum += (Number(r.slippage_per_contract)     || 0) * n_contracts;
      b.realized_sum += (Number(r.realized_pnl_per_contract) || 0) * n_contracts;
    }
    const out = [];
    for (const b of buckets.values()) {
      const denom = Math.max(b.n_contracts_sum, 1);
      out.push({
        market_type: b.market_type,
        n_trades: b.n_trades,
        n_contracts: b.n_contracts_sum,
        edge: b.edge_sum / denom * 100,         // dollars → cents
        variance: b.variance_sum / denom * 100,
        fees: b.fees_sum / denom * 100,
        slippage: b.slippage_sum / denom * 100,
        realized: b.realized_sum / denom * 100,
      });
    }
    out.sort((a, b) => a.market_type.localeCompare(b.market_type));
    return out;
  }, [attributionRows]);

  const attributionTotals = useMemo(() => {
    let n_trades = 0, n_contracts = 0;
    let edge_w = 0, var_w = 0, fees_w = 0, slip_w = 0, real_w = 0;
    for (const b of byMarketType) {
      n_trades    += b.n_trades;
      n_contracts += b.n_contracts;
      edge_w += b.edge     * b.n_contracts;
      var_w  += b.variance * b.n_contracts;
      fees_w += b.fees     * b.n_contracts;
      slip_w += b.slippage * b.n_contracts;
      real_w += b.realized * b.n_contracts;
    }
    const denom = Math.max(n_contracts, 1);
    return {
      n_trades, n_contracts,
      mean_edge:     edge_w / denom,
      mean_variance: var_w  / denom,
      mean_fees:     fees_w / denom,
      mean_slippage: slip_w / denom,
      mean_realized: real_w / denom,
    };
  }, [byMarketType]);

  const waterfallData = useMemo(() => byMarketType.map((b) => ({
    market_type: b.market_type,
    edge: b.edge,
    fees: -Math.abs(b.fees),
    slippage: -Math.abs(b.slippage),
    variance: b.variance,
    realized: b.realized,
  })), [byMarketType]);

  const showAttribution = byMarketType.length > 0;

  // ── Verdict ─────────────────────────────────────────────────────
  const verdict = useMemo(() => buildVerdict({
    realizedTotals, coverageAgg,
  }), [realizedTotals, coverageAgg]);

  const hasAnyData = realizedTotals.n_settled > 0
    || coverageRows.length > 0
    || attributionRows.length > 0;

  return (
    <SectionFrame
      id="edge"
      invocation="Realized Edge & Attribution"
      title="Realized Edge & Attribution"
      subtitle="Settler-truth meets closing-line truth.  Above the line: what the books paid us on every settled trade.  Below: the closing-line decomposition that separates edge from variance from cost.  When the two diverge, you&rsquo;re either being lucky or the model is finding genuine inefficiency."
      freshnessAt={freshness}
      freshnessCadenceSec={300}
    >
      {!hasAnyData ? (
        <EmptyState />
      ) : (
        <>
          <Verdict verdict={verdict} totals={realizedTotals} coverageAgg={coverageAgg} />

          {/* ─── TIER 1 — Realized P&L ─────────────────────────── */}
          <Tier
            ordinal="tier one"
            title="Realized P&L · all settled trades"
            statusTone={verdict.stage_realized.tone}
            statusLabel={verdict.stage_realized.label}
          >
            {realizedTotals.n_settled === 0 ? (
              <Stub message="No settled trades yet — the tier-one tile populates the moment any trade settles." />
            ) : (
              <>
                <div style={S.tileRow4}>
                  <Tile
                    eyebrow="settled trades"
                    value={fmtInt(realizedTotals.n_settled)}
                    sub={`${fmtInt(realizedTotals.decisive)} decisive`}
                  />
                  <Tile
                    eyebrow="net P&L"
                    value={fmtUSD(realizedTotals.pnl_net)}
                    sub={`gross ${fmtUSD(realizedTotals.pnl_gross)}`}
                    tone={realizedTotals.pnl_net > 0 ? 'positive'
                        : realizedTotals.pnl_net < 0 ? 'negative' : 'neutral'}
                  />
                  <Tile
                    eyebrow="ROI"
                    value={realizedTotals.size > 0 ? `${(realizedTotals.roi * 100).toFixed(1)}%` : '—'}
                    sub={realizedTotals.size > 0 ? `on ${fmtUSD(realizedTotals.size)} staked` : 'no stakes yet'}
                    tone={realizedTotals.roi > 0 ? 'positive'
                        : realizedTotals.roi < 0 ? 'negative' : 'neutral'}
                  />
                  <Tile
                    eyebrow="win rate"
                    value={realizedTotals.win_rate == null ? '—' : `${(realizedTotals.win_rate * 100).toFixed(1)}%`}
                    sub={`${fmtInt(realizedTotals.n_won)} W · ${fmtInt(realizedTotals.n_lost)} L`}
                  />
                </div>
                {realizedByMarket.length > 0 && (
                  <div style={S.marketStrip}>
                    {realizedByMarket.map((b) => (
                      <MarketSplit key={b.market_type} bucket={b} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Tier>

          {/* ─── TIER 2 — Closing-line capture ─────────────────── */}
          <Tier
            ordinal="tier two"
            title="Closing-line capture · data-quality gate"
            statusTone={verdict.stage_capture.tone}
            statusLabel={verdict.stage_capture.label}
            meta="capture target ≥ 95% per market_type per day"
          >
            {coverageRows.length === 0 ? (
              <Stub message="No coverage rows yet — the scheduler captures market mid five minutes before settlement; rates light up after the first settled day." />
            ) : (
              <>
                <div style={S.tileRow4}>
                  <Tile
                    eyebrow="last 7 days"
                    value={coverageAgg.recentRate != null ? pct(coverageAgg.recentRate) : '—'}
                    sub={`${fmtInt(coverageAgg.recentCaptured)} / ${fmtInt(coverageAgg.recentEligible)} settled`}
                    tone={
                      coverageAgg.recentRate == null ? 'neutral'
                      : coverageAgg.recentRate >= 0.95 ? 'positive'
                      : coverageAgg.recentRate >= 0.85 ? 'warning'
                      : 'negative'
                    }
                  />
                  <Tile
                    eyebrow="all-time"
                    value={coverageAgg.completeRate != null ? pct(coverageAgg.completeRate) : '—'}
                    sub={`${fmtInt(coverageAgg.completeCaptured)} / ${fmtInt(coverageAgg.completeEligible)} settled`}
                    tone={
                      coverageAgg.completeRate == null ? 'neutral'
                      : coverageAgg.completeRate >= 0.95 ? 'positive'
                      : coverageAgg.completeRate >= 0.85 ? 'warning'
                      : 'negative'
                    }
                  />
                  <Tile
                    eyebrow="missed · 30d"
                    value={fmtInt(coverageAgg.completeMissed)}
                    sub={coverageAgg.completeMissed > 0 ? 'closing line never captured' : 'no gaps'}
                    tone={coverageAgg.completeMissed === 0 ? 'positive'
                        : coverageAgg.completeMissed < 10 ? 'warning' : 'negative'}
                  />
                  <Tile
                    eyebrow="pending"
                    value={fmtInt(coverageAgg.pendingEligible)}
                    sub="trades · target_date in future"
                    tone="neutral"
                  />
                </div>

                <div style={S.chartCard}>
                  <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                    Capture rate by day · last 30 days  (pending days hidden — capture isn&rsquo;t scheduled yet)
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={coverageAgg.dayRows.filter((d) => !d.isPending)}
                      margin={{ top: 12, right: 80, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
                        stroke="var(--rule-mid)"
                      />
                      <YAxis
                        domain={[0, 1]}
                        tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                        tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
                        stroke="var(--rule-mid)"
                      />
                      <Tooltip content={<CoverageTooltip marketTypes={coverageAgg.marketTypes} />} />
                      <ReferenceLine y={0.95} stroke="var(--dawn-gold)" strokeDasharray="3 3" label={{
                        value: 'healthy ≥ 95%', position: 'right',
                        fill: 'var(--dawn-gold)', fontFamily: 'var(--font-mono)', fontSize: 10,
                      }} />
                      <ReferenceLine y={0.85} stroke="var(--storm-violet)" strokeDasharray="3 3" label={{
                        value: 'attention < 85%', position: 'right',
                        fill: 'var(--storm-violet)', fontFamily: 'var(--font-mono)', fontSize: 10,
                      }} />
                      {coverageAgg.marketTypes.map((mt) => (
                        <Line
                          key={mt}
                          type="monotone"
                          dataKey={mt}
                          name={mt}
                          stroke={seriesColor(mt)}
                          strokeWidth={2}
                          dot={{ r: 3, fill: seriesColor(mt) }}
                          activeDot={{ r: 5 }}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={S.legend}>
                    {coverageAgg.marketTypes.map((mt) => (
                      <LegendDot key={mt} color={seriesColor(mt)} label={mt} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </Tier>

          {/* ─── TIER 3 — Attribution pipeline ─────────────────── */}
          <Tier
            ordinal="tier three"
            title="Attribution pipeline · where rows drop"
            statusTone={verdict.stage_pipeline.tone}
            statusLabel={verdict.stage_pipeline.label}
          >
            {pipelineStages == null ? (
              <Stub message="Pipeline counts unavailable.  Confirm v_attribution_pipeline_counts is reachable." />
            ) : (
              <div style={S.pipelineCard}>
                <div style={S.pipelineFunnel}>
                  {pipelineStages.map((s, i) => (
                    <div key={s.key} style={S.pipelineStep}>
                      <div style={S.pipelineStepHead}>
                        <div className="eyebrow" style={S.pipelineStepLabel}>{s.label}</div>
                        <div className="display-numeric" style={S.pipelineStepValue}>{fmtInt(s.value)}</div>
                        <div style={S.pipelineStepCaption}>{s.caption}</div>
                      </div>
                      <div style={S.pipelineStepBarTrack}>
                        <div style={{
                          ...S.pipelineStepBarFill,
                          width: `${(s.value / s.max) * 100}%`,
                          background: i === pipelineStages.length - 1 ? 'var(--dawn-gold)' : 'var(--sky-azure)',
                        }} />
                      </div>
                      {s.drop != null && s.drop > 0 && (
                        <div style={S.pipelineStepDrop}>
                          − {fmtInt(s.drop)} dropped{' '}
                          <span style={{ color: 'var(--cloud-mute)' }}>
                            ({s.dropPct.toFixed(1)}%)
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Tier>

          {/* ─── TIER 4 — Closing-line decomposition ───────────── */}
          {showAttribution && (
            <Tier
              ordinal="tier four"
              title="Closing-line decomposition · per contract"
              statusTone={verdict.stage_attribution.tone}
              statusLabel={verdict.stage_attribution.label}
            >
              <div style={S.tileRow4}>
                <Tile
                  eyebrow="contracts attributed"
                  value={fmtInt(attributionTotals.n_contracts)}
                  sub={`${fmtInt(attributionTotals.n_trades)} trades`}
                />
                <Tile
                  eyebrow="closing-line edge"
                  value={fmtCents(attributionTotals.mean_edge)}
                  sub="¢ / contract"
                  tone={attributionTotals.mean_edge > 0 ? 'positive'
                      : attributionTotals.mean_edge < 0 ? 'negative' : 'neutral'}
                />
                <Tile
                  eyebrow="frictions"
                  value={fmtCents(-(Math.abs(attributionTotals.mean_fees) + Math.abs(attributionTotals.mean_slippage)))}
                  sub="¢ / contract · fees + slip"
                  tone="negative"
                />
                <Tile
                  eyebrow="net realized"
                  value={fmtCents(attributionTotals.mean_realized)}
                  sub="¢ / contract"
                  tone={attributionTotals.mean_realized > 0 ? 'positive'
                      : attributionTotals.mean_realized < 0 ? 'negative' : 'neutral'}
                />
              </div>

              <div style={S.chartCard}>
                <ResponsiveContainer width="100%" height={Math.max(280, byMarketType.length * 76)}>
                  <BarChart data={waterfallData} margin={{ top: 12, right: 24, bottom: 12, left: 0 }}>
                    <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
                    <XAxis dataKey="market_type"
                      tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--cloud-haze)' }}
                      stroke="var(--rule-mid)" />
                    <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' }}
                      stroke="var(--rule-mid)"
                      label={{
                        value: '¢ / contract',
                        angle: -90, position: 'insideLeft',
                        style: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--cloud-mute)' },
                      }} />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--ink-deep)',
                        border: '1px solid var(--rule-mid)',
                        borderRadius: 4,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                      }}
                      formatter={(v) => (typeof v === 'number' ? `${v.toFixed(2)}¢` : v)}
                    />
                    <ReferenceLine y={0} stroke="var(--cloud-mute)" />
                    <Bar dataKey="edge"     name="Edge"     fill="var(--dawn-gold)"    stackId="a" isAnimationActive={false} />
                    <Bar dataKey="fees"     name="Fees"     fill="var(--storm-deep)"   stackId="a" isAnimationActive={false} />
                    <Bar dataKey="slippage" name="Slippage" fill="var(--storm-violet)" stackId="a" isAnimationActive={false} />
                    <Bar dataKey="realized" name="Realized" fill="var(--cloud-haze)"   stackId="b" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={S.legend}>
                  <LegendDot color="var(--dawn-gold)"    label="closing-line edge" />
                  <LegendDot color="var(--storm-deep)"   label="fees" />
                  <LegendDot color="var(--storm-violet)" label="slippage" />
                  <LegendDot color="var(--cloud-haze)"   label="realized P&L" />
                </div>
              </div>

              <div style={S.tableCard}>
                <table style={S.table}>
                  <thead>
                    <tr style={S.theadRow}>
                      <th style={S.thLeft}>Market</th>
                      <th style={S.thRight}>n trades</th>
                      <th style={S.thRight}>n contracts</th>
                      <th style={S.thRight}>edge ¢</th>
                      <th style={S.thRight}>variance ¢</th>
                      <th style={S.thRight}>fees ¢</th>
                      <th style={S.thRight}>slippage ¢</th>
                      <th style={S.thRight}>realized ¢</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byMarketType.map((b, i) => (
                      <tr key={i} style={S.tbodyRow}>
                        <td style={S.tdLeft}>{b.market_type.toUpperCase()}</td>
                        <td style={S.tdRight}>{fmtInt(b.n_trades)}</td>
                        <td style={S.tdRight}>{fmtInt(b.n_contracts)}</td>
                        <td style={{ ...S.tdRight, color: b.edge > 0 ? 'var(--dawn-gold)' : 'var(--cloud-haze)' }}>{fmtCents(b.edge)}</td>
                        <td style={S.tdRight}>{fmtCents(b.variance)}</td>
                        <td style={{ ...S.tdRight, color: 'var(--storm-deep)' }}>{fmtCents(-Math.abs(b.fees))}</td>
                        <td style={{ ...S.tdRight, color: 'var(--storm-violet)' }}>{fmtCents(-Math.abs(b.slippage))}</td>
                        <td style={{
                          ...S.tdRight,
                          color: b.realized > 0 ? 'var(--dawn-gold)'
                               : b.realized < 0 ? 'var(--storm-violet)'
                               : 'var(--cloud-pearl)',
                          fontWeight: 600,
                        }}>
                          {fmtCents(b.realized)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Tier>
          )}

          <div style={S.footnote}>
            Tier one is settler-truth: did the trade win, and what did the books pay?
            Tier two is the data-quality gate — the closing-line capture rate that feeds
            tier four.  Tier three shows where rows drop between the two.  Tier four
            decomposes per-contract realized P&L into closing-line edge, variance, fees,
            and slippage.  When tier-one realized P&L diverges from tier-four edge,
            you&rsquo;re either being lucky or the model is finding inefficiency the
            closing line doesn&rsquo;t see.
          </div>
        </>
      )}
    </SectionFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Verdict
// ─────────────────────────────────────────────────────────────────────
function Verdict({ verdict, totals, coverageAgg }) {
  const captureRate = coverageAgg.recentRate != null ? coverageAgg.recentRate : coverageAgg.completeRate;
  return (
    <div style={{ ...S.verdictCard, borderColor: verdict.tone.border, background: verdict.tone.bg }}>
      <div style={S.verdictInner}>
        <div style={S.verdictLabelBlock}>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>Pipeline verdict</div>
          <span style={{
            ...S.verdictBadge,
            color: verdict.tone.fg,
            borderColor: verdict.tone.border,
            background: verdict.tone.bg,
          }}>
            {verdict.label}
          </span>
          <div style={S.verdictNarrative}>
            {fmtInt(totals.n_settled)} settled trades · realized
            {' '}<em style={{ color: verdict.tone.fg }}>{fmtUSD(totals.pnl_net)}</em>
            {totals.size > 0 && (
              <span style={{ color: 'var(--cloud-mute)' }}>
                {' '}({(totals.roi * 100).toFixed(1)}% ROI)
              </span>
            )}
            {captureRate != null && (
              <span style={{ color: 'var(--cloud-mute)' }}>
                {' · '}closing line captured {pct(captureRate)}
                {coverageAgg.recentRate != null ? ' last 7d' : ' all-time'}
              </span>
            )}
          </div>
        </div>
        <div style={S.verdictNumberBlock}>
          <div className="display-numeric" style={{ ...S.verdictNumber, color: verdict.tone.fg }}>
            {fmtUSD(totals.pnl_net)}
          </div>
          <div style={S.verdictNumberSub}>net P&L</div>
        </div>
      </div>
    </div>
  );
}

function buildVerdict({ realizedTotals, coverageAgg }) {
  const pnl = realizedTotals.pnl_net;
  const recent = coverageAgg.recentRate;
  const allTime = coverageAgg.completeRate;
  const cap = recent != null ? recent : allTime;

  const stage_realized = pnl > 0
    ? { tone: TONES.ok, label: 'profitable' }
    : pnl < 0
        ? { tone: TONES.regressing, label: 'drawdown' }
        : { tone: TONES.neutral, label: 'breakeven' };

  const stage_capture = cap == null
    ? { tone: TONES.unknown, label: 'no data' }
    : cap >= 0.95
        ? { tone: TONES.ok, label: 'healthy' }
        : cap >= 0.85
            ? { tone: TONES.watching, label: 'attention' }
            : { tone: TONES.regressing, label: 'degraded' };

  const stage_pipeline = { tone: TONES.ok, label: 'ok' }; // Default; refined below
  const stage_attribution = { tone: TONES.ok, label: 'attributed' };

  // Overall = worst of realized & capture (pipeline/attribution are
  // diagnostic rather than failure modes).
  const ranks = { ok: 3, watching: 2, regressing: 1, neutral: 3, unknown: 3 };
  const worst = [stage_realized, stage_capture].reduce((w, s) => {
    const sk = ranks[labelToKey(s)];
    const wk = ranks[labelToKey(w)];
    return sk < wk ? s : w;
  }, { tone: TONES.ok });

  const wkey = labelToKey(worst);
  const overall =
    wkey === 'ok'         ? (pnl > 0 ? 'EARNING' : 'OK')
    : wkey === 'watching' ? 'WATCHING'
    : wkey === 'regressing' ? (pnl < 0 ? 'DRAWDOWN' : 'CAPTURE DEGRADED')
    : 'OK';

  return {
    label: overall,
    tone: worst.tone,
    stage_realized,
    stage_capture,
    stage_pipeline,
    stage_attribution,
  };
}

function labelToKey(stage) {
  if (stage.tone === TONES.ok)         return 'ok';
  if (stage.tone === TONES.watching)   return 'watching';
  if (stage.tone === TONES.regressing) return 'regressing';
  if (stage.tone === TONES.neutral)    return 'neutral';
  return 'unknown';
}

const TONES = {
  ok:         { fg: 'var(--dawn-gold)',    bg: 'rgba(212, 164, 74, 0.08)',  border: 'rgba(212, 164, 74, 0.30)' },
  watching:   { fg: 'var(--dawn-amber)',   bg: 'rgba(184, 133, 58, 0.10)',  border: 'rgba(184, 133, 58, 0.30)' },
  regressing: { fg: 'var(--storm-violet)', bg: 'var(--storm-haze)',          border: 'rgba(107, 77, 142, 0.40)' },
  neutral:    { fg: 'var(--cloud-pearl)',  bg: 'rgba(245, 241, 232, 0.04)',  border: 'rgba(245, 241, 232, 0.10)' },
  unknown:    { fg: 'var(--cloud-shade)',  bg: 'rgba(245, 241, 232, 0.04)',  border: 'rgba(245, 241, 232, 0.10)' },
};

// ─────────────────────────────────────────────────────────────────────
// Tier wrapper
// ─────────────────────────────────────────────────────────────────────
function Tier({ ordinal, title, statusTone, statusLabel, meta, children }) {
  return (
    <div style={S.tierOuter}>
      <div style={S.tierHeader}>
        <div>
          <div className="eyebrow" style={S.tierEyebrow}>{ordinal}</div>
          <div style={S.tierTitle}>{title}</div>
          {meta && <div style={S.tierMeta}>{meta}</div>}
        </div>
        <span style={{
          ...S.tierStatus,
          color: statusTone.fg,
          background: statusTone.bg,
          borderColor: statusTone.border,
        }}>
          {statusLabel}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-market split card (tier 1)
// ─────────────────────────────────────────────────────────────────────
function MarketSplit({ bucket }) {
  const decisive = bucket.n_won + bucket.n_lost;
  const win_rate = decisive > 0 ? bucket.n_won / decisive : null;
  const roi      = bucket.size > 0 ? bucket.pnl_net / bucket.size : 0;
  return (
    <div style={S.splitCard}>
      <div style={S.splitMarket}>{bucket.market_type.toUpperCase()}</div>
      <div style={S.splitMain}>
        <div style={{
          ...S.splitPnl,
          color: bucket.pnl_net > 0 ? 'var(--dawn-gold)'
               : bucket.pnl_net < 0 ? 'var(--storm-violet)'
               : 'var(--cloud-pearl)',
        }}>
          {fmtUSD(bucket.pnl_net)}
        </div>
        <div style={S.splitRoi}>
          {bucket.size > 0 ? `${(roi * 100).toFixed(1)}% ROI` : '—'}
        </div>
      </div>
      <div style={S.splitFooter}>
        <span style={{ color: 'var(--dawn-gold)' }}>{bucket.n_won}W</span>
        {' / '}
        <span style={{ color: 'var(--storm-violet)' }}>{bucket.n_lost}L</span>
        {win_rate != null && (
          <span style={S.splitWinRate}> · {(win_rate * 100).toFixed(1)}%</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tiny shared primitives
// ─────────────────────────────────────────────────────────────────────
function Tile({ eyebrow, value, sub, tone = 'neutral' }) {
  const valueColor =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'warning' ? 'var(--dawn-amber)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{eyebrow}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color: valueColor }}>{value}</div>
      {sub && <div style={S.tileSub}>{sub}</div>}
    </div>
  );
}

function Stub({ message }) {
  return <div style={S.stub}>{message}</div>;
}

function EmptyState() {
  return (
    <div style={S.empty}>
      <div style={S.emptyTitle}>No edge to attribute yet</div>
      <div style={S.emptySub}>
        Settled trades, closing-line snapshots, and the attribution pipeline are all
        empty.  Confirm the settler and the closing-line scheduler are running.
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={S.legendItem}>
      <span style={{ width: 10, height: 10, background: color, display: 'inline-block', borderRadius: 1 }} />
      {label}
    </span>
  );
}

function CoverageTooltip({ active, payload, label, marketTypes }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={S.tooltipBox}>
      <div style={S.tooltipHeader}>{label}</div>
      {marketTypes.map((mt) => {
        const row = payload[0]?.payload;
        if (!row) return null;
        const rate = row[mt];
        const captured = row[`${mt}__captured`];
        const missed = row[`${mt}__missed`];
        const eligible = row[`${mt}__eligible`];
        if (rate == null && !captured && !missed) return null;
        return (
          <div key={mt} style={S.tooltipRow}>
            <span style={S.tooltipLabel}>{mt}</span>
            <span style={{ ...S.tooltipValue, color: seriesColor(mt) }}>
              {rate != null ? `${(rate * 100).toFixed(1)}%` : '—'}
              {' '}
              <span style={{ color: 'var(--cloud-mute)' }}>
                ({captured}/{eligible})
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function seriesColor(mt) {
  if (mt === 'high')  return 'var(--dawn-gold)';
  if (mt === 'low')   return 'var(--sky-azure)';
  if (mt === 'rainm') return 'var(--storm-violet)';
  return 'var(--cloud-mute)';
}

// ─────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────
function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtUSD(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (n === 0) return '$0.00';
  const sign = n > 0 ? '+' : '−';
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return `${sign}$${abs.toFixed(2)}`;
}
function fmtCents(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${Math.abs(v).toFixed(2)}¢`;
}
function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function daysBeforeISO(isoDate, daysBack) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const S = {
  // ── Verdict ───────────────────────────────────────────────────
  verdictCard: {
    border: '1px solid',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    marginBottom: 'var(--space-5)',
    transition: 'all var(--motion-glide)',
  },
  verdictInner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 'var(--space-6)',
    flexWrap: 'wrap',
  },
  verdictLabelBlock: {
    flex: '1 1 320px',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  verdictBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    border: '1px solid',
    borderRadius: 'var(--radius-pill)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    width: 'fit-content',
  },
  verdictNarrative: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-base)',
    color: 'var(--cloud-haze)',
    lineHeight: 1.5,
    fontStyle: 'italic',
    maxWidth: '64ch',
  },
  verdictNumberBlock: {
    textAlign: 'right',
    flexShrink: 0,
  },
  verdictNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-oracle)',
    fontWeight: 500,
    lineHeight: 0.95,
    letterSpacing: '-0.02em',
  },
  verdictNumberSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    marginTop: 'var(--space-2)',
  },

  // ── Tier wrapper ──────────────────────────────────────────────
  tierOuter: { marginBottom: 'var(--space-6)' },
  tierHeader: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
    borderBottom: '1px solid var(--rule-faint)',
    gap: 'var(--space-4)',
  },
  tierEyebrow: { color: 'var(--cloud-mute)', marginBottom: 'var(--space-1)' },
  tierTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
  tierMeta: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-1)',
  },
  tierStatus: {
    display: 'inline-block',
    padding: '3px 10px',
    border: '1px solid',
    borderRadius: 'var(--radius-pill)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    fontWeight: 600,
    letterSpacing: '0.10em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },

  // ── KPI tile row ─────────────────────────────────────────────
  tileRow4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  tile: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    minHeight: 104,
  },
  tileValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-display)',
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: '-0.01em',
  },
  tileSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.02em',
  },

  // ── Per-market split (tier 1) ────────────────────────────────
  marketStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-3)',
  },
  splitCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-4)',
  },
  splitMarket: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 'var(--space-1)',
  },
  splitMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 'var(--space-1)',
  },
  splitPnl: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    fontSize: 'var(--type-large)',
  },
  splitRoi: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
  },
  splitFooter: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
  },
  splitWinRate: { color: 'var(--cloud-haze)' },

  // ── Chart card ───────────────────────────────────────────────
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-4)',
    marginTop: 'var(--space-3)',
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--rule-faint)',
  },
  legendItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },

  // ── Pipeline funnel (tier 3) ─────────────────────────────────
  pipelineCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
  },
  pipelineFunnel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },
  pipelineStep: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  pipelineStepHead: {
    display: 'grid',
    gridTemplateColumns: '120px 100px 1fr',
    gap: 'var(--space-3)',
    alignItems: 'baseline',
  },
  pipelineStepLabel: { color: 'var(--cloud-mute)' },
  pipelineStepValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
  },
  pipelineStepCaption: {
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
  },
  pipelineStepBarTrack: {
    height: 6,
    background: 'var(--ink-mid)',
    borderRadius: 'var(--radius-pill)',
    overflow: 'hidden',
  },
  pipelineStepBarFill: {
    height: '100%',
    transition: 'width var(--motion-glide)',
  },
  pipelineStepDrop: {
    fontSize: 'var(--type-micro)',
    color: 'var(--storm-violet)',
    fontFamily: 'var(--font-mono)',
    paddingLeft: 132,
  },

  // ── Decomposition table (tier 4) ─────────────────────────────
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
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
    textAlign: 'left', padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-mute)', fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.10em',
  },
  thRight: {
    textAlign: 'right', padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-mute)', fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.10em',
  },
  tbodyRow: { borderBottom: '1px solid var(--rule-faint)' },
  tdLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-pearl)',
    fontVariantNumeric: 'tabular-nums',
  },
  tdRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-haze)',
    fontVariantNumeric: 'tabular-nums',
  },

  // ── Tooltip ───────────────────────────────────────────────────
  tooltipBox: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 4,
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--cloud-pearl)',
    minWidth: 200,
    boxShadow: 'var(--shadow-card)',
  },
  tooltipHeader: {
    fontWeight: 600,
    letterSpacing: '0.06em',
    paddingBottom: 'var(--space-2)',
    marginBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--rule-faint)',
    color: 'var(--cloud-haze)',
    textTransform: 'uppercase',
  },
  tooltipRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    lineHeight: 1.6,
  },
  tooltipLabel: {
    color: 'var(--cloud-mute)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontSize: 10,
  },
  tooltipValue: { fontVariantNumeric: 'tabular-nums' },

  // ── Stub / Empty ─────────────────────────────────────────────
  stub: {
    padding: 'var(--space-5)',
    textAlign: 'center',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    lineHeight: 1.6,
  },
  empty: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-7)',
    textAlign: 'center',
  },
  emptyTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-haze)',
    marginBottom: 'var(--space-2)',
  },
  emptySub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '46ch',
    lineHeight: 1.6,
    margin: '0 auto',
  },

  // ── Footnote ──────────────────────────────────────────────────
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '78ch',
    lineHeight: 1.7,
    marginTop: 'var(--space-4)',
  },
};
