import { useCallback, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

const GHOSTS = [1, 2, 3, 4];

/**
 * Text or an element trailed by aria-hidden ghost copies, like the recovered dash's afterimages.
 * A pulse replays the dash: the body arrives in 8 steps and the ghosts collapse over 25,
 * matching the component's 8 active ticks and 25-tick recharge.
 */
export function Afterimage({
  children,
  pulse = 0,
  trail = false,
  className,
  style,
}: {
  children: ReactNode;
  /** Increment to replay the dash. Zero renders the resting state. */
  pulse?: number;
  /** Keep a faint static trail while resting. */
  trail?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={
        'afterimage' +
        (trail ? ' afterimage--trail' : '') +
        (pulse > 0 ? ' is-dashing' : '') +
        (className ? ' ' + className : '')
      }
      style={style}
    >
      <span className="afterimage__run" key={pulse}>
        {GHOSTS.map((index) => (
          <span
            key={index}
            className="afterimage__ghost"
            aria-hidden="true"
            style={{ '--i': index } as CSSProperties}
          >
            {children}
          </span>
        ))}
        <span className="afterimage__body">{children}</span>
      </span>
    </span>
  );
}

/** A counter that restarts an afterimage dash each time `trigger` runs. */
export function useDashPulse(): [number, () => void] {
  const [pulse, setPulse] = useState(0);
  const trigger = useCallback(() => setPulse((value) => value + 1), []);
  return [pulse, trigger];
}
