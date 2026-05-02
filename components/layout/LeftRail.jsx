'use client';

import FreshnessLamp from '../primitives/FreshnessLamp';

/**
 * LeftRail — fixed-position section navigator.
 *
 * Lives in the left margin of the dashboard.  Each entry is a link
 * to the section anchor with a freshness lamp that lights green/
 * amber/violet/coral based on _mv_refreshed_at age.
 *
 * Smooth-scrolls on click via standard hash anchors.  The active
 * section highlights via IntersectionObserver, set up in the
 * dashboard.jsx parent.
 */
export default function LeftRail({ sections, freshness, activeId, onLogout }) {
  return (
    <nav style={S.rail} aria-label="Dashboard sections">
      <div style={S.brand}>
        <div className="inscription" style={S.brandInscription}>
          Adekagagwaa
        </div>
        <div style={S.brandTitle}>Lord of the Weather</div>
      </div>

      <ul style={S.list}>
        {sections.map((s) => {
          const isActive = s.id === activeId;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                style={{
                  ...S.link,
                  ...(isActive ? S.linkActive : null),
                }}
                aria-current={isActive ? 'true' : undefined}
              >
                <FreshnessLamp
                  refreshedAt={freshness?.[s.freshnessKey]}
                  expectedCadenceSec={s.expectedCadenceSec}
                  size={6}
                />
                <span style={S.linkLabel}>{s.label}</span>
              </a>
            </li>
          );
        })}
      </ul>

      <button onClick={onLogout} style={S.logout} type="button">
        Sign out
      </button>
    </nav>
  );
}

const S = {
  rail: {
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: 'var(--rail-width)',
    padding: 'var(--space-7) var(--space-4) var(--space-5)',
    background: 'var(--ink-deep)',
    borderRight: '1px solid var(--rule-faint)',
    display: 'flex',
    flexDirection: 'column',
    zIndex: 10,
    overflow: 'auto',
  },
  brand: {
    marginBottom: 'var(--space-6)',
    paddingBottom: 'var(--space-4)',
    borderBottom: '1px solid var(--rule-faint)',
  },
  brandInscription: {
    color: 'var(--dawn-gold)',
    letterSpacing: '0.20em',
    marginBottom: 'var(--space-1)',
  },
  brandTitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    lineHeight: 1.2,
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    flex: 1,
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-2)',
    marginBottom: 1,
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-haze)',
    borderLeft: '2px solid transparent',
    transition: 'color var(--motion-quick), border-color var(--motion-quick), background var(--motion-quick)',
  },
  linkActive: {
    color: 'var(--cloud-pearl)',
    borderLeftColor: 'var(--dawn-gold)',
    background: 'rgba(212, 164, 74, 0.04)',
  },
  linkLabel: {
    fontWeight: 500,
    letterSpacing: '0.01em',
  },
  logout: {
    marginTop: 'var(--space-4)',
    padding: 'var(--space-2) var(--space-3)',
    background: 'transparent',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--cloud-mute)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-micro)',
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    transition: 'color var(--motion-quick), border-color var(--motion-quick)',
  },
};
