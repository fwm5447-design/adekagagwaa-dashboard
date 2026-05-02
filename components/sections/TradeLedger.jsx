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
 * Row reveal includes:
 *   - Decision context: predictive_mu, predictive_sigma, our_prob,
 *     market_prob, edge_pct, confidence, grade_reason
 *   - Realization: actual_value, won, pnl, crps_cal, crps_skill,
 *     50% PI coverage flag, 90% PI coverage flag
 */
export default function TradeLedger({ rows = [], freshness }) {
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterGrade, setFilterGrade] = useState('all');
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
    const s = new Set(rows.map((r) => String(r.grade || ''))); s.delete('');
    return ['all', ...[...s].sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterType !== 'all' && String(r.market_type) !== filterType) return false;
      if (filterStatus !== 'all' && String(r.trade_status) !== filterStatus) return false;
      if (filterGrade !== 'all' && String(r.grade) !== filterGrade) return false;
      return true;
    });
  }, [rows, filterType, filterStatus, filterGrade]);

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
              <SortHeader label="decided"  col="decided_at"   sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="market"   col="market_type"  sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="city"     col="city"         sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="target"   col="target_date"  sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="side"     col="bet_side"     sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="grade"    col="grade"        sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="our P"    col="our_prob_cal" sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="mkt P"    col="market_prob"  sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="edge"     col="edge_pct"     sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="size"     col="intent_size_usd" sort={sort} onClick={toggleSort} align="right" />
              <SortHeader label="status"   col="trade_status" sort={sort} onClick={toggleSort} align="left" />
              <SortHeader label="P&L"      col="pnl"          sort={sort} onClick={toggleSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={12} style={S.tdEmpty}>No trades match the current filters.</td></tr>
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
  return (
    <>
      <tr style={S.tbodyRow} onClick={onToggle}>
        <td style={S.tdLeft}>
          <span className="numeric" style={{ fontSize: 11 }}>
            {fmtTimestampShort(r.decided_at)}
          </span>
        </td>
        <td style={S.tdLeft}>{r.market_type || '—'}</td>
        <td style={S.tdLeft}>{r.city || '—'}</td>
        <td style={S.tdLeft}>
          <span className="numeric" style={{ fontSize: 11 }}>
            {(r.target_date || r.target_month || '').toString().slice(0, 10) || '—'}
          </span>
        </td>
        <td style={S.tdLeft}>{r.bet_side || '—'}</td>
        <td style={S.tdLeft}>
          {r.grade && <StatusPill value="open" size="compact">{r.grade}</StatusPill>}
        </td>
        <td style={S.tdRight}>{fmtProb(r.our_prob_cal)}</td>
        <td style={S.tdRight}>{fmtProb(r.market_prob)}</td>
        <td style={{ ...S.tdRight, color: edgeColor(r.edge_pct) }}>{fmtPctNumber(r.edge_pct)}</td>
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
          <td colSpan={12} style={S.expandCell}>
            <div style={S.expandGrid}>
              <Detail label="trade id"     value={r.trade_id} mono />
              <Detail label="ticker"       value={r.ticker} mono />
              <Detail label="grade reason" value={r.grade_reason} />
              <Detail label="μ predictive · cal" value={fmtNumeric(r.predictive_mu_cal, 2)} />
              <Detail label="σ predictive · cal" value={fmtNumeric(r.predictive_sigma_cal, 2)} />
              <Detail label="confidence"   value={fmtNumeric(r.confidence, 3)} />
              <Detail label="intent price · ¢" value={fmtNumeric(r.intent_price, 0)} />
              <Detail label="CLV · ¢"      value={fmtSignedNumeric(r.clv_cents, 1)} />
              <Detail label="actual"       value={fmtNumeric(r.actual_value, 2)} />
              <Detail label="won"          value={r.won == null ? '—' : (r.won ? 'yes' : 'no')} />
              <Detail label="CRPS · cal"   value={fmtNumeric(r.crps_cal, 4)} />
              <Detail label="CRPSS"        value={fmtNumeric(r.crps_skill_score, 3)} />
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
              <Detail label="settled"      value={fmtTimestampShort(r.settled_at)} />
            </div>
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
  },
  tdRight: {
    textAlign: 'right',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--cloud-haze)',
  },
  tdEmpty: {
    textAlign: 'center', padding: 'var(--space-5)',
    color: 'var(--cloud-mute)', fontStyle: 'italic',
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
