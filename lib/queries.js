/**
 * lib/queries.js — SQL queries for each Phase 6 materialized view.
 *
 * Single source of truth.  Both the composite /api/dashboard endpoint
 * and the per-section endpoints read from this module so additions
 * land in one place.
 *
 * Convention
 * ----------
 * Each query is a tagged template-friendly string with $1, $2, ...
 * placeholders for any parameters.  No ORM; postgres is the schema
 * and we treat it that way.
 *
 * All queries select `_mv_refreshed_at` so the JSX can render
 * per-section freshness lamps.  For materialized views this comes
 * from the MV's own column; for regular tables and views we synthesize
 * `now() AS _mv_refreshed_at`.  All queries impose a sensible LIMIT
 * to prevent payload bloat on a runaway MV.
 *
 * 2026-05-09 — Vigil rewrite + Map section + RealizedEdge upgrade
 * --------------------------------------------------------------
 *   * Removed: BURN_IN_STATUS (Phase 4.1 dual-cache burn-in completed
 *     and is no longer monitored on the dashboard).
 *   * Added: VIGIL_EMOS, VIGIL_ISOTONIC, VIGIL_BIASES — the three-panel
 *     replacement for Vigil that monitors the live calibration stack
 *     (EMOS v2, isotonic, station biases).
 *   * Added: REALIZED_SUMMARY — pure-realized P&L per market_type from
 *     the trades table directly, no closing-line dependency.  Powers
 *     RealizedEdge tier-1 tiles.
 *   * Added: PIPELINE_COUNTS — five-stage attribution-pipeline diagnostic
 *     view from migration 034.  Powers RealizedEdge tier-2 empty state.
 *   * Added: MAP_TODAY — per-(city, market_type) latest forecast for the
 *     new WeatherMap section.
 */

// ──────────────────────────────────────────────────────────────────
// Section: TRADES (mv_trades_full)
// ──────────────────────────────────────────────────────────────────

export const TRADES_RECENT = {
  sql: `
    SELECT
        _mv_refreshed_at,
        trade_id,
        market_id,
        ticker,
        bet_side,
        market_type,
        city,
        target_date,
        target_month,
        decided_at,
        settled_at,
        intent_price,
        intent_size_usd,
        trade_status,
        grade,
        grade_reason,
        confidence,
        predictive_mu_cal,
        predictive_sigma_cal,
        our_prob_cal,
        market_prob,
        edge_pct,
        clv_cents,
        latest_actual_value AS actual_value,
        latest_won AS won,
        latest_pnl AS pnl,
        crps_cal,
        crps_skill_score,
        in_predictive_50pi,
        in_predictive_90pi
    FROM analytics.mv_trades_full
    ORDER BY decided_at DESC NULLS LAST
    LIMIT $1
  `,
  defaultLimit: 200,
};

// ──────────────────────────────────────────────────────────────────
// Section: ATTRIBUTION (mv_pnl_attribution)
// ──────────────────────────────────────────────────────────────────
//
// 2026-05-09: MV definition replaced via migration 034 to handle
// uppercase bet_side and one-sided closing books.  Schema gained
// book_side_present, yes_book_depth, no_book_depth, yes_mid_cents,
// best_yes_bid_cents, best_no_bid_cents.  We project the new
// columns alongside the original surface so the JSX can stratify
// CLV by book health.

export const ATTRIBUTION_RECENT = {
  sql: `
    SELECT
        _mv_refreshed_at,
        trade_id,
        bet_side,
        market_type,
        city,
        target_date,
        target_month,
        grade,
        decided_at,
        settled_at,
        intent_price,
        intent_size_usd,
        fees_paid,
        closing_mid_our_side,
        clv_cents,
        outcome_y,
        edge_per_contract,
        variance_per_contract,
        fees_per_contract,
        slippage_per_contract,
        realized_pnl_per_contract,
        n_contracts,
        book_side_present,
        yes_book_depth,
        no_book_depth
    FROM analytics.mv_pnl_attribution
    ORDER BY settled_at DESC NULLS LAST
    LIMIT $1
  `,
  defaultLimit: 500,
};

// ──────────────────────────────────────────────────────────────────
// Section: REALIZED_SUMMARY (per-market totals from trades)
// ──────────────────────────────────────────────────────────────────
//
// Tier 1 of the RealizedEdge section.  No closing-line dependency —
// reads settler-truth from the trades table directly.  Populates the
// instant a trade settles.

export const REALIZED_SUMMARY = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        market_type,
        COUNT(*)                                          AS n_settled,
        SUM(CASE WHEN won = TRUE  THEN 1 ELSE 0 END)      AS n_won,
        SUM(CASE WHEN won = FALSE THEN 1 ELSE 0 END)      AS n_lost,
        COALESCE(SUM(pnl), 0)::REAL                       AS total_pnl_net,
        COALESCE(SUM(pnl_gross), 0)::REAL                 AS total_pnl_gross,
        COALESCE(SUM(intent_size_usd), 0)::REAL           AS total_intent_size_usd,
        COALESCE(SUM(fees_paid), 0)::REAL                 AS total_fees_paid
    FROM trades
    WHERE settled_at IS NOT NULL
    GROUP BY market_type
    ORDER BY market_type
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: PIPELINE_COUNTS (analytics.v_attribution_pipeline_counts)
// ──────────────────────────────────────────────────────────────────
//
// Tier 2 of the RealizedEdge section.  Single-row view returning the
// five-stage pipeline counts so the dashboard can render an honest
// diagnostic when the attribution MV is sparse or empty.

