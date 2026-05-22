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
 *     mv_trades_full.  Powers RealizedEdge tier-1 tiles.
 *   * Added: PIPELINE_COUNTS — five-stage attribution-pipeline diagnostic
 *     view from migration 034.  Powers RealizedEdge tier-2 empty state.
 *   * Added: MAP_TODAY — per-(city, market_type) latest forecast for the
 *     new WeatherMap section.
 *
 * 2026-05-09 (later) — Bankroll section
 * -------------------------------------
 *   * Added: BANKROLL_SUMMARY, BANKROLL_CURVE — top-of-page P&L tracker.
 *     Tracking begins at TRACKING_EPOCH_START.  Bumping this constant
 *     and redeploying is the supported reset mechanism.
 *   * Fixed: REALIZED_SUMMARY now reads from analytics.mv_trades_full
 *     instead of public.trades.  The analytics_reader role does not
 *     have SELECT on the public schema (see migration 025), so the
 *     prior version was failing silently and tier-1 tiles were empty.
 */

// ──────────────────────────────────────────────────────────────────
// Bankroll tracking constants
// ──────────────────────────────────────────────────────────────────
//
// Bump TRACKING_EPOCH_START and redeploy to reset the bankroll counter.
// All trades with decided_at < this timestamp are excluded from the
// Bankroll section's aggregates and equity curve.  This is a hard
// filter — there is no archive view of pre-epoch P&L on the dashboard
// (the trades table itself retains everything).
//
// STARTING_BANKROLL_USD anchors the equity curve.  Match what the bot
// is actually configured to risk against — bot/config.py BANKROLL_USD
// or whatever bankroll_usd is in dashboard_export's payload.

export const TRACKING_EPOCH_START = '2026-05-09T16:30:00Z';
export const STARTING_BANKROLL_USD = 500.0;

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
        in_predictive_90pi,
        threshold_low,
        threshold_high,
        operator,
        low_direction,
        predictive_quantile_p10,
        predictive_quantile_p50,
        predictive_quantile_p90,
        -- PATCHER_2026_05_17_STRATEGY: which decision strategy produced
        -- this trade ('edge_gated' default; 'down_the_line' alt).
        -- Migration 047 added the column on trades; migration 048
        -- exposed it through mv_trades_full.
        strategy
    FROM analytics.mv_trades_full
    ORDER BY decided_at DESC NULLS LAST
    LIMIT $1
  `,
  defaultLimit: 200,
};

// PATCHER_2026_05_17_STRATEGY: per-strategy aggregated PnL.  Powers
// the new side-by-side strategy comparison panel.  Joining on settled
// trades only so both strategies are measured on identical settle
// cycles; open trades aren't directly comparable until they resolve.
export const STRATEGY_COMPARE = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        strategy,
        market_type,
        COUNT(*)                                          AS n_settled,
        SUM(CASE WHEN won = TRUE  THEN 1 ELSE 0 END)      AS n_won,
        SUM(CASE WHEN won = FALSE THEN 1 ELSE 0 END)      AS n_lost,
        COALESCE(SUM(pnl), 0)::REAL                       AS total_pnl_net,
        COALESCE(SUM(pnl_gross), 0)::REAL                 AS total_pnl_gross,
        COALESCE(SUM(intent_size_usd), 0)::REAL           AS total_intent_size_usd,
        COALESCE(SUM(fees_paid), 0)::REAL                 AS total_fees_paid
    FROM analytics.mv_trades_full
    WHERE settled_at IS NOT NULL AND strategy IS NOT NULL
    GROUP BY strategy, market_type
    ORDER BY strategy, market_type
  `,
  // Must be explicit null (NOT undefined) so buildParams returns []
  // and skips binding $1.  The SQL has no placeholder — passing a
  // limit would trip pg with "bind message supplies 1 parameters,
  // but prepared statement requires 0" (visible as a section_errors
  // entry on the dashboard footer 2026-05-21).
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: ATTRIBUTION (mv_pnl_attribution)
// ──────────────────────────────────────────────────────────────────

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
// Section: REALIZED_SUMMARY (per-market totals from mv_trades_full)
// ──────────────────────────────────────────────────────────────────
//
// Tier 1 of the RealizedEdge section.  No closing-line dependency —
// reads settler-truth from mv_trades_full.  Switched from `FROM trades`
// 2026-05-09 because analytics_reader can only see the analytics
// schema (mig 025).

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
    FROM analytics.mv_trades_full
    WHERE settled_at IS NOT NULL
    GROUP BY market_type
    ORDER BY market_type
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: PIPELINE_COUNTS (analytics.v_attribution_pipeline_counts)
// ──────────────────────────────────────────────────────────────────

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
// Section: FORECAST_ERRORS (analytics.forecast_errors)
// ──────────────────────────────────────────────────────────────────
//
// One row per (city, market_type, target_date) with the bot's
// pre-settle mu/sigma vs the canonical observation.  Powers the
// "Forecast Error Watch" panel inside CalibrationPipeline Stage 1.

