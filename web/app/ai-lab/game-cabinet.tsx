import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { DASH_ACTIVE_TICKS, DASH_RECHARGE_TICKS } from './intent';

interface MotionSample {
  tick?: number;
  core?: { remaining?: number; cooldown?: number };
  state?: { core?: { remaining?: number; cooldown?: number } } | null;
  output?: { ownsMotion?: boolean; events?: string[] } | null;
}

export interface DashReading {
  /** False until the frame reports a component step. */
  known: boolean;
  active: boolean;
  remaining: number;
  cooldown: number | null;
}

const UNKNOWN: DashReading = { known: false, active: false, remaining: 0, cooldown: null };

/** Read the dash state from a frame's motion sample. Generated adapters may omit `core`. */
export function readDash(motion: MotionSample | null | undefined): DashReading {
  if (!motion || !motion.output) return UNKNOWN;
  const core = motion.core ?? motion.state?.core;
  const active = motion.output.ownsMotion === true;
  return {
    known: true,
    active,
    remaining: Math.max(0, Math.min(DASH_ACTIVE_TICKS, Number(core?.remaining ?? 0) || 0)),
    cooldown:
      typeof core?.cooldown === 'number' && Number.isFinite(core.cooldown)
        ? Math.max(0, core.cooldown)
        : null,
  };
}

/** The recovered dash's 8 active ticks and 25-tick recharge, from live frame samples. */
export function DashMeter({
  reading,
  idleLabel = 'WAITING FOR THE FIRST UPDATE',
  readyLabel = 'DASH READY · PRESS X',
}: {
  reading: DashReading;
  idleLabel?: string;
  readyLabel?: string;
}) {
  const recharging = !reading.active && (reading.cooldown ?? 0) > 0;
  const ready = reading.known && !reading.active && !recharging;
  const lit = reading.active
    ? reading.remaining || DASH_ACTIVE_TICKS
    : ready
      ? DASH_ACTIVE_TICKS
      : 0;
  const charge = reading.active
    ? 0
    : recharging
      ? 1 - Math.min(DASH_RECHARGE_TICKS, reading.cooldown ?? 0) / DASH_RECHARGE_TICKS
      : reading.known
        ? 1
        : 0;
  const label = !reading.known
    ? idleLabel
    : reading.active
      ? 'DASH ACTIVE'
      : recharging
        ? `RECHARGING · ${((reading.cooldown ?? 0) / 60).toFixed(2)}s`
        : readyLabel;
  return (
    <div
      className={
        'dash-meter' +
        (reading.active ? ' is-active' : '') +
        (recharging ? ' is-recharging' : '') +
        (ready ? ' is-ready' : '')
      }
    >
      <span className="dash-meter__label">{label}</span>
      <span className="dash-meter__pips" aria-hidden="true">
        {Array.from({ length: DASH_ACTIVE_TICKS }, (_, index) => (
          <span key={index} className={'dash-meter__pip' + (index < lit ? ' is-lit' : '')} />
        ))}
      </span>
      <span className="dash-meter__bar" aria-hidden="true">
        <span className="dash-meter__fill" style={{ transform: `scaleX(${charge})` }} />
      </span>
      <span className="dash-meter__legend" aria-hidden="true">
        {DASH_ACTIVE_TICKS} active · {DASH_RECHARGE_TICKS} recharge ticks
      </span>
    </div>
  );
}

/**
 * The game frame in a portrait game bezel, sized to PARALLAXIA's 220×336 canvas.
 * It listens to the frame's 80 ms status samples for the dash meter. In practice mode only
 * `challenge-status` is read, so the two status streams no longer alternate.
 */
export function GameCabinet({
  frameRef,
  channel,
  practice,
  heading,
  versionLabel,
  badge,
  badgeTone,
  frame,
  controls,
  children,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  channel: string;
  practice: boolean;
  heading: string;
  versionLabel: string;
  badge: string;
  badgeTone: 'reuse' | 'saved' | 'fresh';
  frame: ReactNode;
  controls: ReactNode;
  children?: ReactNode;
}) {
  const [reading, setReading] = useState<DashReading>(UNKNOWN);
  const [status, setStatus] = useState('Loading the verified integration…');
  const [flash, setFlash] = useState(false);
  const previous = useRef<DashReading>(UNKNOWN);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    previous.current = UNKNOWN;
    setReading(UNKNOWN);
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.data?.channel !== channel)
        return;
      if (practice) {
        if (event.data.type === 'challenge-status')
          setStatus('Practice shield · ' + String(event.data.state?.phase ?? 'ready'));
        return;
      }
      if (event.data.type !== 'motion-status') return;
      const next = readDash(event.data.motion as MotionSample | null);
      const before = previous.current;
      previous.current = next;
      setReading((value) =>
        value.known === next.known &&
        value.active === next.active &&
        value.remaining === next.remaining &&
        value.cooldown === next.cooldown
          ? value
          : next,
      );
      setStatus(next.active ? 'Recovered dash active' : 'Native flight · X to dash');
      const fired =
        (next.active && !before.active) ||
        (next.cooldown !== null && before.cooldown !== null && next.cooldown > before.cooldown);
      if (fired) {
        setFlash(true);
        clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(false), 520);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(flashTimer.current);
    };
  }, [channel, frameRef, practice]);
  return (
    <article
      className={'cabinet' + (flash ? ' is-dashing' : '') + (practice ? ' is-practice' : '')}
      data-dash={reading.active ? 'on' : 'off'}
    >
      <span className="cabinet__cable" aria-hidden="true" />
      <header className="cabinet__marquee">
        <h2>{heading}</h2>
        <p className="cabinet__version">{versionLabel}</p>
        <p className={'pill pill--' + badgeTone}>{badge}</p>
      </header>
      <div className="cabinet__bezel">
        <span className="cabinet__ghost cabinet__ghost--1" aria-hidden="true" />
        <span className="cabinet__ghost cabinet__ghost--2" aria-hidden="true" />
        <div className="cabinet__screen">{frame}</div>
      </div>
      {practice ? null : <DashMeter reading={reading} />}
      <div className="cabinet__controls">{controls}</div>
      <p role="status" className="cabinet__status">
        {status}
      </p>
      {children}
    </article>
  );
}
