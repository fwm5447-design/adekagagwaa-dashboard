/**
 * app/page.jsx — Next.js App Router entry for `/`.
 *
 * This is a thin shim that delegates to the Dashboard orchestrator
 * in app/dashboard.jsx.  Splitting the route entry from the
 * orchestrator keeps the orchestrator's filename ('dashboard.jsx')
 * descriptive while satisfying Next.js's convention that the route
 * for `/` lives at app/page.jsx.
 *
 * page.jsx is implicitly a server component (no 'use client'
 * directive); the imported Dashboard is a client component (it
 * declares 'use client' itself).  Next.js handles the server →
 * client boundary for us.
 */

import Dashboard from './dashboard';

export default function Page() {
  return <Dashboard />;
}
