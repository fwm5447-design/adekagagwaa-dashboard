'use client';

import { useMemo, useState } from 'react';
import SectionFrame from '../layout/SectionFrame';
import StatusPill from '../primitives/StatusPill';

/**
 * TradeLedger — mv_trades_full.
 *
 * The atomic view of every trade with its key decision context.
 * Filterable by market_type, status, grade.  Sortable by any
 * column.  Click a row to expand it for the full lineage.
 *
 * Row columns (13):
 *   decided · market · city · target/strike · side · grade ·
 *   our P · mkt P · edge · forecast · size · status · P&L
 *
 * The target/strike cell stacks the target date over the strike
 * label (e.g. "May 11" / "<54.5°F").  The forecast cell stacks the
 * calibrated predictive mean over its signed delta vs the strike
 * anchor (single-strike → threshold_low; bracket → midpoint).  Both
 * are colored by whether the model is on the bet's winning side at
 * the predictive mean.
 *
 * Row reveal adds:
 *   - Full ticker, spelled-out strike, p10/p50/p90 quantiles
 *   - σ predictive (cal), confidence, grade reason
 *   - Realization: actual, won, CRPS, CRPSS, 50%/90% PI coverage
 */
export default function TradeLedger({ rows = [], freshness }) {
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterGrade, setFilterGrade] = useState('all');
  // Filter by decision strategy.  Values seen in practice:
  //   * 'decision_v2'  — current primary (unified strategy, since 2026-05-23)
  //   * 'down_the_line'/'edge_gated' — historical (pre-unified)
  //   * 'focused_*' — pre-unified FOCUSED tier (rare, mostly legacy)
  // Default 'all' shows everything; the filter values are populated
  // dynamically from data so the user only sees options that exist.
  const [filterStrategy, setFilterStrategy] = useState('all');
  const [sort, setSort] = useState({ col: 'decided_at', dir: 'desc' });
  const [expanded, setExpanded] = useState(null);

  const allTypes = useMemo(() => {
    const s = new Set(rows.map((r) => String(r.market_type || ''))); s.delete('');
    return ['all', ...[...s].sort()];
  }, [rows]);
  const allStatuses = useMemo(() => {
    const s = new Set(rows.map((r) => String(r.trade_status || ''))); s.delete('');
    return ['all', ...[...s].sort()];
  }, [rows]);
  const allGrades = useMemo(() => {
    // Use displayGrade so legacy 'DECISION_V2' marker rows don't
    // pollute the filter dropdown with a non-grade option.
    const s = new Set(rows.map((r) => displayGrade(r.grade) || ''));
    s.delete('');
    return ['all', ...[...s].sort()];
  }, [rows]);
  const allStrategies = useMemo(() => {
    const s = new Set(rows.map((r) => String(r.strategy || ''))); s.delete('');
    return ['all', ...[...s].sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterType !== 'all' && String(r.market_type) !== filterType) return false;
      if (filterStatus !== 'all' && String(r.trade_status) !== filterStatus) return false;
      if (filterGrade !== 'all' && displayGrade(r.grade) !== filterGrade) return false;
      if (filterStrategy !== 'all' && String(r.strategy || 'edge_gated') !== filterStrategy) return false;
      return true;
    });
  }, [rows, filterType, filterStatus, filterGrade, filterStrategy]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      const av = a[sort.col];
      const bv = b[sort.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      const aS = String(av);
      const bS = String(bv);
      return sort.dir === 'asc' ? aS.localeCompare(bS) : bS.localeCompare(aS);
    });
    return out;
  }, [filtered, sort]);

  function toggleSort(col) {
    setSort((cur) => {
      if (cur.col === col) return { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { col, dir: 'desc' };
    });
  }

  return (
    <SectionFrame
      id="ledger"
      invocation="Trade Ledger"
      title="Trade Ledger"
      subtitle="The atomic view.  Every decision the bot rendered, with its forecast context, market state, and realization.  Sort any column; expand a row for the full lineage."
      freshnessAt={freshness}
      freshnessCadenceSec={300 /* 5min */}
    >
      {/* Filter bar */}
      <div style={S.filterBar}>
        <FilterGroup label="market" value={filterType} options={allTypes} onChange={setFilterType} />
        <FilterGroup label="status" value={filterStatus} options={allStatuses} onChange={setFilterStatus} />
        <FilterGroup label="grade"  value={filterGrade}  options={allGrades}  onChange={setFilterGrade} />
        <FilterGroup label="strategy" value={filterStrategy} options={allStrategies} onChange={setFilterStrategy} />
        <div style={S.filterCount}>
          <span className="numeric">
            {fmtInt(sorted.length)}
            <span style={{ color: 'var(--cloud-mute)' }}> / {fmtInt(rows.length)}</span>
          </span>
        </div>
      </div>

      {/* Trade table */}
      <div style={S.tableCard}>
        <table style={S.table}>
          <thead>
            <tr style={S.theadRow}>
              <SortHeader label="decided"         col="decided_at"        sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="market"          col="market_type"       sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="city"            col="city"              sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="target / strike" col="target_date"       sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="side"            col="bet_side"          sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="grade"           col="grade"             sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="strategy"        col="strategy"          sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="our P"           col="our_prob_cal"      sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="mkt P"           col="market_prob"       sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="edge"            col="edge_pct"          sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="forecast"        col="predictive_mu_cal" sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="size"            col="intent_size_usd"   sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="status"          col="trade_status"      sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="P&L"             col="pnl"               sort={sort} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={14} style={S.tdEmpty}>No trades match the current filters.</td></tr>
            )}
            {sorted.map((r) => {
              const id = String(r.trade_id);
              const isOpen = expanded === id;
              const pnl = Number(r.pnl);
              const pnlColor = !Number.isFinite(pnl) ? 'var(--cloud-mute)'
                : pnl > 0 ? 'var(--dawn-gold)'
                : pnl < 0 ? 'var(--storm-violet)'
                : 'var(--cloud-pearl)';
              return (
                <Row
                  key={id}
                  r={r}
                  isOpen={isOpen}
                  pnlColor={pnlColor}
                  onToggle={() => setExpanded(isOpen ? null : id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionFrame>
  );
}

function Row({ r, isOpen, pnlColor, onToggle }) {
  const mention       = isMention(r);
  const tickerForMention = String(r.ticker || r.market_id || '');
  const targetShort   = mention ? mentionSeriesShort(tickerForMention) : fmtTargetShort(r);
  const strikeShort   = mention ? mentionStrikeWord(tickerForMention)  : fmtStrikeLabel(r);
  const strikeLong    = mention ? (mentionStrikeWord(tickerForMention) + ' · ' + tickerForMention) : fmtStrikeLong(r);
  const cityCell      = mention ? (mentionEventShort(tickerForMention) || '—') : (r.city || '—');
  const forecast      = mention ? { line1: '—', line2: null } : fmtForecastCell(r);
  const favorable     = mention ? null : forecastFavorable(r);
  const forecastColor =
    favorable === true  ? 'var(--dawn-gold)' :
    favorable === false ? 'var(--storm-violet)' :
                          'var(--cloud-haze)';
  const dec = isRainm(r) ? 2 : 1;
  const p10 = finiteNum(r.predictive_quantile_p10);
  const p90 = finiteNum(r.predictive_quantile_p90);
  const quantileLine =
    (p10 != null && p90 != null)
      ? `${p10.toFixed(dec)} – ${p90.toFixed(dec)} ${unitLabel(r)}`
      : '—';

  return (
    <>
      <tr style={S.tbodyRow} onClick={onToggle}>
        <td style={S.tdLeft}>
          <span className="numeric" style={{ fontSize: 11 }}>
            {fmtTimestampShort(r.decided_at)}
          </span>
        </td>
        <td style={S.tdLeft}>{r.market_type || '—'}</td>
        <td style={S.tdLeft}>{cityCell}</td>
        <td style={S.tdLeft}>
          <div style={S.stackedCell}>
            <span className="numeric" style={{ fontSize: 11 }}>
              {targetShort}
            </span>
            <span style={S.stackedSub}>{strikeShort}</span>
          </div>
        </td>
        <td style={S.tdLeft}>{r.bet_side || '—'}</td>
        <td style={S.tdLeft}>
          {displayGrade(r.grade) && (
            <StatusPill value="open" size="compact">{displayGrade(r.grade)}</StatusPill>
          )}
        </td>
        <td style={S.tdLeft}>
          <span style={{ fontSize: 11, color: strategyLabel(r.strategy).color }}>
            {strategyLabel(r.strategy).text}
          </span>
        </td>
        <td style={S.tdRight}>{fmtProb(r.our_prob_cal)}</td>
        <td style={S.tdRight}>{fmtProb(r.market_prob)}</td>
        <td style={{ ...S.tdRight, color: edgeColor(r.edge_pct) }}>{fmtPctNumber(r.edge_pct)}</td>
        <td style={{ ...S.tdRight, color: forecastColor }}>
          <div style={S.stackedCellRight}>
            <span className="numeric">{forecast.line1}</span>
            {forecast.line2 && (
              <span style={{ ...S.stackedSub, color: forecastColor, opacity: 0.85 }}>
                {forecast.line2}
              </span>
            )}
          </div>
        </td>
        <td style={S.tdRight}>{fmtDollar(r.intent_size_usd)}</td>
        <td style={S.tdLeft}>
          <StatusPill value={String(r.trade_status || 'open').toLowerCase()} size="compact" />
        </td>
        <td style={{ ...S.tdRight, color: pnlColor, fontWeight: 600 }}>
          {fmtSignedDollar(r.pnl)}
        </td>
      </tr>
      {isOpen && (
        <tr style={{ background: 'var(--ink-mid)' }}>
          <td colSpan={14} style={S.expandCell}>
            {mention
              ? renderMentionDetail(r, strikeLong)
              : renderWeatherDetail(r, strikeLong, quantileLine)}
          </td>
        </tr>
      )}
    </>
  );
}

function FilterGroup({ label, value, options, onChange }) {
  return (
    <div style={S.filterGroup}>
      <span className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</span>
      <div style={S.filterChips}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              ...S.filterChip,
              ...(value === opt ? S.filterChipActive : null),
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortHeader({ label, col, sort, onClick, align }) {
  const active = sort.col === col;
  return (
    <th
      style={align === 'right' ? S.thRight : S.thLeft}
      onClick={() => onClick(col)}
    >
      <span style={{
        cursor: 'pointer',
        userSelect: 'none',
        color: active ? 'var(--dawn-gold)' : 'var(--cloud-mute)',
      }}>
        {label}
        {active && <span style={S.sortArrow}>{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </span>
    </th>
  );
}

// ── Expand-panel renderers (weather vs mention) ───────────────────

function renderWeatherDetail(r, strikeLong, quantileLine) {
  return (
    <div style={S.expandGrid}>
      <Detail label="trade id"           value={r.trade_id} mono />
      <Detail label="ticker"             value={r.ticker} mono />
      <Detail label="strike"             value={strikeLong} />
      <Detail label="grade reason"       value={r.grade_reason} />
      <Detail label="μ predictive · cal" value={fmtNumeric(r.predictive_mu_cal, 2)} />
      <Detail label="σ predictive · cal" value={fmtNumeric(r.predictive_sigma_cal, 2)} />
      <Detail label="p10 – p90"          value={quantileLine} />
      <Detail label="p50"                value={fmtNumeric(r.predictive_quantile_p50, 2)} />
      <Detail label="confidence"         value={fmtNumeric(r.confidence, 3)} />
      <Detail label="intent price"       value={fmtNumeric(r.intent_price, 2)} />
      <Detail label="CLV · ¢"            value={fmtSignedNumeric(r.clv_cents, 1)} />
      <Detail label="actual"             value={fmtNumeric(r.actual_value, 2)} />
      <Detail label="won"                value={r.won == null ? '—' : (r.won ? 'yes' : 'no')} />
      <Detail label="CRPS · cal"         value={fmtNumeric(r.crps_cal, 4)} />
      <Detail label="CRPSS"              value={fmtNumeric(r.crps_skill_score, 3)} />
      <Detail
        label="50% PI"
        value={r.in_predictive_50pi == null ? '—' : (r.in_predictive_50pi ? '✓ within' : '× outside')}
        tone={r.in_predictive_50pi === false ? 'attn' : 'ok'}
      />
      <Detail
        label="90% PI"
        value={r.in_predictive_90pi == null ? '—' : (r.in_predictive_90pi ? '✓ within' : '× outside')}
        tone={r.in_predictive_90pi === false ? 'attn' : 'ok'}
      />
      <Detail label="settled"            value={fmtTimestampShort(r.settled_at)} />
    </div>
  );
}

function renderMentionDetail(r, strikeLong) {
  // Mention trades carry different fields than weather trades.  We surface:
  //   * Strategy + reasoning (model_p, market_p, edge)
  //   * Entry economics (entry price, stake, max loss/win)
  //   * Settlement (settled_at, actual, won, hours-to-settle, PnL)
  // CRPS / quantile / PI fields are weather-only and omitted here.
  const ticker = String(r.ticker || r.market_id || '');
  const ourP = Number(r.our_prob_cal);
  const mktP = Number(r.market_prob);
  const edge = (Number.isFinite(ourP) && Number.isFinite(mktP)) ? (ourP - mktP) : null;
  const entryCents = (Number(r.intent_price) || 0) * 100;
  const stake = Number(r.intent_size_usd);
  const maxWin = stake > 0 && entryCents > 0
    ? (stake * (100 - entryCents) / entryCents)
    : null;
  const settled = r.settled_at ? new Date(r.settled_at) : null;
  const decided = r.decided_at ? new Date(r.decided_at) : null;
  const hoursToSettle = (settled && decided)
    ? ((settled.getTime() - decided.getTime()) / 3600000)
    : null;
  const won = r.won;
  const actualV = r.actual_value;

  return (
    <div style={S.expandGrid}>
      <Detail label="trade id"             value={r.trade_id} mono />
      <Detail label="ticker"               value={ticker} mono />
      <Detail label="strike word"          value={r.strike_word || mentionStrikeWord(ticker)} />
      <Detail label="strike key"           value={r.strike_key} mono />
      <Detail label="strategy"             value={r.strategy} mono />
      <Detail label="side"                 value={r.bet_side}
              tone={r.bet_side === 'YES' ? 'ok' : 'attn'} />

      <Detail label="entry price"          value={entryCents > 0 ? entryCents.toFixed(1) + '¢' : '—'} />
      <Detail label="stake"                value={stake > 0 ? '$' + stake.toFixed(2) : '—'} />
      <Detail label="max win"              value={maxWin != null ? '+$' + maxWin.toFixed(2) : '—'} />
      <Detail label="max loss"             value={stake > 0 ? '−$' + stake.toFixed(2) : '—'} />

      <Detail label="model P(YES)"         value={Number.isFinite(ourP) ? (100*ourP).toFixed(1) + '%' : '—'} />
      <Detail label="market P(YES)"        value={Number.isFinite(mktP) ? (100*mktP).toFixed(1) + '%' : '—'} />
      <Detail
        label="edge"
        value={edge != null ? (edge >= 0 ? '+' : '') + (100*edge).toFixed(1) + 'pp' : '—'}
        tone={edge != null && edge > 0 ? 'ok' : edge != null && edge < 0 ? 'attn' : undefined}
      />

      <Detail label="decided at"           value={fmtTimestampShort(r.decided_at)} mono />
      <Detail label="settled at"           value={settled ? fmtTimestampShort(r.settled_at) : '(open)'} mono />
      <Detail
        label="hours to settle"
        value={hoursToSettle != null ? hoursToSettle.toFixed(1) + 'h' : '—'}
      />

      <Detail
        label="outcome"
        value={won == null ? '(pending)' : (won ? '✅ WIN' : '❌ LOSS')}
        tone={won === true ? 'ok' : won === false ? 'attn' : undefined}
      />
      <Detail
        label="actual value"
        value={actualV == null ? '—' : (Number(actualV) > 0.5 ? '1 (YES)' : '0 (NO)')}
      />
      <Detail
        label="realized PnL"
        value={r.pnl == null ? '—' : (Number(r.pnl) >= 0 ? '+$' : '−$') + Math.abs(Number(r.pnl)).toFixed(2)}
        tone={r.pnl == null ? undefined : Number(r.pnl) > 0 ? 'ok' : 'attn'}
      />

      <Detail label="status"               value={r.trade_status || 'open'} />
    </div>
  );
}

function Detail({ label, value, mono = false, tone }) {
  const valueColor =
    tone === 'attn' ? 'var(--storm-violet)'
    : tone === 'ok' ? 'var(--dawn-gold)'
    : 'var(--cloud-pearl)';
  return (
    <div style={S.detailItem}>
      <span className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>{label}</span>
      <span style={{
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontSize: mono ? 11 : 'var(--type-small)',
        color: valueColor,
        wordBreak: 'break-all',
      }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

// ── Market-shape helpers ─────────────────────────────────────────────

// Grade display helper.  The trades.grade column should hold a
// per-trade conviction letter (A/B/C/D/F) — but the legacy paper-
// trader's execute_v2 path historically hardcoded "DECISION_V2" as
// the grade value (a strategy marker conflated into the grade
// column; see core/paper_trader.py history).  Newer v2-routed
// trades correctly use A/B/C from _TIER_TO_GRADE.
//
// Without filtering, the dashboard rendered "DECISION_V2" as a
// grade pill on every historical row, which is misleading.  This
// helper returns the raw grade only when it's a real letter; else
// null so the pill falls through and the column reads "—".
const _VALID_GRADES = new Set(['A', 'B', 'C', 'D', 'F']);
function displayGrade(raw) {
  const g = String(raw || '').toUpperCase();
  return _VALID_GRADES.has(g) ? g : null;
}

// Strategy label + color.  Maps the strategy column (set by the bot
// when it writes the trade) to a short display label.  The v2
// decision engine stamps 'decision_v2' on every row it produces;
// the tier (down_the_line vs focused_*) is implicit since DTL is
// the v2 default.  Older bot versions stamped 'down_the_line'
// directly, so accept both.
function strategyLabel(s) {
  switch (s) {
    case 'decision_v2':
    case 'down_the_line':
      return { text: 'DTL', color: 'var(--dawn-gold)' };
    case 'focused_conservative':
    case 'focused_standard':
    case 'focused_aggressive':
    case 'conservative':
    case 'standard':
    case 'aggressive':
      return { text: 'FOCUSED', color: 'var(--sky-mist)' };
    case 'edge_gated':
      return { text: 'EG', color: 'var(--cloud-mute)' };
    case null:
    case undefined:
    case '':
      return { text: '—', color: 'var(--cloud-mute)' };
    default:
      return { text: String(s), color: 'var(--cloud-mute)' };
  }
}

function isRainm(r) {
  return String(r.market_type || '').toLowerCase() === 'rainm';
}

// ── Mention market helpers ─────────────────────────────────────────
// Parse KXSERIES-EVENT-STRIKE tickers into display labels so the
// city / target / strike cells aren't empty for mention paper trades
// (which don't carry city/threshold/forecast).

function isMention(r) {
  return String(r.market_type || '').toLowerCase() === 'mention';
}

// Map ticker prefix → display series name.
const MENTION_SERIES_LABELS = {
  KXMLBMENTION:     'MLB',
  KXNBAMENTION:     'NBA',
  KXNHLMENTION:     'NHL',
  KXHANNITYMENTION: 'Hannity',
  KXTRUMPSAY:       'Trump 7d',
  KXTRUMPSAYMONTH:  'Trump 30d',
  KXTRUMPSAYTRUMP:  'Trump brand',
  KXMRBEASTMENTION: 'MrBeast',
};

// Common Kalshi strike-suffix codes → readable strike word.
const MENTION_STRIKE_LABELS = {
  BULL: 'Bullpen', TRIP: 'Triple', DOUB: 'Double Play', TRAD: 'Trade',
  CHAL: 'Challenge', NQE: 'NQE', ROBO: 'Robot', WHAT: 'What a Catch',
  INJU: 'Injury', CROW: 'Crowd', LAR:  "Larry O'Brien", LEGA: 'Legacy',
  GOAT: 'GOAT', WING: 'Wingspan', ALLE: 'Alley-oop',
  CROS: 'Crossbar/Post', GLAS: 'Glass', SHOO: 'Shootout',
  SLEE: 'Sleepy Joe', MELA: 'Melania', BARA: 'Barack',
  TRAN: 'Transgender', HOTT: 'Hottest', MOG:  'Mog',
  DISC: 'Discombobulator', GOLD: 'Golden Dome', MARI: 'Marijuana',
  PERF: 'Perfect Game', BUNT: 'Bunt', OHTA: 'Ohtani', WILD: 'Wild Pitch',
  PITC: 'Pitch Clock', BASE: 'Bases Loaded', GRAN: 'Grand Slam',
  WALK: 'Walk Off', PINC: 'Pinch Hitter', MVP:  'MVP', ERRO: 'Error',
};

function mentionSeriesShort(ticker) {
  if (!ticker) return '—';
  const prefix = String(ticker).split('-')[0];
  return MENTION_SERIES_LABELS[prefix] || prefix.replace(/^KX/,'').replace(/MENTION$/,'');
}

function mentionEventShort(ticker) {
  // KXMLBMENTION-26MAY25NYYKC-TRIP → "26MAY25NYYKC"
  if (!ticker) return '';
  const parts = String(ticker).split('-');
  return parts[1] || '';
}

function mentionStrikeWord(ticker) {
  if (!ticker) return '—';
  const parts = String(ticker).split('-');
  const suffix = parts[parts.length - 1] || '';
  return MENTION_STRIKE_LABELS[suffix] || suffix;
}

function unitLabel(r) {
  return isRainm(r) ? '"' : '°F';
}

function finiteNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Short strike label for the row cell.  Mirrors reporter.py's
 * _trade_threshold_label so the dashboard reads exactly like the
 * Telegram settlement reports.
 *
 * HIGH/LOW:  ">65°F", "<55°F", or "48–52°F" bracket.
 * RAINM:     ">2.5\"", "<1.0\"", "0.5–1.5\"", "=2.5\"", "≥3.0\"".
 */
function fmtStrikeLabel(r) {
  const lo = finiteNum(r.threshold_low);
  const hi = finiteNum(r.threshold_high);
  const mt = String(r.market_type || '').toLowerCase();

  if (mt === 'rainm') {
    const op = String(r.operator || 'above').toLowerCase();
    if (op === 'between' && lo != null && hi != null) return `${lo.toFixed(1)}–${hi.toFixed(1)}"`;
    if (op === 'exactly'  && lo != null)              return `=${lo.toFixed(2)}"`;
    if (op === 'at_least' && lo != null)              return `≥${lo.toFixed(1)}"`;
    if (op === 'below'    && lo != null)              return `<${lo.toFixed(1)}"`;
    if (lo != null)                                   return `>${lo.toFixed(1)}"`;
    return '?';
  }

  if (lo != null && hi != null) return `${lo.toFixed(0)}–${hi.toFixed(0)}°F`;
  if (lo == null)               return '?';
  if (mt === 'low') {
    // Default "above" per the 2026-05-22 Kalshi-spec audit: every
    // LOW-T market on production resolves "if min temp > N → YES".
    // Earlier default "below" caused 6 settled trades to display
    // inverted strike labels (showing "<45°F" when contract was
    // actually ">45°F").
    const dir = String(r.low_direction || 'above').toLowerCase();
    return `${dir === 'above' ? '>' : '<'}${lo.toFixed(0)}°F`;
  }
  return `>${lo.toFixed(0)}°F`;
}

/**
 * Long strike label for the expand panel.  Same semantics as
 * fmtStrikeLabel but spelled out so the row reveal is human-readable
 * without operator-mnemonic translation.
 */
function fmtStrikeLong(r) {
  const lo = finiteNum(r.threshold_low);
  const hi = finiteNum(r.threshold_high);
  const mt = String(r.market_type || '').toLowerCase();

  if (mt === 'rainm') {
    const op = String(r.operator || 'above').toLowerCase();
    if (op === 'between' && lo != null && hi != null) return `between ${lo.toFixed(2)}" and ${hi.toFixed(2)}"`;
    if (op === 'exactly'  && lo != null)              return `exactly ${lo.toFixed(2)}"`;
    if (op === 'at_least' && lo != null)              return `at least ${lo.toFixed(2)}"`;
    if (op === 'below'    && lo != null)              return `below ${lo.toFixed(2)}"`;
    if (lo != null)                                   return `above ${lo.toFixed(2)}"`;
    return '—';
  }

  if (lo != null && hi != null) return `between ${lo.toFixed(1)}°F and ${hi.toFixed(1)}°F`;
  if (lo == null)               return '—';
  if (mt === 'low') {
    // Default "above" — see fmtStrikeLabel for context.
    const dir = String(r.low_direction || 'above').toLowerCase();
    return `${dir} ${lo.toFixed(1)}°F`;
  }
  return `above ${lo.toFixed(1)}°F`;
}

/**
 * Target date / month label for the row cell.  HIGH/LOW use
 * target_date; RAINM uses target_month.  Forces UTC interpretation
 * so a 2026-05-11 ISO date doesn't slide to May 10 in PDT viewers.
 */
function fmtTargetShort(r) {
  if (r.target_date) {
    try {
      const iso = String(r.target_date).slice(0, 10);
      const d = new Date(`${iso}T12:00:00Z`);
      return d.toLocaleString([], {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return String(r.target_date).slice(0, 10);
    }
  }
  if (r.target_month) {
    try {
      const ym = String(r.target_month).slice(0, 7);
      const d = new Date(`${ym}-01T12:00:00Z`);
      return d.toLocaleString([], {
        timeZone: 'UTC',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return String(r.target_month).slice(0, 7);
    }
  }
  return '—';
}

/**
 * Anchor value for the forecast-vs-strike delta.  For one-sided
 * markets, the threshold itself.  For bracket markets, the
 * midpoint between low and high.  Returns null when no usable
 * threshold is present.
 */
function forecastAnchor(r) {
  const lo = finiteNum(r.threshold_low);
  const hi = finiteNum(r.threshold_high);
  if (lo != null && hi != null) return (lo + hi) / 2;
  if (lo != null) return lo;
  return null;
}

/**
 * Two-line forecast cell.  Top: calibrated predictive mean with
 * unit.  Bottom: signed delta vs the strike anchor.  Returns empty
 * line2 when no anchor is available.
 */
function fmtForecastCell(r) {
  const mu = finiteNum(r.predictive_mu_cal);
  if (mu == null) return { line1: '—', line2: '' };

  const unit = unitLabel(r);
  const dec = isRainm(r) ? 2 : 1;
  const line1 = `${mu.toFixed(dec)}${unit}`;

  const anchor = forecastAnchor(r);
  if (anchor == null) return { line1, line2: '' };

  const delta = mu - anchor;
  const sign = delta >= 0 ? '+' : '−';
  return {
    line1,
    line2: `Δ${sign}${Math.abs(delta).toFixed(dec)}`,
  };
}

/**
 * Is the bot's bet_side on the winning side of the strike at the
 * predictive mean?  Returns true (favorable), false (unfavorable),
 * or null (cannot determine — usually missing threshold or
 * unrecognized market shape).  Drives the forecast cell's color
 * (gold favorable, violet unfavorable, neutral otherwise).
 *
 * Mirrors the YES-resolution rules in settler.py — kept identical
 * so the dashboard color matches what the settler will eventually
 * record.
 */
function forecastFavorable(r) {
  const mu = finiteNum(r.predictive_mu_cal);
  const lo = finiteNum(r.threshold_low);
  const hi = finiteNum(r.threshold_high);
  if (mu == null || lo == null) return null;

  const mt = String(r.market_type || '').toLowerCase();
  const side = String(r.bet_side || '').toUpperCase();

  let yesWinsAtMean;
  if (mt === 'rainm') {
    const op = String(r.operator || 'above').toLowerCase();
    if      (op === 'between'  && hi != null) yesWinsAtMean = (mu >= lo && mu < hi);
    else if (op === 'below')                  yesWinsAtMean = (mu <  lo);
    else if (op === 'at_least')               yesWinsAtMean = (mu >= lo);
    else if (op === 'exactly')                yesWinsAtMean = (Math.abs(mu - lo) < 0.005);
    else                                      yesWinsAtMean = (mu >  lo);  // "above"
  } else if (mt === 'high') {
    yesWinsAtMean = (hi != null) ? (mu >= lo && mu < hi) : (mu > lo);
  } else if (mt === 'low') {
    if (hi != null) {
      yesWinsAtMean = (mu >= lo && mu < hi);
    } else {
      const dir = String(r.low_direction || 'below').toLowerCase();
      yesWinsAtMean = dir === 'above' ? (mu > lo) : (mu < lo);
    }
  } else {
    return null;
  }

  if (side === 'YES') return yesWinsAtMean;
  if (side === 'NO')  return !yesWinsAtMean;
  return null;
}

// ── Formatters ───────────────────────────────────────────────────────

function fmtInt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtProb(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(3);
}
function fmtPctNumber(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(1)}%`;
}
function fmtDollar(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `$${Number(v).toFixed(2)}`;
}
function fmtSignedDollar(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const num = Number(v);
  const sign = num >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(num).toFixed(2)}`;
}
function fmtNumeric(v, dec = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(dec);
}
function fmtSignedNumeric(v, dec = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const num = Number(v);
  const sign = num >= 0 ? '+' : '−';
  return `${sign}${Math.abs(num).toFixed(dec)}`;
}
function fmtTimestampShort(v) {
  if (!v) return '—';
  try {
    const d = new Date(v);
    return d.toLocaleString([], {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(v);
  }
}
function edgeColor(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return 'var(--cloud-mute)';
  if (num >= 15) return 'var(--dawn-gold)';
  if (num >= 8) return 'var(--dawn-amber)';
  if (num >= 0) return 'var(--cloud-haze)';
  return 'var(--storm-violet)';
}

const S = {
  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
    paddingBottom: 'var(--space-3)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  },
  filterChips: {
    display: 'flex',
    gap: 'var(--space-1)',
  },
  filterChip: {
    background: 'transparent',
    color: 'var(--cloud-mute)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-pill)',
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    transition: `all var(--motion-quick)`,
  },
  filterChipActive: {
    background: 'rgba(212, 164, 74, 0.16)',
    borderColor: 'var(--dawn-gold)',
    color: 'var(--dawn-gold)',
  },
  filterCount: {
    marginLeft: 'auto',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-pearl)',
  },
  tableCard: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-faint)',
    borderRadius: 'var(--radius-md)',
    padding: 0,
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
    fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    cursor: 'pointer',
  },
  thRight: {
    textAlign: 'right', padding: 'var(--space-2) var(--space-3)',
    fontWeight: 500, fontSize: 'var(--type-micro)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    cursor: 'pointer',
  },
  tbodyRow: {
    borderBottom: '1px solid var(--rule-faint)',
    cursor: 'pointer',
  },
  tdLeft: {
    textAlign: 'left',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-pearl)',
    verticalAlign: 'top',
  },
  tdRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-haze)',
    verticalAlign: 'top',
  },
  tdEmpty: {
    textAlign: 'center', padding: 'var(--space-5)',
    color: 'var(--cloud-mute)', fontStyle: 'italic',
  },
  stackedCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    lineHeight: 1.25,
  },
  stackedCellRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 1,
    lineHeight: 1.25,
  },
  stackedSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--cloud-mute)',
    letterSpacing: '0.02em',
  },
  expandCell: {
    padding: 'var(--space-4) var(--space-5)',
    borderTop: '1px solid var(--rule-faint)',
    borderBottom: '1px solid var(--rule-mid)',
  },
  expandGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 'var(--space-3) var(--space-5)',
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  sortArrow: {
    fontSize: 9,
    fontFamily: 'var(--font-mono)',
  },
};