export const FORECAST_ERRORS_RECENT = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        city,
        market_type,
        target_date,
        bot_mu,
        bot_sigma,
        observed_value,
        error,
        abs_error,
        n_sigma,
        observed_source,
        observed_at,
        computed_at
    FROM analytics.forecast_errors
    WHERE target_date >= CURRENT_DATE - 14
    ORDER BY abs(n_sigma) DESC NULLS LAST
    LIMIT 50
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: FORECAST_VS_SETTLED (analytics.forecast_errors)
// ──────────────────────────────────────────────────────────────────
//
// Per-(city, market_type, target_date) predicted-vs-settled time
// series for the last 21 days.  Powers the Hindsight section's
// 20-city small-multiples view next to the WeatherMap.  Same source
// as FORECAST_ERRORS_RECENT (the worst-miss list), but ordered by
// (city, market_type, target_date) ASC so the JSX can walk each
// city's series in order — and without the abs(n_sigma) sort that
// would otherwise scramble the time axis.

export const FORECAST_VS_SETTLED = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        city,
        market_type,
        target_date,
        bot_mu,
        bot_sigma,
        observed_value,
        error,
        abs_error,
        n_sigma,
        observed_source,
        observed_at
    FROM analytics.forecast_errors
    WHERE target_date >= CURRENT_DATE - 21
    ORDER BY city, market_type, target_date ASC
    LIMIT 2000
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: MAP_MARKET_TODAY (analytics.v_map_market_today)
// ──────────────────────────────────────────────────────────────────
//
// Live Kalshi prices per (city, market_type) for the at-the-money
// strike.  Powers the MARKET mode of the WeatherMap section.  See
// migration 041_v_map_market_today_view.sql.

