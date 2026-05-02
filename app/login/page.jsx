'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * /login — one-time password authentication.
 *
 * On submit, POSTs to /api/auth/login.  On success, the route
 * handler sets an HTTP-only signed JWT cookie and we redirect to
 * the original destination (or '/' if none).  On failure, we
 * surface the error and let the user retry.
 */
function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get('from') || '/';

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = 'Adekagagwaa · Lord of the Weather';
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });
      if (res.status === 204) {
        router.replace(from);
        return;
      }
      if (res.status === 401) {
        setError('Incorrect password.');
      } else {
        const text = await res.text().catch(() => '');
        setError(`Login failed (HTTP ${res.status}). ${text}`);
      }
    } catch (e) {
      setError(`Network error: ${e.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={S.shell}>
      <div className="atmosphere-cumulus" aria-hidden />
      <div style={S.frame}>
        <div className="inscription" style={S.invocation}>
          Adekagagwaa
        </div>
        <h1 style={S.title}>Lord of the Weather</h1>
        <p style={S.subtitle}>
          The temple gates request a passphrase before the oracle will speak.
        </p>

        <form onSubmit={onSubmit} style={S.form}>
          <label style={S.label} htmlFor="password">
            <span className="eyebrow" style={{ color: 'var(--cloud-mute)' }}>
              passphrase
            </span>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              disabled={submitting}
              style={S.input}
            />
          </label>

          {error && (
            <div style={S.error} role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!password || submitting}
            style={{
              ...S.button,
              ...(submitting || !password ? S.buttonDisabled : null),
            }}
          >
            {submitting ? 'consulting…' : 'enter'}
          </button>
        </form>

        <p style={S.footer}>
          The cookie holds for seven days.  No tracking, no third parties.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={S.shell}><div style={S.frame}>Loading…</div></div>}>
      <LoginInner />
    </Suspense>
  );
}

const S = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-5)',
    position: 'relative',
  },
  frame: {
    width: '100%',
    maxWidth: 460,
    background: 'var(--ink-mid)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-7) var(--space-6)',
    boxShadow: 'var(--shadow-deep)',
    position: 'relative',
    zIndex: 1,
  },
  invocation: {
    color: 'var(--dawn-gold)',
    textAlign: 'center',
    marginBottom: 'var(--space-2)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-display)',
    fontWeight: 500,
    fontStyle: 'italic',
    color: 'var(--cloud-pearl)',
    textAlign: 'center',
    letterSpacing: '-0.02em',
    lineHeight: 1.05,
    marginBottom: 'var(--space-4)',
  },
  subtitle: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-small)',
    color: 'var(--cloud-mute)',
    textAlign: 'center',
    lineHeight: 1.6,
    marginBottom: 'var(--space-6)',
    maxWidth: '36ch',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },
  input: {
    background: 'var(--ink-deep)',
    border: '1px solid var(--rule-mid)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--cloud-pearl)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-base)',
    padding: 'var(--space-3) var(--space-4)',
    outline: 'none',
    transition: 'border-color var(--motion-quick)',
  },
  error: {
    background: 'var(--coral-haze)',
    border: '1px solid rgba(194, 84, 80, 0.40)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    color: 'var(--coral-flare)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--type-small)',
  },
  button: {
    background: 'var(--dawn-gold)',
    color: 'var(--ink-deep)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3) var(--space-5)',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--type-large)',
    fontWeight: 600,
    fontStyle: 'italic',
    letterSpacing: '0.02em',
    cursor: 'pointer',
    transition: 'all var(--motion-quick)',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  footer: {
    fontFamily: 'var(--font-display)',
    fontStyle: 'italic',
    fontSize: 'var(--type-micro)',
    color: 'var(--cloud-mute)',
    textAlign: 'center',
    marginTop: 'var(--space-6)',
  },
};
