import { Fraunces, JetBrains_Mono, Cormorant_SC } from 'next/font/google';
import './globals.css';

// ── Display: Fraunces ─────────────────────────────────────────────
// Serif, with extreme contrast at heavy weights.  Used for hero
// numerics ("$612.47") and major section headers.  Variable font:
// the optical-size axis (opsz) auto-adjusts so 11pt and 64pt look
// correctly proportioned.  No weight array — variable fonts deliver
// every weight automatically.
const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz', 'SOFT'],
});

// ── Data: JetBrains Mono ──────────────────────────────────────────
// Variable-width monospace.  All numbers, table cells, code,
// timestamps.  Slightly narrower than IBM Plex Mono, slightly
// less geometric than Fira.  Variable font; weight array would
// trigger the same conflict, so we omit it.
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
});

// ── Inscription: Cormorant Small Caps ─────────────────────────────
// Roman serif small caps.  Used for section invocations
// ("ORACULAR CALIBRATION", "TRIBUTARY ENSEMBLE").  Reads as temple
// inscription rather than UI label.  Cormorant SC is a static
// font (not variable), so we DO list explicit weights here.
const cormorantSc = Cormorant_SC({
  variable: '--font-inscription',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600'],
});

export const metadata = {
  title: 'Adekagagwaa · Lord of the Weather',
  description: 'Weather prediction market dashboard — paper trading edge analytics',
};

export const viewport = {
  themeColor: '#0a0e14',
};

export default function RootLayout({ children }) {
  const fontVars = `${fraunces.variable} ${jetbrainsMono.variable} ${cormorantSc.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
