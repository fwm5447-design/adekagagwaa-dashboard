'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * CalibrationPipeline — replaces the prior TributaryEnsemble + Vigil
 * sections.  Tells the four-stage calibration story in one place:
 *
 *   STAGE 1 · Sources           — per-source skill from mv_source_skill_30d
 *   STAGE 2 · EMOS v2           — μ/σ calibration health (emos_fits_v2)
 *   STAGE 3 · Isotonic          — currently retired (last fit 2026-05-11);
 *                                 reads from isotonic_fits if any return
 *   STAGE 4 · Station biases    — per-city threshold corrections
 *
 * Each stage has its own panel with KPIs + visualization + detail.  A
 * pipeline-wide verdict tile at top summarizes health across all
 * stages — gold if every stage is within target, escalating amber →
 * storm-violet → coral when any stage regresses.
 *
 * Data contract:
 *   data.sources         — mv_source_skill_30d rows
 *   data.emos            — emos_fits_v2 rows (active only)
 *   data.isotonic        — isotonic_fits rows (active only; usually empty)
 *   data.station_biases  — station_biases rows (active only)
 *   freshness            — number | { sources?, emos? } (ISO timestamps);
 *                          the frame uses the sources freshness because
 *                          it's the MV-backed cadence
 */
export default function CalibrationPipeline({ data = {}, freshness }) {
  const sources      = useMemo(() => Array.isArray(data.sources)        ? data.sources        : [], [data.sources]);
  const emosRows     = useMemo(() => Array.isArray(data.emos)           ? data.emos           : [], [data.emos]);
  const isotonicRows = useMemo(() => Array.isArray(data.isotonic)       ? data.isotonic       : [], [data.isotonic]);
  const biasRows     = useMemo(() => Array.isArray(data.station_biases) ? data.station_biases : [], [data.station_biases]);

  // Permit both freshness shapes (legacy: a single timestamp; new: an object).
  const sourcesFresh = (freshness && typeof freshness === 'object') ? freshness.sources : freshness;

  // ── Source skill aggregates ─────────────────────────────────────
  const sourceStats = useMemo(() => {
    const data = sources
      .map((r) => ({
        label: `${r.source}${r.variant ? ` · ${r.variant}` : ''}`,
        source: String(r.source),
        variant: String(r.variant ?? ''),
        rmse: Number(r.rmse),
        bias: Number(r.bias),
        mae:  Number(r.mae),
        n_paired: Number(r.n_paired),
        n_tmax: Number(r.n_paired_tmax),
        n_tmin: Number(r.n_paired_tmin),
      }))
      .filter((d) => Number.isFinite(d.rmse))
      .sort((a, b) => a.rmse - b.rmse);
    if (data.length === 0) {
      return { data, best: null, worst: null, median_rmse: null, n_under_3: 0, n_total: 0, max_abs_bias: 0 };
    }
    const med = data[Math.floor(data.length / 2)];
    const maxBias = data.reduce((m, d) => Math.max(m, Math.abs(d.bias) || 0), 0);
    return {
      data,
      best: data[0],
      worst: data[data.length - 1],
      median_rmse: med?.rmse ?? null,
      n_under_3: data.filter((d) => d.rmse < 3.0).length,
      n_total: data.length,
      max_abs_bias: maxBias,
    };
  }, [sources]);

  // ── EMOS aggregates ─────────────────────────────────────────────
  const emosStats = useMemo(() => {
    const n = emosRows.length;
    if (n === 0) {
      return { n: 0, n_sane: 0, sanity_pct: null, median_lift: null, n_promoted: 0, n_shadow: 0, n_regressing: 0 };
    }
    let n_sane = 0, n_promoted = 0, n_shadow = 0, n_regressing = 0;
    const lifts = [];
    for (const r of emosRows) {
      const c = Number(r.c), d = Number(r.d);
      if (Number.isFinite(c) && Number.isFinite(d) && c > 0 && d > 0) n_sane += 1;
      if (r.promoted_at) n_promoted += 1;
      else if (r.shadow_at) n_shadow += 1;
      const ch = Number(r.crps_holdout), rh = Number(r.crps_raw_holdout);
      if (Number.isFinite(ch) && Number.isFinite(rh) && rh > 0) {
        const lift = ch / rh;
        lifts.push(lift);
        if (lift > 1.0) n_regressing += 1;
      }
    }
    lifts.sort((a, b) => a - b);
    const median_lift = lifts.length === 0
      ? null
      : (lifts.length % 2 === 1
          ? lifts[(lifts.length - 1) / 2]
          : (lifts[lifts.length / 2 - 1] + lifts[lifts.length / 2]) / 2);
    return {
      n, n_sane,
      sanity_pct: n > 0 ? n_sane / n : null,
      median_lift,
      n_promoted, n_shadow, n_regressing,
    };
  }, [emosRows]);

  // Worst 10 EMOS fits by lift ratio
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

  // ── Isotonic state ──────────────────────────────────────────────
  const isotonicState = useMemo(() => {
    const active = isotonicRows.filter((r) => r);  // all returned rows are active per query
    return {
      n_active: active.length,
      retired: active.length === 0,
      rows: active,
    };
  }, [isotonicRows]);

  // ── Station biases ──────────────────────────────────────────────
  const biasMatrix = useMemo(() => {
    const m = new Map();
    for (const r of biasRows) {
      const city = String(r.scope_city);
      if (!m.has(city)) m.set(city, { high: null, low: null });
      const mt = String(r.scope_market_type);
      if (mt === 'high' || mt === 'low') m.get(city)[mt] = r;
    }
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
    return Math.max(max, 1.0);
  }, [biasRows]);

  const biasMaxAbs = useMemo(() => {
    let max = 0;
    for (const r of biasRows) {
      const v = Math.abs(Number(r.empirical_bias) || 0);
      if (v > max) max = v;
    }
    return max;
  }, [biasRows]);

  // ── Pipeline verdict ────────────────────────────────────────────
  const verdict = useMemo(() => buildVerdict({
    sourceStats, emosStats, isotonicState, biasMaxAbs,
  }), [sourceStats, emosStats, isotonicState, biasMaxAbs]);

  const hasAnyData = (sourceStats.n_total + emosStats.n + biasMatrix.length) > 0;

  return (
    <SectionFrame
      id="calibration_pipeline"
      invocation="The Calibration Pipeline"
      title="The Calibration Pipeline"
      subtitle="Four stages turn 17 raw forecasts into a single edge estimate.  Sources pour into the ensemble; EMOS warps the predictive Gaussian; isotonic re-maps probabilities; station biases shift thresholds for each city's microclimate.  Every stage must hold its own — the bot trades on the worst-graded layer's residual."
      freshnessAt={sourcesFresh}
      freshnessCadenceSec={86400 /* daily refresh of the sources MV */}
    >
      {!hasAnyData ? (
        <EmptyState />
      ) : (
        <>
          <Verdict verdict={verdict} stats={{ sourceStats, emosStats, isotonicState, biasMaxAbs }} />

          {/* ─── STAGE 1 — Sources ──────────────────────────────── */}
          <Stage
            ordinal="stage one"
            title="Source skill · 17 forecasts, ranked by RMSE"
            statusTone={verdict.stage_sources.tone}
            statusLabel={verdict.stage_sources.label}
          >
            {sourceStats.n_total === 0 ? (
              <Stub message="No paired source-vs-observation rows yet." />
            ) : (
              <>
                <div style={S.tileRow4}>
                  <Tile
                    eyebrow="sources tracked"
                    value={fmtInt(sourceStats.n_total)}
                    sub={`${fmtInt(sourceStats.n_under_3)} under 3°F RMSE`}
                  />
                  <Tile
                    eyebrow="best"
                    value={`${sourceStats.best.rmse.toFixed(2)}°F`}
                    sub={sourceStats.best.label}
                    tone="positive"
                  />
                  <Tile
                    eyebrow="worst"
                    value={`${sourceStats.worst.rmse.toFixed(2)}°F`}
                    sub={sourceStats.worst.label}
                    tone={sourceStats.worst.rmse >= 8 ? 'negative' : 'neutral'}
                  />
                  <Tile
                    eyebrow="max |bias|"
                    value={`${sourceStats.max_abs_bias.toFixed(2)}°F`}
                    sub="across all sources"
                    tone={sourceStats.max_abs_bias > 2.5 ? 'neutral' : 'positive'}
                  />
                </div>

                {/* RMSE + Bias charts side-by-side */}
                <div style={S.chartGrid2}>
                  <div style={S.chartCard}>
                    <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                      RMSE by source · °F  (lower = better)
                    </div>
                    <ResponsiveContainer width="100%" height={Math.max(240, sourceStats.data.length * 28)}>
                      <BarChart data={sourceStats.data} layout="vertical"
                        margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                        <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" horizontal={false} />
                        <XAxis type="number" tick={S.axisTick} stroke="var(--rule-mid)" />
                        <YAxis type="category" dataKey="label"
                          tick={{ ...S.axisTick, fill: 'var(--cloud-haze)' }}
                          stroke="var(--rule-mid)" width={150} />
                        <Tooltip content={<SourceTooltip />} cursor={{ fill: 'var(--rule-faint)' }} />
                        <Bar dataKey="rmse" name="RMSE" isAnimationActive={false}>
                          {sourceStats.data.map((d, i) => (
                            <Cell key={i} fill={rmseColor(d.rmse)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={S.chartCard}>
                    <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                      Bias by source · °F  (positive = over-forecast)
                    </div>
                    <ResponsiveContainer width="100%" height={Math.max(240, sourceStats.data.length * 28)}>
                      <BarChart data={sourceStats.data} layout="vertical"
                        margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                        <CartesianGrid stroke="var(--rule-faint)" strokeDasharray="2 4" horizontal={false} />
                        <XAxis type="number" tick={S.axisTick} stroke="var(--rule-mid)" />
                        <YAxis type="category" dataKey="label"
                          tick={{ ...S.axisTick, fill: 'var(--cloud-haze)' }}
                          stroke="var(--rule-mid)" width={150} />
                        <Tooltip content={<SourceTooltip />} cursor={{ fill: 'var(--rule-faint)' }} />
                        <ReferenceLine x={0} stroke="var(--rule-strong)" strokeWidth={1} />
                        <Bar dataKey="bias" name="Bias" isAnimationActive={false}>
                          {sourceStats.data.map((d, i) => (
                            <Cell key={i} fill={biasColor(d.bias)} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Detail table */}
                <div style={S.tableCard}>
                  <table style={S.table}>
                    <thead>
                      <tr style={S.theadRow}>
                        <th style={S.thLeft}>Source</th>
                        <th style={S.thLeft}>Variant</th>
                        <th style={S.thRight}>n paired</th>
                        <th style={S.thRight}>n tmax</th>
                        <th style={S.thRight}>n tmin</th>
                        <th style={S.thRight}>Bias</th>
                        <th style={S.thRight}>MAE</th>
                        <th style={S.thRight}>RMSE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceStats.data.map((d, i) => (
                        <tr key={i} style={S.tbodyRow}>
                          <td style={S.tdLeft}>{d.source}</td>
                          <td style={{ ...S.tdLeft, color: 'var(--cloud-mute)' }}>{d.variant || '—'}</td>
                          <td style={S.tdRight}>{fmtInt(d.n_paired)}</td>
                          <td style={S.tdRight}>{fmtInt(d.n_tmax)}</td>
                          <td style={S.tdRight}>{fmtInt(d.n_tmin)}</td>
                          <td style={{ ...S.tdRight, color: biasColor(d.bias) }}>
                            {Number.isFinite(d.bias) ? `${d.bias > 0 ? '+' : ''}${d.bias.toFixed(2)}` : '—'}
                          </td>
                          <td style={S.tdRight}>{Number.isFinite(d.mae) ? d.mae.toFixed(2) : '—'}</td>
                          <td style={{ ...S.tdRight, color: rmseColor(d.rmse), fontWeight: 600 }}>
                            {Number.isFinite(d.rmse) ? d.rmse.toFixed(2) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Stage>

          {/* ─── STAGE 2 — EMOS v2 ──────────────────────────────── */}
          <Stage
            ordinal="stage two"
            title="EMOS v2 · predictive μ / σ calibration"
            statusTone={verdict.stage_emos.tone}
            statusLabel={verdict.stage_emos.label}
          >
            {emosStats.n === 0 ? (
              <Stub message="No active EMOS v2 fits in the table." />
            ) : (
              <>
                <div style={S.tileRow4}>
                  <Tile
                    eyebrow="active fits"
                    value={fmtInt(emosStats.n)}
                    sub={`${fmtInt(emosStats.n_promoted)} promoted · ${fmtInt(emosStats.n_shadow)} shadow`}
                  />
                  <Tile
                    eyebrow="coefficient sanity"
                    value={emosStats.sanity_pct == null ? '—' : `${(emosStats.sanity_pct * 100).toFixed(1)}%`}
                    sub="c > 0 ∧ d > 0"
                    tone={emosStats.sanity_pct >= 0.99 ? 'positive'
                        : emosStats.sanity_pct >= 0.80 ? 'neutral'
                        : 'negative'}
                  />
                  <Tile
                    eyebrow="median CRPS lift"
                    value={emosStats.median_lift == null ? '—' : emosStats.median_lift.toFixed(3)}
                    sub={emosStats.median_lift == null ? 'no holdout data'
                       : emosStats.median_lift < 1.0
                           ? `${((1 - emosStats.median_lift) * 100).toFixed(1)}% better than raw`
                           : `${((emosStats.median_lift - 1) * 100).toFixed(1)}% worse than raw`}
                    tone={emosStats.median_lift == null ? 'neutral'
                        : emosStats.median_lift < 0.95 ? 'positive'
                        : emosStats.median_lift > 1.0 ? 'negative'
                        : 'neutral'}
                  />
                  <Tile
                    eyebrow="regressing fits"
                    value={fmtInt(emosStats.n_regressing)}
                    sub={`out of ${fmtInt(emosStats.n)}`}
                    tone={emosStats.n_regressing === 0 ? 'positive'
                        : emosStats.n_regressing < emosStats.n * 0.05 ? 'neutral'
                        : 'negative'}
                  />
                </div>

                <div style={S.cardSlab}>
                  <div className="eyebrow" style={S.cardSlabEyebrow}>
                    watchlist · ten weakest fits by holdout lift ratio
                  </div>
                  {emosWatchlist.length === 0 ? (
                    <Stub message="No fits with both holdout and raw-holdout CRPS computed yet." />
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
                                <span style={S.cellMt}>{r.scope_market_type}</span>
                                {r.scope_lead_bin != null && <span style={S.cellLb}> · lb{r.scope_lead_bin}</span>}
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
              </>
            )}
          </Stage>

          {/* ─── STAGE 3 — Isotonic (likely retired) ─────────────── */}
          <Stage
            ordinal="stage three"
            title="Isotonic · probability calibration"
            statusTone={verdict.stage_isotonic.tone}
            statusLabel={verdict.stage_isotonic.label}
          >
            {isotonicState.retired ? (
              <RetiredNotice />
            ) : (
              <IsotonicPanels rows={isotonicState.rows} />
            )}
          </Stage>

          {/* ─── STAGE 4 — Station biases ────────────────────────── */}
          <Stage
            ordinal="stage four"
            title="Station biases · per-city threshold corrections"
            statusTone={verdict.stage_biases.tone}
            statusLabel={verdict.stage_biases.label}
            meta={`${fmtInt(biasRows.length)} active rows · target ±5°F · max observed ${biasMaxAbs.toFixed(2)}°F`}
          >
            {biasRows.length === 0 ? (
              <Stub message="No active station biases yet — the analyzer falls through to the physics prior until enough forecast×observation pairs accumulate." />
            ) : (
              <div style={S.biasShell}>
                <div style={S.biasGrid}>
                  {biasMatrix.map((row) => (
                    <BiasRow key={row.city} row={row} range={biasRange} />
                  ))}
                </div>
                <BiasHistogram rows={biasRows} range={biasRange} />
              </div>
            )}
          </Stage>

          <div style={S.footnote}>
            EMOS warps the predictive Gaussian to fit historical observation residuals.
            Isotonic regression re-maps the YES-probability against empirical settlement
            frequencies (currently retired — raw probability passes through).  Station
            biases shift the comparison threshold by each city&rsquo;s measured microclimate
            offset.  Each stage applies at decision time; the bot trades on the worst-graded
            layer&rsquo;s residual.
          </div>
        </>
      )}
    </SectionFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Verdict — pipeline-wide health summary.
// ─────────────────────────────────────────────────────────────────────
function Verdict({ verdict, stats }) {
  const { sourceStats, emosStats, biasMaxAbs } = stats;
  return (
    <div style={{ ...S.verdictCard, borderColor: verdict.tone.border, background: verdict.tone.bg }}>
      <div style={S.verdictInner}>
        <div style={S.verdictLabelBlock}>
          <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
            Pipeline verdict
          </div>
          <span style={{
            ...S.verdictBadge,
            color: verdict.tone.fg,
            borderColor: verdict.tone.border,
            background: verdict.tone.bg,
          }}>
            {verdict.label}
          </span>
          <div style={S.verdictNarrative}>
            {verdict.narrative}
          </div>
        </div>
        <div style={S.verdictStrip}>
          <VerdictChip
            label="sources"
            value={sourceStats.best ? `${sourceStats.best.rmse.toFixed(1)}°F` : '—'}
            sub="best RMSE"
            tone={verdict.stage_sources.tone}
          />
          <VerdictChip
            label="EMOS"
            value={emosStats.median_lift == null ? '—' : emosStats.median_lift.toFixed(2)}
            sub={emosStats.median_lift == null ? 'no data'
               : emosStats.median_lift < 1.0
                   ? `${((1 - emosStats.median_lift) * 100).toFixed(0)}% lift`
                   : `${((emosStats.median_lift - 1) * 100).toFixed(0)}% reg`}
            tone={verdict.stage_emos.tone}
          />
          <VerdictChip
            label="isotonic"
            value={verdict.stage_isotonic.label}
            sub={verdict.stage_isotonic.detail || '—'}
            tone={verdict.stage_isotonic.tone}
          />
          <VerdictChip
            label="biases"
            value={biasMaxAbs > 0 ? `±${biasMaxAbs.toFixed(2)}°F` : '—'}
            sub="max abs"
            tone={verdict.stage_biases.tone}
          />
        </div>
      </div>
    </div>
  );
}

function VerdictChip({ label, value, sub, tone }) {
  return (
    <div style={S.verdictChip}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</div>
      <div className="numeric" style={{ ...S.verdictChipValue, color: tone.fg }}>{value}</div>
      <div style={S.verdictChipSub}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stage wrapper — panel with ordinal eyebrow, title, status pill, body.
// ─────────────────────────────────────────────────────────────────────
function Stage({ ordinal, title, statusTone, statusLabel, meta, children }) {
  return (
    <div style={S.stageOuter}>
      <div style={S.stageHeader}>
        <div>
          <div className="eyebrow" style={S.stageEyebrow}>{ordinal}</div>
          <div style={S.stageTitle}>{title}</div>
          {meta && <div style={S.stageMeta}>{meta}</div>}
        </div>
        <span style={{
          ...S.stageStatus,
          color: statusTone.fg,
          background: statusTone.bg,
          borderColor: statusTone.border,
        }}>
          {statusLabel}
        </span>
      </div>
      <div style={S.stageBody}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Retired isotonic notice.
// ─────────────────────────────────────────────────────────────────────
function RetiredNotice() {
  return (
    <div style={S.retiredCard}>
      <div style={S.retiredTitle}>Layer dormant</div>
      <div style={S.retiredBody}>
        No active isotonic fits — the last calibrator was deactivated on 2026-05-11
        and the layer no-ops in the current decision path.  Raw model probability passes
        through unchanged to the next stage.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Isotonic panels — only renders when there are active rows.
// (Kept lean; the original Vigil component had a full implementation
// when isotonic was live — restore from that file's IsotonicCard if
// the layer is reactivated.)
// ─────────────────────────────────────────────────────────────────────
function IsotonicPanels({ rows }) {
  const byMarket = useMemo(() => {
    const out = { high: null, low: null, rainm: null };
    for (const r of rows) {
      if (r.scope_station != null && String(r.scope_station).length > 0) continue;
      const mt = String(r.scope_market_type);
      if (out[mt] === null || (Number(r.n_samples) > Number(out[mt]?.n_samples || 0))) {
        out[mt] = r;
      }
    }
    return out;
  }, [rows]);

  return (
    <div style={S.isoGrid}>
      {['high', 'low', 'rainm'].map((mt) => {
        const r = byMarket[mt];
        if (!r) {
          return (
            <div key={mt} style={S.isoCard}>
              <div style={S.isoCardHeader}>
                <span style={S.isoCardMt}>{mt.toUpperCase()}</span>
                <StatusPill value="building">PENDING</StatusPill>
              </div>
              <Stub message={`No active isotonic fit for ${mt}.`} />
            </div>
          );
        }
        const bt = Number(r.brier_train);
        const bh = Number(r.brier_holdout);
        const ratio = (Number.isFinite(bt) && Number.isFinite(bh) && bt > 0) ? bh / bt : null;
        const status = ratio == null ? 'building'
                     : ratio > 1.20 ? 'divergent'
                     : ratio > 1.10 ? 'building'
                     :                'ready';
        return (
          <div key={mt} style={S.isoCard}>
            <div style={S.isoCardHeader}>
              <span style={S.isoCardMt}>{mt.toUpperCase()}</span>
              <StatusPill value={status}>
                {ratio == null ? 'PENDING' : (status === 'ready' ? 'OK' : status === 'building' ? 'WATCHING' : 'REGRESSING')}
              </StatusPill>
            </div>
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
                <span className="numeric" style={S.isoMetricValue}>{fmtInt(r.n_samples)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Station bias matrix rows and histogram.
// ─────────────────────────────────────────────────────────────────────
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
        <span style={{ opacity: 0.4 }}>—</span>
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
          <div style={S.biasCenterTick} />
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

function BiasHistogram({ rows, range }) {
  const bins = 11;
  const counts = new Array(bins).fill(0);
  for (const r of rows) {
    const v = Number(r.empirical_bias);
    if (!Number.isFinite(v)) continue;
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

// ─────────────────────────────────────────────────────────────────────
// Tiny shared primitives
// ─────────────────────────────────────────────────────────────────────
function Tile({ eyebrow, value, sub, tone = 'neutral' }) {
  const color =
    tone === 'positive' ? 'var(--dawn-gold)'
    : tone === 'negative' ? 'var(--storm-violet)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.tile}>
      <div className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{eyebrow}</div>
      <div className="display-numeric" style={{ ...S.tileValue, color }}>{value}</div>
      {sub && <div style={S.tileSub}>{sub}</div>}
    </div>
  );
}

function Stub({ message }) {
  return <div style={S.stub}>{message}</div>;
}

function SourceTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={S.tooltipBox}>
      <div style={S.tooltipHeader}>{d.label}</div>
      <TooltipRow label="RMSE" value={`${d.rmse.toFixed(3)}°F`} valueColor={rmseColor(d.rmse)} />
      <TooltipRow label="bias" value={`${d.bias > 0 ? '+' : ''}${d.bias.toFixed(3)}°F`} valueColor={biasColor(d.bias)} />
      <TooltipRow label="MAE"  value={`${d.mae.toFixed(3)}°F`} />
      <TooltipRow label="n paired" value={fmtInt(d.n_paired)} />
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

function EmptyState() {
  return (
    <div style={S.empty}>
      <div style={S.emptyTitle}>The pipeline is quiet</div>
      <div style={S.emptySub}>
        No data from any of the four calibration stages.  Verify the source-skill MV,
        the EMOS refit worker, and the station-bias backfill have populated.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Verdict logic
// ─────────────────────────────────────────────────────────────────────
function buildVerdict({ sourceStats, emosStats, isotonicState, biasMaxAbs }) {
  const stage_sources = sourceStats.n_total === 0
    ? { tone: TONES.unknown, label: 'no data' }
    : sourceStats.best && sourceStats.best.rmse < 3.0
        ? { tone: TONES.ok, label: 'sharp' }
        : sourceStats.best && sourceStats.best.rmse < 5.0
            ? { tone: TONES.watching, label: 'mid' }
            : { tone: TONES.regressing, label: 'broad' };

  const stage_emos = emosStats.n === 0
    ? { tone: TONES.unknown, label: 'no fits' }
    : (emosStats.sanity_pct < 0.5
        || (emosStats.median_lift != null && emosStats.median_lift > 1.0))
        ? { tone: TONES.regressing, label: 'regressing' }
        : (emosStats.sanity_pct < 0.95
            || (emosStats.median_lift != null && emosStats.median_lift > 0.95))
            ? { tone: TONES.watching, label: 'watching' }
            : { tone: TONES.ok, label: 'healthy' };

  const stage_isotonic = isotonicState.retired
    ? { tone: TONES.dormant, label: 'retired', detail: 'no active fits' }
    : isotonicState.n_active > 0
        ? { tone: TONES.ok, label: 'active', detail: `${isotonicState.n_active} fits` }
        : { tone: TONES.unknown, label: 'unknown', detail: '—' };

  const stage_biases = biasMaxAbs === 0
    ? { tone: TONES.unknown, label: 'no data' }
    : biasMaxAbs > 5.0
        ? { tone: TONES.watching, label: 'wide' }
        : { tone: TONES.ok, label: 'tight' };

  // Overall = worst of (sources, emos, biases) — isotonic doesn't downgrade
  // because retirement is an intentional state, not a failure.
  const rank = { ok: 3, watching: 2, regressing: 1, dormant: 3, unknown: 3 };
  const stages = [stage_sources, stage_emos, stage_biases];
  const worst = stages.reduce((w, s) => {
    const sk = labelToRank(s, rank);
    const wk = labelToRank(w, rank);
    return sk < wk ? s : w;
  }, { tone: TONES.ok, label: 'ok' });

  const overall = labelToRank(worst, rank) === rank.ok
    ? 'PIPELINE OK'
    : labelToRank(worst, rank) === rank.watching
        ? 'PIPELINE WATCHING'
        : 'PIPELINE DEGRADED';

  const narrative = buildNarrative(stage_sources, stage_emos, stage_isotonic, stage_biases);

  return {
    label: overall,
    tone: worst.tone,
    narrative,
    stage_sources,
    stage_emos,
    stage_isotonic,
    stage_biases,
  };
}

function labelToRank(stage, rank) {
  if (stage.tone === TONES.ok)         return rank.ok;
  if (stage.tone === TONES.watching)   return rank.watching;
  if (stage.tone === TONES.regressing) return rank.regressing;
  if (stage.tone === TONES.dormant)    return rank.dormant;
  return rank.unknown;
}

function buildNarrative(s, e, iso, b) {
  const bits = [];
  if (s.label === 'sharp')   bits.push('sources are sharp');
  else if (s.label === 'mid') bits.push('sources are mid-skill');
  else if (s.label === 'broad') bits.push('sources are broad');
  if (e.label === 'healthy') bits.push('EMOS is healthy');
  else if (e.label === 'watching') bits.push('EMOS warrants watching');
  else if (e.label === 'regressing') bits.push('EMOS is regressing');
  if (iso.label === 'retired') bits.push('isotonic dormant');
  else if (iso.label === 'active') bits.push(`isotonic ${iso.detail}`);
  if (b.label === 'tight') bits.push('biases are tight');
  else if (b.label === 'wide') bits.push('biases are wide');
  return bits.join(' · ') || '—';
}

const TONES = {
  ok:         { fg: 'var(--dawn-gold)',    bg: 'rgba(212, 164, 74, 0.08)', border: 'rgba(212, 164, 74, 0.30)' },
  watching:   { fg: 'var(--dawn-amber)',   bg: 'rgba(184, 133, 58, 0.10)', border: 'rgba(184, 133, 58, 0.30)' },
  regressing: { fg: 'var(--storm-violet)', bg: 'var(--storm-haze)',         border: 'rgba(107, 77, 142, 0.40)' },
  dormant:    { fg: 'var(--cloud-mute)',   bg: 'rgba(245, 241, 232, 0.04)', border: 'rgba(245, 241, 232, 0.16)' },
  unknown:    { fg: 'var(--cloud-shade)',  bg: 'rgba(245, 241, 232, 0.04)', border: 'rgba(245, 241, 232, 0.10)' },
};

// ─────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────
function rmseColor(v) {
  if (!Number.isFinite(v)) return 'var(--cloud-shade)';
  if (v < 2.0) return 'var(--dawn-gold)';
  if (v < 3.0) return 'var(--dawn-amber)';
  if (v < 4.0) return 'var(--sky-azure)';
  if (v < 8.0) return 'var(--storm-violet)';
  return 'var(--coral-flare)';
}
function biasColor(v) {
  if (!Number.isFinite(v)) return 'var(--cloud-shade)';
  const abs = Math.abs(v);
  if (abs < 0.5) return 'var(--dawn-gold)';
  if (abs < 1.5) return 'var(--dawn-amber)';
  if (abs < 3.0) return 'var(--sky-azure)';
  return 'var(--storm-violet)';
}

// ─────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────
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
    flex: '1 1 280px',
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
  verdictStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(80px, 1fr))',
    gap: 'var(--space-3)',
    flex: '1 1 360px',
  },
  verdictChip: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  verdictChipValue: {
    fontSize: 'var(--type-large)',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    textTransform: 'uppercase',
  },
  verdictChipSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    letterSpacing: '0.04em',
  },

  // ── Stage wrapper ─────────────────────────────────────────────
  stageOuter: { marginBottom: 'var(--space-6)' },
  stageHeader: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingBottom: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
    borderBottom: '1px solid var(--rule-faint)',
    gap: 'var(--space-4)',
  },
  stageEyebrow: { color: 'var(--cloud-mute)', marginBottom: 'var(--space-1)' },
  stageTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-pearl)',
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
  stageMeta: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-1)',
  },
  stageStatus: {
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
  stageBody: {},

  // ── KPI tile rows ─────────────────────────────────────────────
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

  // ── Source charts ─────────────────────────────────────────────
  chartGrid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  chartCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
  },

  // ── Detail table ──────────────────────────────────────────────
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    overflowX: 'auto',
  },
  cardSlab: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    overflowX: 'auto',
  },
  cardSlabEyebrow: { color: 'var(--cloud-mute)', marginBottom: 'var(--space-3)' },
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
  cellMt: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  cellLb: { color: 'var(--cloud-mute)', fontSize: 'var(--type-micro)' },
  cellScope: { color: 'var(--cloud-haze)' },

  // ── Axes ──────────────────────────────────────────────────────
  axisTick: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    fill: 'var(--cloud-mute)',
  },

  // ── Retired notice ────────────────────────────────────────────
  retiredCard: {
    background: 'var(--ink-deep)',
    border: '1px dashed var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-5)',
    textAlign: 'center',
  },
  retiredTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-large)',
    color: 'var(--cloud-haze)',
    marginBottom: 'var(--space-2)',
  },
  retiredBody: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    maxWidth: '64ch',
    margin: '0 auto',
    lineHeight: 1.6,
  },

  // ── Isotonic panel grid ───────────────────────────────────────
  isoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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
    fontFamily: 'var(--font-display)',
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

  // ── Bias panel ────────────────────────────────────────────────
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
  biasBarContainer: { position: 'relative', width: '100%' },
  biasBarTrack: {
    position: 'relative',
    height: 8,
    background: 'var(--ink-mid)',
    borderRadius: 'var(--radius-pill)',
    overflow: 'hidden',
  },
  biasCenterTick: {
    position: 'absolute',
    top: 0, bottom: 0,
    left: '50%',
    width: 1,
    background: 'var(--rule-mid)',
    zIndex: 2,
  },
  biasBarFill: {
    position: 'absolute',
    top: 0, bottom: 0,
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

  // ── Tooltip ───────────────────────────────────────────────────
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
    color: 'var(--dawn-gold)',
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

  // ── Stubs / empty ─────────────────────────────────────────────
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