export const PIPELINE_COUNTS = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        n_settled,
        n_with_closing_line,
        n_with_orderbook_captured,
        n_with_usable_book,
        n_in_attribution
    FROM analytics.v_attribution_pipeline_counts
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: MAP (analytics.v_map_today)
// ──────────────────────────────────────────────────────────────────
//
// Per-(city, market_type) latest forecast within the last 6 hours.
// Powers the WeatherMap section's FORECAST and SPREAD modes.  Up to
// 40 rows (20 cities × 2 market_types) when full coverage exists.

export const MAP_TODAY = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        city,
        market_type,
        target_date,
        target_month,
        mu_cal,
        sigma_cal,
        mu_raw,
        sigma_raw,
        q10,
        q50,
        q90,
        confidence,
        station_bias_applied,
        generated_at,
        n_sources
    FROM analytics.v_map_today
    ORDER BY city, market_type
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: VIGIL_EMOS (emos_fits_v2 — active fits only)
// ──────────────────────────────────────────────────────────────────
//
// Top panel of the new Vigil section.  Per-cell active EMOS v2 fits
// with sanity-check coefficients, CRPS lift ratio, and shadow/promoted
// state machine columns.  The JSX computes rollup stats and the
// "worst 10 by lift ratio" watchlist client-side.

export const VIGIL_EMOS = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        scope_market_type,
        scope_lead_bin,
        scope_source,
        scope_station,
        scope_doy_center,
        a, b, c, d, sigma_min,
        crps_train,
        crps_holdout,
        crps_raw_train,
        crps_raw_holdout,
        n_train_samples,
        n_holdout_samples,
        cv_method,
        fit_method,
        model_config_hash,
        shadow_at,
        promoted_at
    FROM emos_fits_v2
    WHERE active = TRUE AND retired_at IS NULL
    ORDER BY
        scope_market_type,
        scope_source NULLS FIRST,
        scope_station NULLS FIRST,
        scope_lead_bin NULLS FIRST
    LIMIT 20000
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: VIGIL_ISOTONIC (isotonic_fits — active fits only)
// ──────────────────────────────────────────────────────────────────
//
// Middle panel of Vigil.  Per market_type isotonic calibrators.  The
// JSX renders one card per HIGH / LOW / RAINM with the calibration
// curve sketched from control_points and the brier_holdout / brier_train
// ratio as the headline health signal.

export const VIGIL_ISOTONIC = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        scope_station,
        scope_market_type,
        fit_method,
        control_points,
        n_samples,
        training_window_start,
        training_window_end,
        brier_train,
        brier_holdout,
        log_loss_train,
        active_at
    FROM isotonic_fits
    WHERE deactivated_at IS NULL
    ORDER BY scope_market_type, scope_station NULLS FIRST
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: VIGIL_BIASES (station_biases — active rows only)
// ──────────────────────────────────────────────────────────────────
//
// Bottom panel of Vigil.  Per-(city, market_type) empirical bias.
// The JSX builds the 20-city × 2-market_type dense matrix and the
// distribution histogram.

export const VIGIL_BIASES = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        scope_city,
        scope_market_type,
        empirical_bias,
        n_samples,
        min_samples_threshold,
        training_window_start,
        training_window_end,
        active_at
    FROM station_biases
    WHERE deactivated_at IS NULL
    ORDER BY scope_city, scope_market_type
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: CALIBRATION (mv_calibration_buckets_win)
// ──────────────────────────────────────────────────────────────────

