'use client';

import FreshnessLamp from '../primitives/FreshnessLamp';

/**
 * SectionFrame — the common wrapper every analytics section sits on.
 *
 * Layout:
 *   [eyebrow inscription]            [freshness lamp + age]
 *   Title in display serif
 *   Optional subtitle in serif italic
 *   ────────────────────────────────  rule
 *   <children>
 *
 * Used by every Layer-C section component.  Centralizes the
 * invocation typography so the dashboard reads like a coherent
 * temple log rather than nine independent widgets.
 */
export default function SectionFrame({
  invocation,
  title,
  subtitle,
  freshnessAt,
  freshnessCadenceSec,
  toolbar,
  children,
  id,
}) {
  return (
    <section
      id={id}
      className="surface"
      style={{
        padding: 'var(--space-6) var(--space-6) var(--space-7)',
        marginBottom: 'var(--space-6)',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <header style={S.header}>
        <div style={S.headerLeft}>
          {invocation && (
            <div className="inscription" style={S.invocation}>
              {invocation}
            </div>
          )}
          <h2 style={S.title}>{title}</h2>
          {subtitle && <div style={S.subtitle}>{subtitle}</div>}
        </div>
        <div style={S.headerRight}>
          {toolbar}
          {freshnessAt !== undefined && (
            <div style={S.freshnessWrap}>
              <FreshnessLamp
                refreshedAt={freshnessAt}
                expectedCadenceSec={freshnessCadenceSec}
              />
              <span className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
                {freshnessAt
                  ? new Date(freshnessAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'no data'}
              </span>
            </div>
          )}
        </div>
      </header>
      <div style={S.rule} />
      <div>{children}</div>
    </section>
  );
}

const S = {
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--space-5)',
    marginBottom: 'var(--space-3)',
  },
  headerLeft: {
    flex: '1 1 auto',
    minWidth: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    flexShrink: 0,
  },
  invocation: {
    color: 'var(--dawn-gold)',
    marginBottom: 'var(--space-1)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-xl)',
    fontWeight: 500,
    color: 'var(--cloud-pearl)',
    letterSpacing: '-0.015em',
    lineHeight: 1.15,
    margin: 0,
  },
  subtitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    marginTop: 'var(--space-2)',
    maxWidth: '60ch',
    lineHeight: 1.5,
  },
  freshnessWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
  },
  rule: {
    height: 1,
    background:
      'linear-gradient(90deg, var(--rule-mid) 0%, var(--rule-faint) 100%)',
    margin: 'var(--space-4) 0 var(--space-5)',
  },
};