export const MAP_MARKET_TODAY = {
  sql: `
    SELECT
        _mv_refreshed_at,
        city,
        market_type,
        ticker,
        target_date,
        yes_bid_cents,
        yes_ask_cents,
        yes_bid,
        yes_ask,
        yes_mid,
        floor_strike,
        cap_strike,
        strike_mid,
        mu_cal,
        strike_distance_from_mu,
        volume_24h,
        open_interest,
        fetched_at
    FROM analytics.v_map_market_today
    ORDER BY city, market_type
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: BANKROLL_SUMMARY (single-row aggregate)
// ──────────────────────────────────────────────────────────────────
//
// Aggregates over mv_trades_full filtered to (mode IN paper/live) and
// (decided_at >= TRACKING_EPOCH_START).  The mode CHECK constraint on
// trades guarantees mode ∈ {'paper','live','shadow'} so the IN-list
// here is exhaustive of modes we want to track.
//
// The trade_status CHECK constraint guarantees status ∈ {'open',
// 'submitted','partial','filled','rejected','cancelled','win','loss',
// 'void'}.  For paper trades the lifecycle is open → win|loss|void
// so `trade_status = 'open'` correctly identifies at-risk paper bets.

export const BANKROLL_SUMMARY = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        '${TRACKING_EPOCH_START}'::TIMESTAMPTZ            AS tracking_epoch_start,
        ${STARTING_BANKROLL_USD}::REAL                    AS starting_bankroll,

        COUNT(*)                                          AS n_trades,
        COUNT(*) FILTER (WHERE settled_at IS NOT NULL)    AS n_settled,
        COUNT(*) FILTER (WHERE settled_at IS NULL
                          AND trade_status = 'open')      AS n_open,
        COUNT(*) FILTER (WHERE won = TRUE)                AS n_won,
        COUNT(*) FILTER (WHERE won = FALSE)               AS n_lost,

        COUNT(*) FILTER (WHERE mode = 'paper')            AS n_paper,
        COUNT(*) FILTER (WHERE mode = 'live')             AS n_live,

        COALESCE(SUM(pnl)
          FILTER (WHERE settled_at IS NOT NULL), 0)::REAL AS total_pnl_net,
        COALESCE(SUM(pnl_gross)
          FILTER (WHERE settled_at IS NOT NULL), 0)::REAL AS total_pnl_gross,
        COALESCE(SUM(fees_paid)
          FILTER (WHERE settled_at IS NOT NULL), 0)::REAL AS total_fees,

        COALESCE(SUM(pnl)
          FILTER (WHERE settled_at IS NOT NULL
                    AND mode = 'paper'), 0)::REAL        AS pnl_paper,
        COALESCE(SUM(pnl)
          FILTER (WHERE settled_at IS NOT NULL
                    AND mode = 'live'), 0)::REAL         AS pnl_live,

        COALESCE(SUM(intent_size_usd)
          FILTER (WHERE settled_at IS NOT NULL), 0)::REAL AS total_size_settled,
        COALESCE(SUM(intent_size_usd)
          FILTER (WHERE settled_at IS NULL
                    AND trade_status = 'open'), 0)::REAL AS total_size_open

    FROM analytics.mv_trades_full
    WHERE mode IN ('paper', 'live')
      AND decided_at >= '${TRACKING_EPOCH_START}'::TIMESTAMPTZ
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: BANKROLL_CURVE (per-settled-trade equity-curve points)
// ──────────────────────────────────────────────────────────────────
//
// One row per settled trade, ordered ASC by settled_at so the JSX
// can walk it once accumulating cumulative P&L.  Limit 5000 is well
// above expected volume (current scale: ~500 settled trades total)
// while bounding payload size.

export const BANKROLL_CURVE = {
  sql: `
    SELECT
        now() AS _mv_refreshed_at,
        trade_id,
        decided_at,
        settled_at,
        mode,
        market_type,
        city,
        bet_side,
        intent_size_usd,
        pnl,
        pnl_gross,
        won
    FROM analytics.mv_trades_full
    WHERE mode IN ('paper', 'live')
      AND settled_at IS NOT NULL
      AND decided_at >= '${TRACKING_EPOCH_START}'::TIMESTAMPTZ
    ORDER BY settled_at ASC
    LIMIT 5000
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: VIGIL_EMOS (emos_fits_v2 — active fits only)
// ──────────────────────────────────────────────────────────────────

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
// Section: SOURCE SKILL (analytics.v_source_skill_drift)
// ──────────────────────────────────────────────────────────────────
//
// 30-day skill from mv_source_skill_30d joined with a fresh 7-day
// window so the dashboard can highlight sources whose RMSE is
// drifting upward (degrading) vs their 30-day baseline.

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
        n_paired_tmin,
        n_paired_7d,
        bias_7d,
        rmse_7d,
        mae_7d,
        rmse_drift,
        rmse_drift_pct
    FROM analytics.v_source_skill_drift
    ORDER BY rmse ASC NULLS LAST
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: FORECAST_SKILL (mv_forecast_skill — per-cell DTL throttle)
// ──────────────────────────────────────────────────────────────────
//
// Drives the DTL Kelly multiplier in core/decision/skill_score.py.
// Each row is one (city, market_type) cell's rolling MAE against
// settled v2 trades.  The dashboard ForecastSkill panel sorts by
// mae_7d_cal DESC so the worst-performing (bleeding) cells surface
// first.  Refreshes every 5 min via pg_cron (migration 054).

export const FORECAST_SKILL = {
  sql: `
    SELECT
        refreshed_at AS _mv_refreshed_at,
        city,
        market_type,
        n_settled_7d,
        n_settled_14d,
        mae_7d_cal,
        mae_14d_cal,
        mae_7d_raw,
        bias_7d_cal
    FROM analytics.mv_forecast_skill
    ORDER BY mae_7d_cal DESC NULLS LAST
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: DECISIONS FUNNEL (mv_decisions_v2_funnel_30d)
//
// Rewrote 2026-05-18 (DECISION_ENGINE=v2 rollout).  Previously read
// analytics.mv_signals_funnel_30d (now deprecated -- backed by the
// wiped signals table + legacy SKIP_* codes from analyzer.analyze()).
// The new MV is driven by decisions_v2 (one row per DecisionEngine
// output, trade or pass) and uses the v2 gate names (G1..G7).
//
// Slug stays `signals` for back-compat with the page route /api/
// dashboard/signals.  Inside, columns are renamed at the SQL level
// to fit DecisionsRendered.jsx's existing prop shape where the
// semantics align; new columns added for the v2-specific features
// (regret_rate, n_resolved_for_regret, p_yes_lcb).
// ──────────────────────────────────────────────────────────────────

export const SIGNALS_FUNNEL = {
  sql: `
    SELECT
        NOW()                 AS _mv_refreshed_at,
        NOW()                 AS lookback_window_end,
        NOW() - INTERVAL '30 days' AS lookback_window_start,
        decision_code         AS decision,
        market_type,
        n                     AS n_signals,
        n_with_trade          AS n_taken,
        (n - n_with_trade)    AS n_skipped,
        avg_p_cal             AS mean_our_prob,
        NULL::real            AS mean_market_prob,
        -- p_yes_lcb × 100, presented in the same column as the legacy
        -- mean_edge_pct so the JSX can still sort by "how confident
        -- the engine WANTED to bet" without renaming.  Reframed in
        -- the panel header as "p_lcb" not "edge".
        (avg_p_lcb * 100)::real AS mean_edge_pct,
        NULL::real            AS mean_confidence,
        n_resolved_for_regret AS n_with_cf,
        CASE
            WHEN n_resolved_for_regret > 0 AND decision_code != 'TRADE'
            THEN 1.0 - (n_regret_misses::real / n_resolved_for_regret::real)
            WHEN n_settled > 0 AND decision_code = 'TRADE'
            THEN n_wins::real / n_settled::real
            ELSE NULL
        END                   AS cf_win_rate,
        realized_pnl          AS cf_total_pnl,
        NULL::real            AS skipped_cf_pnl,
        -- New v2-specific columns the JSX can use directly
        n_regret_misses,
        n_resolved_for_regret,
        avg_p_lcb,
        n_wins,
        n_settled
    FROM analytics.mv_decisions_v2_funnel_30d
    ORDER BY n DESC
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
// Section: LIVE_FILL_V2_SUMMARY
// ──────────────────────────────────────────────────────────────────
//
// One row per active live-fill v2 account (just 'me' for now).
// Surfaces the v2-specific state that the legacy Bankroll query
// doesn't know about:
//   * Simulated cash balance from account_balances.cash_cents
//   * v2 trade counts by status
//   * v2 P&L (account_id IS NOT NULL filter)
//   * CLV stats (n_with_mid, avg_clv, positive_pct) — the §22.6
//     Phase 1 exit-criterion-3 alpha test
//   * Rejection breakdown — recent rejections grouped by reason
//   * Stack health markers — most recent lifecycle event timestamps
//     so the dashboard can show "v2 stack last heard from at T"

export const LIVE_FILL_V2_SUMMARY = {
  sql: `
    WITH
    -- Per-account state from the accounts + settings + balances tables
    acct AS (
      SELECT
        a.account_id,
        a.status                AS account_status,
        a.environment,
        s.fill_mode,
        s.bankroll_usd          AS bankroll_config_usd,
        s.scale_pct,
        s.max_daily_loss_usd,
        s.max_open_exposure_usd,
        s.max_daily_notional_usd,
        s.low_fund_hard_usd,
        s.low_fund_floor_usd,
        b.cash_cents,
        b.open_exposure_cents,
        b.resting_order_cents,
        b.realized_pnl_today    AS realized_pnl_today_cents,
        b.refreshed_at          AS balance_refreshed_at
      FROM accounts a
      JOIN account_settings s USING (account_id)
      LEFT JOIN account_balances b USING (account_id)
      WHERE a.account_id = 'me'
    ),
    -- v2 trade counts (account_id IS NOT NULL)
    v2_trades AS (
      SELECT
        COUNT(*)                                       AS n_total,
        COUNT(*) FILTER (WHERE status = 'open')        AS n_open,
        COUNT(*) FILTER (WHERE status = 'win')         AS n_won,
        COUNT(*) FILTER (WHERE status = 'loss')        AS n_lost,
        COUNT(*) FILTER (WHERE status = 'void')        AS n_void,
        COALESCE(SUM(pnl) FILTER (WHERE status IN ('win','loss','void')),
                 0)::REAL                              AS pnl_total,
        COALESCE(SUM(intent_size_usd)
                 FILTER (WHERE status = 'open'),
                 0)::REAL                              AS wagered_open,
        COALESCE(SUM(intent_size_usd)
                 FILTER (WHERE status IN ('win','loss','void')),
                 0)::REAL                              AS wagered_settled
      FROM trades
      WHERE account_id = 'me'
    ),
    -- CLV signal — the alpha test (Phase 1 exit criterion 3)
    v2_clv AS (
      SELECT
        COUNT(*) FILTER (WHERE closing_line_mid IS NOT NULL)
                                                       AS n_with_mid,
        ROUND(AVG(CASE
          WHEN bet_side = 'YES' THEN closing_line_mid - intent_price
          WHEN bet_side = 'NO'  THEN (1 - closing_line_mid) - intent_price
        END)::NUMERIC, 4)::REAL                        AS avg_clv,
        COUNT(*) FILTER (
          WHERE closing_line_mid IS NOT NULL
            AND CASE
              WHEN bet_side = 'YES' THEN closing_line_mid - intent_price
              WHEN bet_side = 'NO'  THEN (1 - closing_line_mid) - intent_price
            END > 0
        )                                              AS n_clv_positive
      FROM trades
      WHERE account_id = 'me'
        AND closing_line_mid IS NOT NULL
    ),
    -- Rejection breakdown (last 24h)
    v2_rejects AS (
      SELECT
        COUNT(*)                                       AS n_rejected_24h,
        COUNT(DISTINCT rejection_reason)               AS n_distinct_reasons
      FROM orders
      WHERE account_id = 'me'
        AND status = 'rejected'
        AND submitted_at > now() - INTERVAL '24 hours'
    ),
    -- Last lifecycle event (stack heartbeat proxy)
    v2_lifecycle AS (
      SELECT MAX(observed_at) AS last_lifecycle_event_at
      FROM order_lifecycle_events e
      JOIN orders o ON o.order_id = e.order_id
      WHERE o.account_id = 'me'
    )

    SELECT
      now() AS _refreshed_at,
      acct.*,
      v2_trades.n_total                                AS v2_n_total,
      v2_trades.n_open                                 AS v2_n_open,
      v2_trades.n_won                                  AS v2_n_won,
      v2_trades.n_lost                                 AS v2_n_lost,
      v2_trades.n_void                                 AS v2_n_void,
      v2_trades.pnl_total                              AS v2_pnl_total,
      v2_trades.wagered_open                           AS v2_wagered_open,
      v2_trades.wagered_settled                        AS v2_wagered_settled,
      v2_clv.n_with_mid                                AS v2_clv_n_with_mid,
      v2_clv.avg_clv                                   AS v2_clv_avg,
      v2_clv.n_clv_positive                            AS v2_clv_n_positive,
      v2_rejects.n_rejected_24h                        AS v2_n_rejected_24h,
      v2_rejects.n_distinct_reasons                    AS v2_reject_reasons,
      v2_lifecycle.last_lifecycle_event_at             AS v2_last_lifecycle_at
    FROM acct
    CROSS JOIN v2_trades
    CROSS JOIN v2_clv
    CROSS JOIN v2_rejects
    CROSS JOIN v2_lifecycle
  `,
  defaultLimit: null,
};

// ──────────────────────────────────────────────────────────────────
// Section: LIVE_FILL_V2_REJECTS — recent rejection counts by reason
// ──────────────────────────────────────────────────────────────────
//
// Used by the v2 panel to show WHY the risk gate is rejecting
// intents (which §4 rule fired most often).  Plan §10.1 "Today's
// Rejections" panel.

export const LIVE_FILL_V2_REJECTS = {
  sql: `
    SELECT
      rejection_reason,
      COUNT(*)::INT                                    AS n,
      MIN(submitted_at)                                AS first_at,
      MAX(submitted_at)                                AS last_at
    FROM orders
    WHERE account_id = 'me'
      AND status = 'rejected'
      AND submitted_at > now() - INTERVAL '24 hours'
    GROUP BY rejection_reason
    ORDER BY n DESC
    LIMIT 20
  `,
  defaultLimit: null,
};


// ──────────────────────────────────────────────────────────────────
// Section catalog — used by the [section] dynamic route to dispatch
// a path-segment to a query.  Keys are URL-safe; values are query
// definitions.
// ──────────────────────────────────────────────────────────────────

export const SECTION_QUERIES = {
  bankroll_summary: { ...BANKROLL_SUMMARY,     name: 'bankroll_summary' },
  bankroll_curve:   { ...BANKROLL_CURVE,       name: 'bankroll_curve' },
  live_fill_v2:     { ...LIVE_FILL_V2_SUMMARY, name: 'live_fill_v2' },
  live_fill_v2_rejects: { ...LIVE_FILL_V2_REJECTS, name: 'live_fill_v2_rejects' },
  trades:           { ...TRADES_RECENT,        name: 'trades' },
  attribution:      { ...ATTRIBUTION_RECENT,   name: 'attribution' },
  realized_summary: { ...REALIZED_SUMMARY,     name: 'realized_summary' },
  // PATCHER_2026_05_17_STRATEGY: side-by-side comparison of decision
  // strategies (edge_gated vs down_the_line) so dashboards can prove
  // which path is producing better PnL/ROI in production.
  strategy_compare: { ...STRATEGY_COMPARE,     name: 'strategy_compare' },
  pipeline_counts:  { ...PIPELINE_COUNTS,      name: 'pipeline_counts' },
  map:              { ...MAP_TODAY,            name: 'map' },
  map_market:       { ...MAP_MARKET_TODAY,     name: 'map_market' },
  vigil_emos:       { ...VIGIL_EMOS,           name: 'vigil_emos' },
  vigil_isotonic:   { ...VIGIL_ISOTONIC,       name: 'vigil_isotonic' },
  vigil_biases:     { ...VIGIL_BIASES,         name: 'vigil_biases' },
  calibration:      { ...CALIBRATION_BUCKETS,  name: 'calibration' },
  sources:          { ...SOURCE_SKILL,         name: 'sources' },
  forecast_skill:   { ...FORECAST_SKILL,       name: 'forecast_skill' },
  forecast_errors:  { ...FORECAST_ERRORS_RECENT, name: 'forecast_errors' },
  forecast_vs_settled: { ...FORECAST_VS_SETTLED, name: 'forecast_vs_settled' },
  signals:          { ...SIGNALS_FUNNEL,       name: 'signals' },
  health:           { ...API_HEALTH,           name: 'health' },
  coverage:         { ...CLOSING_LINE_COVERAGE,name: 'coverage' },
  completeness:     { ...DATA_COMPLETENESS,    name: 'completeness' },
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
