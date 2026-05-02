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
 * per-section freshness lamps.  All queries impose a sensible LIMIT
 * to prevent payload bloat on a runaway MV.
 *
 * The ORDER BY clauses are chosen so the natural "most recent first"
 * or "highest priority first" rendering is the default, allowing the
 * JSX to render directly without re-sorting client-side.
 */

// ──────────────────────────────────────────────────────────────────
// Section: TRADES (mv_trades_full)
// ──────────────────────────────────────────────────────────────────
//
// Default surface: last 200 trades by decided_at, settled or open.
// Used by the Trade Ledger section.  The full MV has ~89 columns;
// we project the 30 the dashboard renders to keep payload small.

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
// Default surface: last 200 settled trades with closing-line capture.
// Carries the four-term decomposition: edge / variance / fees / slippage.

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
        n_contracts
    FROM analytics.mv_pnl_attribution
    ORDER BY settled_at DESC NULLS LAST
    LIMIT $1
  `,
  defaultLimit: 200,
};

// ──────────────────────────────────────────────────────────────────
// Section: CALIBRATION (mv_calibration_buckets)
// ──────────────────────────────────────────────────────────────────
//
// Last 30 days of decile×market_type buckets, ordered by day descending
// so the JSX heatmap reads "newest first" left-to-right.

export const CALIBRATION_BUCKETS = {
  sql: `
    SELECT
        _mv_refreshed_at,
        bucket_day,
        prob_decile,
        market_type,
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
    FROM analytics.mv_calibration_buckets
    WHERE bucket_day >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY bucket_day DESC, market_type, prob_decile
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
// Section: BURN-IN STATUS (v_burn_in_status — regular view)
// ──────────────────────────────────────────────────────────────────

export const BURN_IN_STATUS = {
  sql: `
    SELECT
        _mv_refreshed_at,
        source,
        variant,
        total_lookups,
        total_both_hit,
        total_l1_only,
        total_l2_only,
        total_both_miss,
        total_divergent,
        burn_in_started_at,
        last_observed_at,
        days_since_start,
        gate_status
    FROM analytics.v_burn_in_status
    ORDER BY total_lookups DESC
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section catalog — used by the [section] dynamic route to dispatch
// a path-segment to a query.  Keys are URL-safe; values are query
// definitions.
// ──────────────────────────────────────────────────────────────────

export const SECTION_QUERIES = {
  trades:        { ...TRADES_RECENT,        name: 'trades' },
  attribution:   { ...ATTRIBUTION_RECENT,   name: 'attribution' },
  calibration:   { ...CALIBRATION_BUCKETS,  name: 'calibration' },
  sources:       { ...SOURCE_SKILL,         name: 'sources' },
  signals:       { ...SIGNALS_FUNNEL,       name: 'signals' },
  health:        { ...API_HEALTH,           name: 'health' },
  coverage:      { ...CLOSING_LINE_COVERAGE,name: 'coverage' },
  completeness:  { ...DATA_COMPLETENESS,    name: 'completeness' },
  vigil:         { ...BURN_IN_STATUS,       name: 'vigil' },
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
 * The composite endpoint runs all 9 sections in parallel.  This
 * helper assembles the queryMany input.
 */
export function buildCompositeQueries() {
  const out = {};
  for (const [slug, def] of Object.entries(SECTION_QUERIES)) {
    out[slug] = { sql: def.sql, params: buildParams(def, undefined) };
  }
  return out;
}