export const CALIBRATION_BUCKETS = {
  sql: `
    SELECT
        _mv_refreshed_at,
        bucket_day,
        prob_decile,
        market_type,
        bet_side,
        n_trades,
        predicted_mean,
        empirical_mean,
        predicted_std,
        mean_crps_cal,
        mean_crpss,
        pi50_coverage,
        pi90_coverage,
        total_pnl,
        mean_pnl,
        mean_edge_pct
    FROM analytics.mv_calibration_buckets_win
    WHERE bucket_day >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY bucket_day DESC, market_type, bet_side, prob_decile
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: SOURCE SKILL (mv_source_skill_30d)
// ──────────────────────────────────────────────────────────────────

export const SOURCE_SKILL = {
  sql: `
    SELECT
        _mv_refreshed_at,
        lookback_window_end,
        lookback_window_start,
        source,
        variant,
        variant_key,
        n_paired,
        bias,
        rmse,
        mae,
        n_paired_tmax,
        n_paired_tmin
    FROM analytics.mv_source_skill_30d
    ORDER BY rmse ASC NULLS LAST
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: SIGNALS FUNNEL (mv_signals_funnel_30d)
// ──────────────────────────────────────────────────────────────────

export const SIGNALS_FUNNEL = {
  sql: `
    SELECT
        _mv_refreshed_at,
        lookback_window_end,
        lookback_window_start,
        decision,
        market_type,
        n_signals,
        n_taken,
        n_skipped,
        mean_our_prob,
        mean_market_prob,
        mean_edge_pct,
        mean_confidence,
        n_with_cf,
        cf_win_rate,
        cf_total_pnl,
        skipped_cf_pnl
    FROM analytics.mv_signals_funnel_30d
    ORDER BY n_signals DESC
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: API HEALTH (mv_api_call_health_24h)
// ──────────────────────────────────────────────────────────────────

export const API_HEALTH = {
  sql: `
    SELECT
        _mv_refreshed_at,
        lookback_window_start,
        lookback_window_end,
        endpoint_class,
        n_calls,
        n_errors,
        n_5xx,
        n_4xx,
        p50_duration_ms,
        p95_duration_ms,
        p99_duration_ms,
        total_bytes,
        mean_bytes,
        rate_limit_min_remaining,
        rate_limit_mean_remaining
    FROM analytics.mv_api_call_health_24h
    ORDER BY n_calls DESC
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: CLOSING LINE COVERAGE (mv_closing_line_coverage)
// ──────────────────────────────────────────────────────────────────

export const CLOSING_LINE_COVERAGE = {
  sql: `
    SELECT
        _mv_refreshed_at,
        target_date_norm,
        market_type,
        n_trades_total,
        n_trades_eligible,
        n_trades_captured,
        n_trades_missed,
        capture_rate
    FROM analytics.mv_closing_line_coverage
    WHERE target_date_norm >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY target_date_norm DESC, market_type
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: DATA COMPLETENESS (mv_data_completeness)
// ──────────────────────────────────────────────────────────────────

export const DATA_COMPLETENESS = {
  sql: `
    SELECT
        _mv_refreshed_at,
        city,
        source,
        variant,
        variant_key,
        target_date,
        has_ok_run,
        n_variables,
        n_member_rows,
        last_fetched_at,
        last_model_cycle,
        hours_since_last_fetch,
        health_status
    FROM analytics.mv_data_completeness
    ORDER BY target_date, city, source
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section catalog — used by the [section] dynamic route to dispatch
// a path-segment to a query.  Keys are URL-safe; values are query
// definitions.
// ──────────────────────────────────────────────────────────────────
//
// Note: the legacy `vigil` slug (BURN_IN_STATUS) was removed 2026-05-09
// as part of the Vigil rewrite — burn-in is no longer monitored.  The
// new Vigil JSX assembles its data from three slugs (vigil_emos,
// vigil_isotonic, vigil_biases) so each calibration layer can render
// independently and freshness is panel-specific.

export const SECTION_QUERIES = {
  trades:           { ...TRADES_RECENT,         name: 'trades' },
  attribution:      { ...ATTRIBUTION_RECENT,    name: 'attribution' },
  realized_summary: { ...REALIZED_SUMMARY,      name: 'realized_summary' },
  pipeline_counts:  { ...PIPELINE_COUNTS,       name: 'pipeline_counts' },
  map:              { ...MAP_TODAY,             name: 'map' },
  vigil_emos:       { ...VIGIL_EMOS,            name: 'vigil_emos' },
  vigil_isotonic:   { ...VIGIL_ISOTONIC,        name: 'vigil_isotonic' },
  vigil_biases:     { ...VIGIL_BIASES,          name: 'vigil_biases' },
  calibration:      { ...CALIBRATION_BUCKETS,   name: 'calibration' },
  sources:          { ...SOURCE_SKILL,          name: 'sources' },
  signals:          { ...SIGNALS_FUNNEL,        name: 'signals' },
  health:           { ...API_HEALTH,            name: 'health' },
  coverage:         { ...CLOSING_LINE_COVERAGE, name: 'coverage' },
  completeness:     { ...DATA_COMPLETENESS,     name: 'completeness' },
};

/**
 * Resolve a SECTION_QUERIES entry by URL slug.  Returns null for
 * unknown slugs so the route handler can return 404 cleanly.
 */
export function getSectionQuery(slug) {
  return SECTION_QUERIES[slug] ?? null;
}

/**
 * Build params for a query given an optional limit.  Most queries
 * either accept a single $1 limit or no params at all.
 */
export function buildParams(queryDef, requestedLimit) {
  if (queryDef.defaultLimit === null) {
    return [];
  }
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 1000)
    : queryDef.defaultLimit;
  return [limit];
}

/**
 * The composite endpoint runs all sections in parallel.  This helper
 * assembles the queryMany input.
 */
export function buildCompositeQueries() {
  const out = {};
  for (const [slug, def] of Object.entries(SECTION_QUERIES)) {
    out[slug] = { sql: def.sql, params: buildParams(def, undefined) };
  }
  return out;
}
