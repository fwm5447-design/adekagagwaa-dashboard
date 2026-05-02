'use client';

/**
 * BarometricNeedle — a half-circle gauge that shows a value relative
 * to a reference range.  Used by the Oracle (calibration) section to
 * display reliability divergence at a glance.
 *
 * Visual: 180° arc from min to max, with the arc colored by zone
 * (good / warm / stale / failed using design tokens), a needle
 * pointing at the current value, and tick marks at min, mid, max.
 *
 * Pure SVG.  No animation library.  Re-renders cleanly when value
 * changes.
 */
export default function BarometricNeedle({
  value,
  min = -1,
  max = 1,
  goodRange = [-0.05, 0.05],
  width = 220,
  label,
  unit = '',
  size = 'normal',
}) {
  const isCompact = size === 'compact';
  const w = isCompact ? 160 : width;
  const h = isCompact ? Math.round(w * 0.6) : Math.round(w * 0.65);

  // Arc geometry: bottom-center pivot, 180° span from left to right.
  const cx = w / 2;
  const cy = h - 12;
  const radius = (w / 2) - 16;

  // Clamp value into [min, max] for needle angle.
  const clamped = Math.max(min, Math.min(max, value ?? 0));
  const t = (clamped - min) / (max - min);  // 0..1
  const angleDeg = 180 - (t * 180);          // 180=left, 0=right
  const angleRad = (angleDeg * Math.PI) / 180;

  const needleX = cx + radius * Math.cos(angleRad);
  const needleY = cy - radius * Math.sin(angleRad);

  // Build the colored arc segments.  Three zones: good (green),
  // warm (amber), stale (storm-violet).
  const arcs = buildArcSegments(min, max, goodRange);

  return (
    <div style={{ display: 'inline-block', textAlign: 'center' }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        style={{ display: 'block' }}
      >
        {/* Track */}
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={describeArc(cx, cy, radius, arc.startAngle, arc.endAngle)}
            stroke={arc.color}
            strokeWidth="6"
            fill="none"
            strokeLinecap="butt"
            opacity={0.85}
          />
        ))}

        {/* Tick marks at min, mid, max */}
        {[180, 90, 0].map((deg, i) => {
          const r = (deg * Math.PI) / 180;
          const x1 = cx + (radius - 4) * Math.cos(r);
          const y1 = cy - (radius - 4) * Math.sin(r);
          const x2 = cx + (radius + 4) * Math.cos(r);
          const y2 = cy - (radius + 4) * Math.sin(r);
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="var(--cloud-mute)"
              strokeWidth="1.2"
              opacity={0.55}
            />
          );
        })}

        {/* Needle */}
        <line
          x1={cx} y1={cy} x2={needleX} y2={needleY}
          stroke="var(--cloud-pearl)"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transition: 'all var(--motion-glide)' }}
        />
        <circle cx={cx} cy={cy} r="4.5" fill="var(--cloud-pearl)" />

        {/* Min / max labels */}
        <text
          x="10" y={h - 2}
          fontSize="9.5"
          fontFamily="var(--font-mono)"
          fill="var(--cloud-mute)"
          textAnchor="start"
        >
          {min}{unit}
        </text>
        <text
          x={w - 10} y={h - 2}
          fontSize="9.5"
          fontFamily="var(--font-mono)"
          fill="var(--cloud-mute)"
          textAnchor="end"
        >
          {max > 0 ? '+' : ''}{max}{unit}
        </text>
      </svg>

      {/* Value + label */}
      <div style={{
        marginTop: -10,
        fontFamily: 'var(--font-display)',
        fontSize: isCompact ? 'var(--type-large)' : 'var(--type-xl)',
        color: 'var(--cloud-pearl)',
        fontWeight: 500,
        lineHeight: 1,
      }}>
        {value != null ? `${clamped > 0 ? '+' : ''}${clamped.toFixed(2)}${unit}` : '—'}
      </div>
      {label && (
        <div className="eyebrow" style={{ marginTop: 'var(--space-2)' }}>
          {label}
        </div>
      )}
    </div>
  );
}

function buildArcSegments(min, max, goodRange) {
  // Map: 0..1 (min..max) to angle 180..0
  const anglefor = (v) => 180 - ((v - min) / (max - min)) * 180;

  // Three segments: [min..goodMin] storm-violet, [goodMin..goodMax]
  // dawn-gold, [goodMax..max] storm-violet again.
  const a0 = 180;
  const a1 = anglefor(goodRange[0]);
  const a2 = anglefor(goodRange[1]);
  const a3 = 0;

  return [
    { startAngle: a0, endAngle: a1, color: 'var(--storm-violet)' },
    { startAngle: a1, endAngle: a2, color: 'var(--dawn-gold)' },
    { startAngle: a2, endAngle: a3, color: 'var(--storm-violet)' },
  ];
}

// Standard SVG arc helper.  Angles in degrees.  startAngle is the
// LEFT side of the arc, endAngle the RIGHT side, sweeping clockwise
// in screen coordinates (which is counter-clockwise in math).
function describeArc(cx, cy, r, startAngle, endAngle) {
  const startRad = (startAngle * Math.PI) / 180;
  const endRad   = (endAngle   * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy - r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy - r * Math.sin(endRad);
  // Always small-arc + counterclockwise sweep on screen.  Math y-flip
  // means the SVG sweepFlag is 0 (counter-clockwise in SVG terms).
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const sweep = startAngle > endAngle ? 0 : 1;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
