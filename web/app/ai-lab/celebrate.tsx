import type { CSSProperties } from 'react';

const SPARKS = Array.from({ length: 10 }, (_, index) => {
  const angle = (index / 10) * Math.PI * 2;
  const distance = index % 2 ? 46 : 34;
  return [Math.round(Math.cos(angle) * distance), Math.round(Math.sin(angle) * distance)];
});

/** A verified publish: a stamped check, a square shockwave and flying pixels. Decorative only. */
export function Celebrate() {
  return (
    <span className="celebrate" aria-hidden="true">
      <span className="celebrate__ring" />
      {SPARKS.map(([dx, dy], index) => (
        <span
          key={index}
          className="celebrate__spark"
          style={{ '--burst-x': `${dx}px`, '--burst-y': `${dy}px` } as CSSProperties}
        />
      ))}
      <span className="celebrate__check">✓</span>
    </span>
  );
}
