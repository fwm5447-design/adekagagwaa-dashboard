'use client';

import { useMemo } from 'react';
import {
  ComposedChart, Line, Scatter, BarChart, Bar, Cell,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * Oracle — calibration reliability surface (bet-side aware).
 *
 * Reads analytics.mv_calibration_buckets_win (mig 027), which buckets
 * trades by predicted P(THE TRADE WINNING) per bet_side rather than
 * predicted P(YES winning).  A confident NO bet at our_prob_cal=0.04
 * lands at predicted_mean ~0.96 (top decile), so "predicted vs
 * empirical" reads correctly on either side.
 *
 * Hierarchy of answers, top-to-bottom:
 *
 *   1. VERDICT — one-line headline.  Is the bot calibrated?  By how
 *      much, in which direction, over how many trades?
 *
 *   2. BREAKDOWN — four tiles partitioning the gap by bet_side and
 *      market_type so you can see where the miscalibration is
 *      concentrated at a glance.
 *
 *   3. RELIABILITY CURVE — predicted (x) vs empirical (y) per decile,
 *      one line per bet_side.  Identity diagonal is perfect
 *      calibration; distance below the line = overconfident.
 *
 *   4. GAP BY DECILE — horizontal divergent bars showing
 *      (empirical − predicted) for each decile, split YES/NO.  The
 *      operational view: which deciles are the worst offenders.
 *
 *   5. DECILE DETAIL — two side-by-side tables (YES / NO) with the
 *      raw per-decile numbers.
 *
 * Color convention:
 *   YES bets        → dawn-gold
 *   NO bets         → storm-violet
 *   identity / good → cloud-mute / dawn-gold dashed
 *   severe gap      → coral-flare (only when |gap| ≥ 0.20)
 */
export default function Oracle({ rows = [], freshness }) {
  // ── Aggregations ─────────────────────────────────────────────────
  const overall = useMemo(() => weightedGap(rows), [rows]);

  const byBetSide = useMemo(() => ({
    YES: weightedGap(rows.filter((r) => r.bet_side === 'YES')),
    NO:  weightedGap(rows.filter((r) => r.bet_side === 'NO')),
  }), [rows]);

  const byMarketType = useMemo(() => {
    const present = Array.from(new Set(rows.map((r) => r.market_type).filter(Boolean)));
    const out = {};
    for (const mt of present) {
      out[mt] = weightedGap(rows.filter((r) => r.market_type === mt));
    }
    return out;
  }, [rows]);

  // Reliability curve — one line per bet_side, deciles 1-10.
  // For each decile, sample-weighted mean predicted and empirical
  // across all (day, market_type) cells in that decile/side.
  const reliabilityCurve = useMemo(() => {
    const build = (side) => {
      const sideRows = rows.filter((r) => r.bet_side === side);
      const buckets = new Map();
      for (const r of sideRows) {
        const d = r.prob_decile;
        const n = Number(r.n_trades) || 0;
        const pred = Number(r.predicted_mean);
        const emp = Number(r.empirical_mean);
        if (!Number.isFinite(d) || n === 0) continue;
        const cur = buckets.get(d) ?? { d, n: 0, predN: 0, empN: 0 };
        cur.n += n;
        if (Number.isFinite(pred)) cur.predN += n * pred;
        if (Number.isFinite(emp))  cur.empN  += n * emp;
        buckets.set(d, cur);
      }
      return Array.from(buckets.values())
        .map((b) => ({
          decile: b.d,
          predicted: b.n > 0 ? b.predN / b.n : null,
          empirical: b.n > 0 ? b.empN  / b.n : null,
          n_trades: b.n,
          side,
        }))
        .filter((p) => p.predicted != null && p.empirical != null)
        .sort((a, b) => a.predicted - b.predicted);
    };
    return { YES: build('YES'), NO: build('NO') };
  }, [rows]);

  // Gap-by-decile data for the divergent bar chart.  Two series (YES
  // and NO) on the same decile axis, gap = empirical - predicted.
  const gapByDecile = useMemo(() => {
    const out = new Map();   // decile → { decile, yes_gap, no_gap, yes_n, no_n }
    for (const d of [1,2,3,4,5,6,7,8,9,10]) {
      out.set(d, { decile: d, yes_gap: null, no_gap: null, yes_n: 0, no_n: 0 });
    }
    for (const p of reliabilityCurve.YES) {
      const row = out.get(p.decile);
      if (row) { row.yes_gap = p.empirical - p.predicted; row.yes_n = p.n_trades; }
    }
    for (const p of reliabilityCurve.NO) {
      const row = out.get(p.decile);
      if (row) { row.no_gap = p.empirical - p.predicted; row.no_n = p.n_trades; }
    }
    return Array.from(out.values()).filter((r) => r.yes_gap != null || r.no_gap != null);
  }, [reliabilityCurve]);

  const decileRollupYes = useMemo(() => decileRollup(rows.filter((r) => r.bet_side === 'YES')), [rows]);
  const decileRollupNo  = useMemo(() => decileRollup(rows.filter((r) => r.bet_side === 'NO')),  [rows]);

  const hasData = (overall?.n ?? 0) > 0;

  return (
    <SectionFrame
      id="oracle"
      invocation="Oracular Calibration"
      title="The Oracle"
      subtitle="Confidence we ship vs confidence the world delivers.  Predicted P(win) on the x-axis is what the model thought; empirical P(win) on the y-axis is what actually happened.  A calibrated bot rides the diagonal."
      freshnessAt={freshness}
      freshnessCadenceSec={86400 /* daily refresh */}
    >
      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* ── 1. Verdict ─────────────────────────────────────────── */}
          <Verdict overall={overall} />

          {/* ── 2. Breakdown tiles ─────────────────────────────────── */}
          <div style={S.tileGrid}>
            <SliceTile
              eyebrow="YES bets"
              gap={byBetSide.YES?.div}
              n={byBetSide.YES?.n}
              predW={byBetSide.YES?.predW}
              empW={byBetSide.YES?.empW}
              accent="var(--dawn-gold)"
            />
            <SliceTile
              eyebrow="NO bets"
              gap={byBetSide.NO?.div}
              n={byBetSide.NO?.n}
              predW={byBetSide.NO?.predW}
              empW={byBetSide.NO?.empW}
              accent="var(--storm-violet)"
            />
            {Object.entries(byMarketType).sort().map(([mt, agg]) => (
              <SliceTile
                key={mt}
                eyebrow={`${mt.toUpperCase()} markets`}
                gap={agg?.div}
                n={agg?.n}
                predW={agg?.predW}
                empW={agg?.empW}
                accent="var(--sky-azure)"
              />
            ))}
          </div>

          {/* ── 3. Reliability curve ───────────────────────────────── */}
          <div style={S.chartCard}>
            <div style={S.chartHeader}>
              <div className="eyebrow">Reliability — predicted vs empirical P(win)</div>
              <div style={S.legend}>
                <LegendKey color="var(--dawn-gold)"    label="YES bets" />
                <LegendKey color="var(--storm-violet)" label="NO bets" />
                <LegendKey color="var(--cloud-mute)"   label="perfect calibration" dashed />
              </div>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart margin={{ top: 12, right: 24, bottom: 32, left: 24 }}>
                <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
                <XAxis
                  type="number"
                  dataKey="predicted"
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1.0]}
                  tickFormatter={(v) => v.toFixed(2)}
                  tick={S.axisTick}
                  stroke="var(--rule-mid)"
                  label={{
                    value: 'PREDICTED P(WIN)',
                    position: 'insideBottom',
                    offset: -12,
                    style: S.axisLabel,
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="empirical"
                  domain={[0, 1]}
                  ticks={[0, 0.25, 0.5, 0.75, 1.0]}
                  tickFormatter={(v) => v.toFixed(2)}
                  tick={S.axisTick}
                  stroke="var(--rule-mid)"
                  label={{
                    value: 'EMPIRICAL P(WIN)',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 8,
                    style: S.axisLabel,
                  }}
                />
                <ZAxis dataKey="n_trades" range={[40, 360]} />
                <Tooltip
                  cursor={{ stroke: 'var(--rule-strong)', strokeDasharray: '3 3' }}
                  content={<ReliabilityTooltip />}
                />
                {/* identity diagonal — perfect calibration */}
                <ReferenceLine
                  segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                  stroke="var(--cloud-mute)"
                  strokeDasharray="4 6"
                  strokeWidth={1.2}
                  ifOverflow="extendDomain"
                />
                <Line
                  data={reliabilityCurve.YES}
                  type="monotone"
                  dataKey="empirical"
                  stroke="var(--dawn-gold)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name="YES"
                />
                <Line
                  data={reliabilityCurve.NO}
                  type="monotone"
                  dataKey="empirical"
                  stroke="var(--storm-violet)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name="NO"
                />
                <Scatter
                  data={reliabilityCurve.YES}
                  fill="var(--dawn-gold)"
                  fillOpacity={0.85}
                  stroke="var(--ink-deep)"
                  strokeWidth={1}
                  isAnimationActive={false}
                  name="YES"
                />
                <Scatter
                  data={reliabilityCurve.NO}
                  fill="var(--storm-violet)"
                  fillOpacity={0.85}
                  stroke="var(--ink-deep)"
                  strokeWidth={1}
                  isAnimationActive={false}
                  name="NO"
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={S.chartFootnote}>
              Bubble size scales with trade count in each decile.
              Points <em>below</em> the diagonal are overconfident
              (we predicted higher win-rate than the market delivered).
            </div>
          </div>

          {/* ── 4. Gap by decile ───────────────────────────────────── */}
          <div style={S.chartCard}>
            <div style={S.chartHeader}>
              <div className="eyebrow">Gap by decile — empirical minus predicted</div>
              <div style={S.legend}>
                <LegendKey color="var(--dawn-gold)"    label="YES" square />
                <LegendKey color="var(--storm-violet)" label="NO"  square />
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={gapByDecile}
                layout="vertical"
                margin={{ top: 8, right: 24, bottom: 24, left: 16 }}
                barGap={2}
                barCategoryGap={6}
              >
                <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" />
                <XAxis
                  type="number"
                  domain={[-0.4, 0.4]}
                  ticks={[-0.4, -0.2, 0, 0.2, 0.4]}
                  tickFormatter={(v) => fmtPp(v, false)}
                  tick={S.axisTick}
                  stroke="var(--rule-mid)"
                  label={{
                    value: 'GAP (PERCENTAGE POINTS)',
                    position: 'insideBottom',
                    offset: -8,
                    style: S.axisLabel,
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="decile"
                  tickFormatter={(v) => `D${v}`}
                  tick={S.axisTick}
                  stroke="var(--rule-mid)"
                  width={36}
                />
                <Tooltip
                  cursor={{ fill: 'var(--rule-faint)' }}
                  content={<GapTooltip />}
                />
                <ReferenceLine x={0} stroke="var(--rule-strong)" strokeWidth={1} />
                <Bar dataKey="yes_gap" name="YES" isAnimationActive={false}>
                  {gapByDecile.map((entry, i) => (
                    <Cell key={`y-${i}`} fill={gapBarColor(entry.yes_gap, 'YES')} />
                  ))}
                </Bar>
                <Bar dataKey="no_gap" name="NO" isAnimationActive={false}>
                  {gapByDecile.map((entry, i) => (
                    <Cell key={`n-${i}`} fill={gapBarColor(entry.no_gap, 'NO')} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={S.chartFootnote}>
              D1 is the lowest-confidence decile we still bet (predicted P(win) ≈ 0.1);
              D10 is highest (predicted P(win) ≈ 0.95).  Bars to the left mean we won
              less often than predicted (overconfident); to the right, we won more
              often (underconfident).
            </div>
          </div>

          {/* ── 5. Decile detail tables ────────────────────────────── */}
          <div style={S.tableGrid}>
            <DecileTable title="YES bets · last 30 days"  rows={decileRollupYes} accent="var(--dawn-gold)" />
            <DecileTable title="NO bets · last 30 days"   rows={decileRollupNo}  accent="var(--storm-violet)" />
          </div>

          {/* ── Footnote ───────────────────────────────────────────── */}
          <div style={S.footnote}>
            <strong style={{ color: 'var(--cloud-haze)' }}>Calibration</strong> measures whether the
            model&rsquo;s stated confidence matches reality.  A trade marked &ldquo;85% likely to win&rdquo; should win
            ≈85% of the time across many such trades.  A negative gap means the model is
            overconfident; positive means underconfident.  Either direction costs money — overconfidence
            sizes bets too large; underconfidence skips edges.
          </div>
        </>
      )}
    </SectionFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Verdict — the one-line headline answer.
// ─────────────────────────────────────────────────────────────────────
function Verdict({ overall }) {
  if (!overall) return null;
  const gap = overall.div;
  const tone = severityTone(gap);
  const verdict =
    Math.abs(gap) < 0.04 ? 'WELL CALIBRATED' :
    gap < 0 ? 'OVERCONFIDENT' : 'UNDERCONFIDENT';
  const expected = (overall.predW * 100).toFixed(1);
  const actual   = (overall.empW  * 100).toFixed(1);
  return (
    <div style={{ ...S.verdictCard, borderColor: tone.border, background: tone.bg }}>
      <div style={S.verdictInner}>
        <div style={S.verdictLabelBlock}>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>Verdict · last 30 days</div>
          <div style={{ ...S.verdictBadge, color: tone.fg }}>
            <StatusPillForVerdict tone={tone} label={verdict} />
          </div>
          <div style={S.verdictNarrative}>
            Model expected <em style={{ color: 'var(--cloud-haze)' }}>{expected}%</em> win-rate;
            actual <em style={{ color: 'var(--cloud-haze)' }}>{actual}%</em>
            <span style={{ color: 'var(--cloud-mute)' }}> · across {fmtInt(overall.n)} settled trades</span>
          </div>
        </div>
        <div style={S.verdictNumberBlock}>
          <div className="display-numeric" style={{ ...S.verdictNumber, color: tone.fg }}>
            {fmtPp(gap, true)}
          </div>
          <div style={S.verdictNumberSub}>
            percentage points
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPillForVerdict({ tone, label }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.border}`,
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--type-small)',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SliceTile — one of the breakdown tiles.
// ─────────────────────────────────────────────────────────────────────
function SliceTile({ eyebrow, gap, n, predW, empW, accent }) {
  const tone = severityTone(gap);
  const hasData = gap != null && n > 0;
  return (
    <div style={{ ...S.tile, borderLeft: `2px solid ${accent}` }}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{eyebrow}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color: hasData ? tone.fg : 'var(--cloud-shade)' }}>
        {hasData ? fmtPp(gap, true) : '—'}
      </div>
      <div style={S.tileSub}>
        {hasData
          ? `n=${fmtInt(n)} · ${(predW * 100).toFixed(0)}% pred / ${(empW * 100).toFixed(0)}% real`
          : 'no settled trades'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Decile detail table — kept from the original but redesigned.
// ─────────────────────────────────────────────────────────────────────
function DecileTable({ title, rows, accent }) {
  return (
    <div style={S.tableCard}>
      <div style={{ ...S.tableHeader, borderTopColor: accent }}>
        <div className="eyebrow" style={{ color: 'var(--cloud-haze)' }}>{title}</div>
      </div>
      <table style={S.table}>
        <thead>
          <tr style={S.theadRow}>
            <th style={S.thLeft}>D</th>
            <th style={S.thRight}>n</th>
            <th style={S.thRight}>predicted</th>
            <th style={S.thRight}>actual</th>
            <th style={S.thRight}>gap</th>
            <th style={S.thRight}>CRPS</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={6} style={S.tdEmpty}>No settled trades on this side.</td></tr>
          )}
          {rows.map((b) => {
            const tone = severityTone(b.gap);
            return (
              <tr key={b.decile} style={S.tbodyRow}>
                <td style={S.tdLeft}>D{b.decile}</td>
                <td style={S.tdRight}>{fmtInt(b.n_trades)}</td>
                <td style={S.tdRight}>{b.predicted == null ? '—' : b.predicted.toFixed(3)}</td>
                <td style={S.tdRight}>{b.empirical == null ? '—' : b.empirical.toFixed(3)}</td>
                <td style={{ ...S.tdRight, color: tone.fg, fontWeight: 600 }}>
                  {b.gap == null ? '—' : fmtPp(b.gap, true)}
                </td>
                <td style={S.tdRight}>{b.mean_crps == null ? '—' : b.mean_crps.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tooltips
// ─────────────────────────────────────────────────────────────────────
function ReliabilityTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const accent = p.side === 'YES' ? 'var(--dawn-gold)' : 'var(--storm-violet)';
  const gap = p.empirical - p.predicted;
  return (
    <div style={S.tooltipBox}>
      <div style={{ ...S.tooltipHeader, color: accent }}>
        {p.side} bets · D{p.decile}
      </div>
      <TooltipRow label="predicted" value={p.predicted.toFixed(3)} />
      <TooltipRow label="actual"    value={p.empirical.toFixed(3)} />
      <TooltipRow label="gap"       value={fmtPp(gap, true)} valueColor={severityTone(gap).fg} />
      <TooltipRow label="n trades"  value={fmtInt(p.n_trades)} />
    </div>
  );
}

function GapTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={S.tooltipBox}>
      <div style={{ ...S.tooltipHeader, color: 'var(--cloud-haze)' }}>
        Decile D{row.decile}
      </div>
      {row.yes_gap != null && (
        <TooltipRow
          label="YES"
          value={`${fmtPp(row.yes_gap, true)} · n=${fmtInt(row.yes_n)}`}
          valueColor="var(--dawn-gold)"
        />
      )}
      {row.no_gap != null && (
        <TooltipRow
          label="NO"
          value={`${fmtPp(row.no_gap, true)} · n=${fmtInt(row.no_n)}`}
          valueColor="var(--storm-violet)"
        />
      )}
    </div>
  );
}

function TooltipRow({ label, value, valueColor }) {
  return (
    <div style={S.tooltipRow}>
      <span style={S.tooltipLabel}>{label}</span>
      <span style={{ ...S.tooltipValue, color: valueColor ?? 'var(--cloud-pearl)' }}>{value}</span>
    </div>
  );
}

function LegendKey({ color, label, dashed, square }) {
  return (
    <span style={S.legendItem}>
      {dashed ? (
        <span style={{
          display: 'inline-block', width: 14, height: 0,
          borderTop: `1.5px dashed ${color}`,
        }} />
      ) : square ? (
        <span style={{
          display: 'inline-block', width: 10, height: 10,
          background: color, borderRadius: 1,
        }} />
      ) : (
        <span style={{
          display: 'inline-block', width: 10, height: 10,
          background: color, borderRadius: '50%',
        }} />
      )}
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div style={S.empty}>
      <div style={S.emptyTitle}>The oracle awaits offerings</div>
      <div style={S.emptySub}>
        No settled trades in the last 30 days.  The calibration view will populate
        as the bot&rsquo;s predictions are tested against settlement.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function weightedGap(rs) {
  let n = 0, pN = 0, eN = 0;
  for (const r of rs) {
    const c = Number(r.n_trades) || 0;
    const p = Number(r.predicted_mean);
    const e = Number(r.empirical_mean);
    if (c > 0 && Number.isFinite(p) && Number.isFinite(e)) {
      n  += c;
      pN += c * p;
      eN += c * e;
    }
  }
  if (n === 0) return null;
  const predW = pN / n;
  const empW  = eN / n;
  return { n, predW, empW, div: empW - predW };
}

function decileRollup(rs) {
  const buckets = new Map();
  for (const r of rs) {
    const d = r.prob_decile;
    const c = Number(r.n_trades) || 0;
    const p = Number(r.predicted_mean);
    const e = Number(r.empirical_mean);
    const k = Number(r.mean_crps_cal);
    if (!Number.isFinite(d) || c === 0) continue;
    const cur = buckets.get(d) ?? { d, n: 0, predN: 0, empN: 0, crpsN: 0 };
    cur.n += c;
    if (Number.isFinite(p)) cur.predN += c * p;
    if (Number.isFinite(e)) cur.empN  += c * e;
    if (Number.isFinite(k)) cur.crpsN += c * k;
    buckets.set(d, cur);
  }
  return Array.from(buckets.values())
    .sort((a, b) => a.d - b.d)
    .map((b) => ({
      decile: b.d,
      n_trades: b.n,
      predicted: b.predN / b.n,
      empirical: b.empN  / b.n,
      gap:       (b.empN - b.predN) / b.n,
      mean_crps: b.crpsN ? b.crpsN / b.n : null,
    }));
}

// Tone selector for calibration gap magnitude.  Reasonable thresholds:
// < 4pp is well-calibrated.  4-10pp is mildly off (amber).  10-20pp is
// significant (storm-violet).  ≥ 20pp escalates to coral-flare.
function severityTone(gap) {
  if (gap == null || !Number.isFinite(gap)) {
    return {
      fg: 'var(--cloud-shade)',
      bg: 'rgba(245, 241, 232, 0.04)',
      border: 'rgba(245, 241, 232, 0.10)',
    };
  }
  const a = Math.abs(gap);
  if (a < 0.04) return {
    fg: 'var(--dawn-gold)',
    bg: 'rgba(212, 164, 74, 0.08)',
    border: 'rgba(212, 164, 74, 0.30)',
  };
  if (a < 0.10) return {
    fg: 'var(--dawn-amber)',
    bg: 'rgba(184, 133, 58, 0.10)',
    border: 'rgba(184, 133, 58, 0.30)',
  };
  if (a < 0.20) return {
    fg: 'var(--storm-violet)',
    bg: 'var(--storm-haze)',
    border: 'rgba(107, 77, 142, 0.40)',
  };
  return {
    fg: 'var(--coral-flare)',
    bg: 'var(--coral-haze)',
    border: 'rgba(194, 84, 80, 0.40)',
  };
}

// Bar color for the gap-by-decile chart.  Lighter (base) for small
// gaps, deeper for severe.  Side influences the hue family.
function gapBarColor(gap, side) {
  if (gap == null || !Number.isFinite(gap)) return 'var(--cloud-shade)';
  const base = side === 'YES' ? 'var(--dawn-gold)' : 'var(--storm-violet)';
  // For severe gaps, escalate to coral.  Otherwise stay in side hue.
  return Math.abs(gap) >= 0.20 ? 'var(--coral-flare)' : base;
}

function fmtPp(v, withSign) {
  if (v == null || !Number.isFinite(v)) return '—';
  const pp = v * 100;
  const sign = pp > 0 ? '+' : pp < 0 ? '−' : '';
  return withSign
    ? `${sign}${Math.abs(pp).toFixed(1)} pp`
    : `${pp >= 0 ? '+' : '−'}${Math.abs(pp).toFixed(0)}pp`;
}

function fmtInt(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const S = {
  // ── Verdict ────────────────────────────────────────────────────
  verdictCard: {
    border: '1px solid',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5) var(--space-5)',
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
    display: 'flex',
    alignItems: 'center',
  },
  verdictNarrative: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-base)',
    color: 'var(--cloud-haze)',
    lineHeight: 1.5,
    fontStyle: 'italic',
    maxWidth: '52ch',
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

  // ── Slice tiles ────────────────────────────────────────────────
  tileGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-5)',
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

  // ── Chart cards ────────────────────────────────────────────────
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4) var(--space-5) var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-3)',
    flexWrap: 'wrap',
  },
  chartFootnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    lineHeight: 1.55,
    maxWidth: '72ch',
    marginTop: 'var(--space-2)',
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
    flexWrap: 'wrap',
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

  // ── Axes ───────────────────────────────────────────────────────
  axisTick: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fill: 'var(--cloud-mute)',
  },
  axisLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fill: 'var(--cloud-mute)',
    letterSpacing: '0.10em',
  },

  // ── Decile tables ──────────────────────────────────────────────
  tableGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    overflowX: 'auto',
  },
  tableHeader: {
    padding: 'var(--space-3) var(--space-4)',
    borderTop: '2px solid',
    borderBottom: '1px solid var(--rule-faint)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
  },
  theadRow: {
    borderBottom: '1px solid var(--rule-mid)',
  },
  thLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-mute)',
    fontWeight: 500,
    fontSize: 'var(--type-micro)',
    textTransform: 'uppercase',
    letterSpacing: '0.10em',
  },
  thRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-mute)',
    fontWeight: 500,
    fontSize: 'var(--type-micro)',
    textTransform: 'uppercase',
    letterSpacing: '0.10em',
  },
  tbodyRow: {
    borderBottom: '1px solid var(--rule-faint)',
  },
  tdLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-haze)',
    fontVariantNumeric: 'tabular-nums',
  },
  tdRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-4)',
    color: 'var(--cloud-haze)',
    fontVariantNumeric: 'tabular-nums',
  },
  tdEmpty: {
    textAlign: 'center',
    padding: 'var(--space-5)',
    color: 'var(--cloud-mute)',
    fontStyle: 'italic',
  },

  // ── Tooltip ────────────────────────────────────────────────────
  tooltipBox: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 4,
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--cloud-pearl)',
    minWidth: 180,
    boxShadow: 'var(--shadow-card)',
  },
  tooltipHeader: {
    fontWeight: 600,
    letterSpacing: '0.06em',
    paddingBottom: 'var(--space-2)',
    marginBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--rule-faint)',
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
  tooltipValue: {
    fontVariantNumeric: 'tabular-nums',
  },

  // ── Empty state ────────────────────────────────────────────────
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

  // ── Footnote ───────────────────────────────────────────────────
  footnote: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '76ch',
    lineHeight: 1.7,
    marginTop: 'var(--space-2)',
  },
};
