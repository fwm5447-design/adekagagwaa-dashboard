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
// 2026-05-25: Bankroll section unified to track ONLY strategy='decision_v2'.
// The pre-cleanup legacy strategies (edge_gated, DTL) were deleted from
// the bot and their P&L doesn't represent anything actionable.  Starting
// bankroll is now read live from account_settings.bankroll_usd (currently
// $1000 — was $800, bumped to $1000 on 2026-05-25 to record a +$200
// deposit cleanly).  STARTING_BANKROLL_USD is kept as a fallback for the
// rare case the query returns no rows.

export const TRACKING_EPOCH_START = '2026-05-09T16:30:00Z';
export const STARTING_BANKROLL_USD = 1000.0;
export const BANKROLL_ACCOUNT_ID    = 'me';
export const BANKROLL_STRATEGY      = 'decision_v2';

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
// 2026-05-25: unified to v2-only.  Aggregates over mv_trades_full
// filtered to (strategy='decision_v2') and (decided_at >= epoch).
// Starting bankroll is read live from account_settings.bankroll_usd
// (with the JS constant as a defensive fallback if the settings row
// is missing).  This matches what the Live-Fill v2 subpanel reads,
// so the two panels now tell the same story.

export const BANKROLL_SUMMARY = {
  sql: `
    WITH cfg AS (
      SELECT
        COALESCE(bankroll_usd, ${STARTING_BANKROLL_USD})::REAL AS bankroll_usd
      FROM account_settings
      WHERE account_id = '${BANKROLL_ACCOUNT_ID}'
    ),
    agg AS (
      SELECT
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
      WHERE account_id = '${BANKROLL_ACCOUNT_ID}'
        AND mode IN ('paper', 'live')
        AND decided_at >= '${TRACKING_EPOCH_START}'::TIMESTAMPTZ
    )
    SELECT
      now() AS _mv_refreshed_at,
      '${TRACKING_EPOCH_START}'::TIMESTAMPTZ            AS tracking_epoch_start,
      (SELECT bankroll_usd FROM cfg)                    AS starting_bankroll,
      agg.*
    FROM agg
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
    WHERE account_id = '${BANKROLL_ACCOUNT_ID}'
      AND mode IN ('paper', 'live')
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
// Section: SELF_CORRECTION (per-cell trading state + bias shift)
// ──────────────────────────────────────────────────────────────────
//
// Powers the SelfCorrection panel (replaces the empty Oracle slot).
// Joins mv_forecast_skill (rolling MAE + bias) with open trade counts
// from the trades table so we can show:
//   * Which (city, market_type) cells are currently TRADING / PARTIAL /
//     SKIP / COLD per the 2026-05-25 tight skill gate
//   * The μ-shift correction the bot is subtracting from each cell's
//     predictive mean (bias_7d_cal — sign-aware: chronically under-
//     predicting cells get μ shifted UP)
//   * Whether a SKIP cell is "healable" (its MAE is mostly bias, so
//     the correction will pull it back into the trading universe
//     within a few days)
//   * Open positions held on each cell right now
//
// The 2°F skip threshold and curve breakpoints below MUST match
// core/decision/skill_score.py — if you change the bot's curve, update
// this CASE expression in the same commit.

export const SELF_CORRECTION = {
  sql: `
    WITH cells AS (
      SELECT
        city, market_type,
        n_settled_7d, mae_7d_cal, bias_7d_cal,
        CASE
          WHEN n_settled_7d < 3 OR mae_7d_cal IS NULL THEN 'COLD'
          WHEN mae_7d_cal >= 2.0                       THEN 'SKIP'
          WHEN mae_7d_cal <= 1.0                       THEN 'TRADE'
          ELSE 'PARTIAL'
        END AS gate,
        CASE
          WHEN n_settled_7d < 3 OR mae_7d_cal IS NULL THEN 0.0
          WHEN mae_7d_cal >= 2.0                       THEN 0.0
          WHEN mae_7d_cal <= 1.0                       THEN 1.0
          ELSE 1.0 - (mae_7d_cal - 1.0)
        END AS kelly_mult,
        -- "Healable" — cell would drop below 2°F after bias correction.
        -- Residual error ≈ MAE - |bias|; if that's < 1°F we expect the
        -- cell to come back online within a few days of fresh forecasts.
        CASE
          WHEN mae_7d_cal IS NOT NULL
           AND bias_7d_cal IS NOT NULL
           AND mae_7d_cal >= 2.0
           AND ABS(bias_7d_cal) > mae_7d_cal - 1.0
          THEN TRUE
          ELSE FALSE
        END AS healable,
        refreshed_at
      FROM analytics.mv_forecast_skill
    ),
    open_counts AS (
      SELECT city, market_type, COUNT(*)::int AS n_open
      FROM trades
      WHERE account_id = 'me' AND status = 'open'
      GROUP BY city, market_type
    )
    SELECT
      c.refreshed_at AS _mv_refreshed_at,
      c.city, c.market_type,
      c.n_settled_7d, c.mae_7d_cal, c.bias_7d_cal,
      c.gate, c.kelly_mult, c.healable,
      COALESCE(o.n_open, 0) AS n_open
    FROM cells c
    LEFT JOIN open_counts o USING (city, market_type)
    ORDER BY
      CASE c.gate
        WHEN 'TRADE'   THEN 1
        WHEN 'PARTIAL' THEN 2
        WHEN 'SKIP'    THEN 3
        ELSE 4
      END,
      c.mae_7d_cal ASC NULLS LAST
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
// Section: HEALTH MONITOR — bot-state observability
// ──────────────────────────────────────────────────────────────────
//
// Four views added 2026-05-23 during the end-to-end pipeline audit:
//   * v_forecast_accuracy_drift_alert — per-cell MAE drift vs baseline
//   * v_cell_pnl_drift                — per-cell realized EV drift
//   * v_orphan_settled_trades         — trades.status='open' but
//                                       settlements row exists (mirror
//                                       bug; reconciler heals every 5min)
//   * v_stuck_unsettled_trades        — settler skipped these entirely
//
// All four are filed under the "health" tile pattern: count + level
// (OK / WARNING / CRITICAL) shown in a single composite panel.  Each
// query returns up to 50 rows so the drill-down view can render.

export const HEALTH_FORECAST_DRIFT = {
  sql: `
    SELECT city, market_type, n_recent, n_baseline,
           mae_recent, mae_baseline, mae_delta_f, pct_worse,
           alert_level
      FROM analytics.v_forecast_accuracy_drift_alert
     ORDER BY
       CASE alert_level
         WHEN 'CRITICAL' THEN 0
         WHEN 'WARNING'  THEN 1
         WHEN 'OK'       THEN 2
         ELSE 3
       END,
       mae_delta_f DESC NULLS LAST
     LIMIT 50
  `,
  defaultLimit: null,
};

// 2026-05-25: now reads from analytics.mv_cell_pnl_drift instead of
// the v_cell_pnl_drift view.  The view scanned signals_with_outcome
// twice (7d + 30-37d windows) at ~80s per dashboard load and stacked
// into a connection-pool DoS on concurrent renders.  The MV is
// refreshed every 15 min via pg_cron job 'phase6_refresh_mv_cell_pnl_drift'
// (offset :02/:17/:32/:47); dashboard reads are now <50ms.
export const HEALTH_PNL_DRIFT = {
  sql: `
    SELECT city, market_type, n_recent, n_baseline,
           "ev_recent_per_$"   AS ev_recent,
           "ev_baseline_per_$" AS ev_baseline,
           "ev_delta_per_$"    AS ev_delta,
           alert_level
      FROM analytics.mv_cell_pnl_drift
     ORDER BY
       CASE alert_level
         WHEN 'CRITICAL' THEN 0
         WHEN 'WARNING'  THEN 1
         WHEN 'OK'       THEN 2
         ELSE 3
       END,
       "ev_delta_per_$" ASC NULLS LAST
     LIMIT 50
  `,
  defaultLimit: null,
};

export const HEALTH_ORPHAN_SETTLEMENTS = {
  sql: `
    SELECT trade_id, target_date, city, market_type, bet_side,
           strategy, settlement_status, latest_won, latest_pnl,
           latest_settled_at, n_settlements
      FROM analytics.v_orphan_settled_trades
     ORDER BY latest_settled_at DESC NULLS LAST
     LIMIT 50
  `,
  defaultLimit: null,
};

export const HEALTH_STUCK_UNSETTLED = {
  sql: `
    SELECT trade_id, target_date, city, market_type, bet_side,
           threshold_low, threshold_high, low_direction, strategy,
           created_at, filled_at,
           ROUND(age_hours::numeric, 1)        AS age_hours,
           days_past_target
      FROM analytics.v_stuck_unsettled_trades
     ORDER BY days_past_target DESC, created_at DESC
     LIMIT 50
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

// ──────────────────────────────────────────────────────────────────
// Section: MENTIONS (kalshi mention-markets, migrations 063-074)
// ──────────────────────────────────────────────────────────────────
//
// Eight parallel queries that drive the Mentions section of the
// dashboard.  Source tables live in `public`; the daily roll-up MV
// lives in `analytics`.  Both are read by the analytics_reader role.
//
// Designed to render cleanly when the runner hasn't been started yet
// (i.e., snapshots/decisions/trades empty) — the section shows seed
// priors + a "runner not yet writing data" state in that case.

// 1. Per-strategy 7-day PnL roll-up (drives the headline tile).
export const MENTIONS_DAILY = {
  sql: `
    SELECT strategy, day, series_ticker, n_trades, n_settled,
           ROUND(pnl_dollars::numeric, 2)       AS pnl_usd,
           ROUND(pnl_gross_dollars::numeric, 2) AS pnl_gross_usd,
           ROUND((win_rate * 100)::numeric, 1)  AS win_pct,
           ROUND(avg_entry_price::numeric, 4)   AS avg_entry_price,
           ROUND(avg_model_p::numeric, 4)       AS avg_model_p,
           NOW() AS _mv_refreshed_at
      FROM analytics.mv_mentions_daily
     WHERE day >= CURRENT_DATE - INTERVAL '14 days'
     ORDER BY day DESC, strategy, series_ticker
     LIMIT 500
  `,
  defaultLimit: null,
};

// 2. Active priors leaderboard.
export const MENTIONS_PRIORS = {
  sql: `
    SELECT strategy, strike_key, side,
           ROUND(alpha::numeric, 2)             AS alpha,
           ROUND(beta::numeric, 2)              AS beta,
           n_observations,
           ROUND(posterior_mean::numeric, 4)    AS posterior_mean,
           ROUND(posterior_ci_lo::numeric, 4)   AS ci_lo,
           ROUND(posterior_ci_hi::numeric, 4)   AS ci_hi,
           status,
           ROUND(shrink_factor::numeric, 3)     AS shrink,
           last_seen_ts,
           NOW() AS _mv_refreshed_at
      FROM mention_strike_priors
     ORDER BY strategy, posterior_mean DESC, strike_key
     LIMIT 200
  `,
  defaultLimit: null,
};

// 3. Recent decisions (last 200 — pass + trade) for the timeline tile.
export const MENTIONS_RECENT_DECISIONS = {
  sql: `
    SELECT id, decided_at, strategy, series_ticker, event_ticker,
           market_ticker, strike_word, strike_key,
           ROUND(model_p_yes::numeric, 4)        AS model_p_yes,
           ROUND(model_p_ci_lo::numeric, 4)      AS model_p_ci_lo,
           ROUND(model_p_ci_hi::numeric, 4)      AS model_p_ci_hi,
           market_yes_bid_c, market_yes_ask_c,
           ROUND(market_implied_p::numeric, 4)   AS market_implied_p,
           bet_side,
           ROUND(edge_pct::numeric, 4)           AS edge_pct,
           ROUND(kelly_fraction::numeric, 4)     AS kelly_fraction,
           ROUND(size_usd::numeric, 2)           AS size_usd,
           ROUND(shrink_applied::numeric, 3)     AS shrink_applied,
           pass_reason, trade_id,
           NOW() AS _mv_refreshed_at
      FROM mention_decisions
     ORDER BY decided_at DESC
     LIMIT 200
  `,
  defaultLimit: null,
};

// 4. Mention paper trades — distinct from the weather trades table
//    because schema/columns differ; render in a separate tile.
export const MENTIONS_TRADES_RECENT = {
  sql: `
    SELECT id, decided_at, settled_at, status, strategy,
           series_ticker, event_ticker, market_id AS market_ticker,
           strike_word, strike_key, bet_side, mode,
           ROUND(intent_price::numeric, 4)        AS intent_price,
           ROUND(intent_size_usd::numeric, 2)     AS size_usd,
           ROUND(our_prob_cal::numeric, 4)        AS our_prob,
           ROUND(market_prob::numeric, 4)         AS market_prob,
           ROUND(edge_pct::numeric, 4)            AS edge_pct,
           actual_value, won,
           ROUND(pnl::numeric, 2)                 AS pnl_usd,
           ROUND(pnl_gross::numeric, 2)           AS pnl_gross_usd,
           NOW() AS _mv_refreshed_at
      FROM trades
     WHERE strategy IN ('nqe_sweep_v1','sports_bandit_v1','trump_recurring_v1',
                        'hannity_cover_v1','brand_launch_v1','trump_poisson_v1',
                        'trump_wide_no_v1','trump_dip_yes_v1')
     ORDER BY decided_at DESC
     LIMIT 100
  `,
  defaultLimit: null,
};

// 5. Brand inventory — Trump-branded nouns the brand_detector found.
export const MENTIONS_BRANDS = {
  sql: `
    SELECT id, brand_phrase, first_seen_ts, first_source, first_url,
           launch_context,
           ROUND(sustained_yes_p::numeric, 3)     AS sustained_yes_p,
           status,
           NOW() AS _mv_refreshed_at
      FROM mention_brand_inventory
     ORDER BY first_seen_ts DESC
     LIMIT 50
  `,
  defaultLimit: null,
};

// 6. Calibration bins for the current 30-day window — reliability diagram input.
export const MENTIONS_CALIBRATION = {
  sql: `
    SELECT strategy, bin_lo, bin_hi, window_start, window_end,
           n_predicted, n_settled, n_yes_actual,
           ROUND(mean_predicted::numeric, 4)      AS mean_predicted,
           ROUND(empirical_rate::numeric, 4)      AS empirical_rate,
           ROUND(brier_score::numeric, 4)         AS brier_score,
           computed_at,
           NOW() AS _mv_refreshed_at
      FROM mention_calibration_bins
     WHERE window_end = (SELECT MAX(window_end) FROM mention_calibration_bins)
     ORDER BY strategy, bin_lo
     LIMIT 200
  `,
  defaultLimit: null,
};

// 7. Universe count — how many series / events / strikes are we watching.
export const MENTIONS_UNIVERSE = {
  sql: `
    SELECT
      COUNT(DISTINCT series_ticker)             AS series_n,
      COUNT(DISTINCT event_ticker)              AS events_n,
      COUNT(DISTINCT market_ticker)             AS markets_n,
      COUNT(*)                                  AS snapshots_total,
      MAX(snapshot_ts)                          AS last_snapshot_ts,
      NOW() AS _mv_refreshed_at
      FROM mention_market_snapshots
     WHERE snapshot_ts >= NOW() - INTERVAL '24 hours'
  `,
  defaultLimit: null,
};

// 8. Corpus freshness — last Truth Social post pulled.
export const MENTIONS_CORPUS_FRESHNESS = {
  sql: `
    SELECT speaker, source,
           COUNT(*)                              AS n_posts_24h,
           MAX(posted_at)                        AS last_posted_at,
           MAX(fetched_at)                       AS last_fetched_at,
           NOW() AS _mv_refreshed_at
      FROM mention_corpus_posts
     WHERE fetched_at >= NOW() - INTERVAL '24 hours'
     GROUP BY speaker, source
     ORDER BY last_posted_at DESC NULLS LAST
     LIMIT 20
  `,
  defaultLimit: null,
};


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
  self_correction:  { ...SELF_CORRECTION,      name: 'self_correction' },
  forecast_errors:  { ...FORECAST_ERRORS_RECENT, name: 'forecast_errors' },
  forecast_vs_settled: { ...FORECAST_VS_SETTLED, name: 'forecast_vs_settled' },
  signals:          { ...SIGNALS_FUNNEL,       name: 'signals' },
  health:           { ...API_HEALTH,           name: 'health' },
  coverage:         { ...CLOSING_LINE_COVERAGE,name: 'coverage' },
  completeness:     { ...DATA_COMPLETENESS,    name: 'completeness' },
  // Bot-state observability (2026-05-23 audit).  Each surfaces a
  // health monitor view created during the end-to-end pipeline audit.
  health_forecast_drift:    { ...HEALTH_FORECAST_DRIFT,    name: 'health_forecast_drift' },
  health_pnl_drift:         { ...HEALTH_PNL_DRIFT,         name: 'health_pnl_drift' },
  health_orphan_settlements:{ ...HEALTH_ORPHAN_SETTLEMENTS,name: 'health_orphan_settlements' },
  health_stuck_unsettled:   { ...HEALTH_STUCK_UNSETTLED,   name: 'health_stuck_unsettled' },

  // Mentions markets (migrations 063-074, bot repo).  All 8 are
  // best-effort — they return 0 rows when the runner hasn't been
  // started, which the Mentions section component handles gracefully.
  mentions_daily:              { ...MENTIONS_DAILY,            name: 'mentions_daily' },
  mentions_priors:             { ...MENTIONS_PRIORS,           name: 'mentions_priors' },
  mentions_recent_decisions:   { ...MENTIONS_RECENT_DECISIONS, name: 'mentions_recent_decisions' },
  mentions_trades:             { ...MENTIONS_TRADES_RECENT,    name: 'mentions_trades' },
  mentions_brands:             { ...MENTIONS_BRANDS,           name: 'mentions_brands' },
  mentions_calibration:        { ...MENTIONS_CALIBRATION,      name: 'mentions_calibration' },
  mentions_universe:           { ...MENTIONS_UNIVERSE,         name: 'mentions_universe' },
  mentions_corpus_freshness:   { ...MENTIONS_CORPUS_FRESHNESS, name: 'mentions_corpus_freshness' },
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
