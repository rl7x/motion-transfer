import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { HoldButton } from '../components/hold-button';
import { linkHref } from '../links';
import { DashMeter, readDash, type DashReading } from './game-cabinet';
import { MetaChip } from './meta-chip';

type Action = 'jump' | 'dash' | 'run' | 'restart';
export interface SavedGameFrame {
  kind: 'before' | 'after';
  title: string;
  src: string;
  /** Trusted same-origin frames take synthetic keys; sandboxed frames take channel messages. */
  sameOrigin: boolean;
  controls: { action: Action; label: string; kbd?: string }[];
}
export interface SavedGame {
  id: string;
  name: string;
  credit: string;
  /** Canvas width / height. */
  aspect: number;
  frames: SavedGameFrame[];
  keeps: string;
  carries: string;
  help: string;
  /** Meter prompts before the component first steps, and once the dash is ready. */
  idleLabel: string;
  readyLabel: string;
  extra?: { label: string; href: string };
}

const KEYS: Record<'jump' | 'dash', { code: string; key: string }> = {
  jump: { code: 'Space', key: ' ' },
  dash: { code: 'KeyD', key: 'd' },
};
const UNKNOWN: DashReading = { known: false, active: false, remaining: 0, cooldown: null };

type SnapshotWindow = Window & {
  KeyboardEvent: typeof KeyboardEvent;
  jujumpSnapshot?: () => { motion?: unknown };
  pakuSnapshot?: () => { motion?: unknown };
};

function GameFrame({ game, frame }: { game: SavedGame; frame: SavedGameFrame }) {
  const element = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [reading, setReading] = useState<DashReading>(UNKNOWN);
  const act = useCallback(
    (action: Action, pressed: boolean) => {
      const win = element.current?.contentWindow as SnapshotWindow | null;
      if (!win) return;
      if (!frame.sameOrigin) {
        if (action === 'dash') win.postMessage({ type: 'dash', pressed, channel }, '*');
        if (action === 'run' && pressed) win.postMessage({ type: 'turn', pressed, channel }, '*');
        if (action === 'restart' && pressed)
          win.postMessage({ type: 'roadster-restart', channel }, '*');
        return;
      }
      if (action !== 'jump' && action !== 'dash') return;
      try {
        const { code, key } = KEYS[action];
        win.document.dispatchEvent(
          new win.KeyboardEvent(pressed ? 'keydown' : 'keyup', {
            code,
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      } catch {
        /* The frame can be between documents while it restarts. */
      }
    },
    [channel, frame.sameOrigin],
  );
  useEffect(() => {
    if (frame.kind !== 'after') return;
    if (!frame.sameOrigin) {
      const receive = (event: MessageEvent) => {
        if (
          event.source === element.current?.contentWindow &&
          event.data?.channel === channel &&
          event.data.type === 'motion-status'
        )
          setReading(readDash(event.data.motion));
      };
      window.addEventListener('message', receive);
      return () => window.removeEventListener('message', receive);
    }
    const timer = setInterval(() => {
      try {
        const win = element.current?.contentWindow as SnapshotWindow | null;
        const snapshot = win?.jujumpSnapshot?.() ?? win?.pakuSnapshot?.();
        setReading(readDash(snapshot?.motion as Parameters<typeof readDash>[0]));
      } catch {
        setReading(UNKNOWN);
      }
    }, 80);
    return () => clearInterval(timer);
  }, [channel, frame.kind, frame.sameOrigin]);
  useEffect(() => {
    const release = () => {
      act('jump', false);
      act('dash', false);
    };
    window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('blur', release);
    };
  }, [act]);
  const src = linkHref(frame.src) + (frame.sameOrigin ? '' : '#channel=' + channel);
  return (
    <article className={'game-frame game-frame--' + frame.kind}>
      <p className="game-frame__tag">
        {frame.kind === 'before' ? 'BEFORE · THE GAME’S OWN RULES' : 'AFTER · BORROWED DASH'}
      </p>
      <h3>{frame.title}</h3>
      <div
        className={'game-frame__screen' + (reading.active ? ' is-dashing' : '')}
        style={{ '--aspect': game.aspect } as CSSProperties}
      >
        <iframe
          ref={element}
          src={src}
          title={frame.title}
          allow="autoplay"
          {...(frame.sameOrigin ? {} : { sandbox: 'allow-scripts' })}
        />
      </div>
      {frame.kind === 'after' ? (
        <DashMeter reading={reading} idleLabel={game.idleLabel} readyLabel={game.readyLabel} />
      ) : (
        <p className="game-frame__none">No dash here: the recipient exactly as it shipped.</p>
      )}
      <div className="keys">
        {frame.controls.map((control) =>
          control.action === 'jump' || control.action === 'dash' ? (
            <HoldButton
              key={control.action}
              className={
                'key key--action' + (control.action === 'dash' ? ' key--dash' : ' key--wide')
              }
              aria-label={`${control.label} in ${frame.title}`}
              onHold={(pressed) => act(control.action, pressed)}
            >
              {control.label}
              {control.kbd ? <kbd>{control.kbd}</kbd> : null}
            </HoldButton>
          ) : (
            <button
              key={control.action}
              type="button"
              className="btn btn--light btn--small"
              onClick={() => act(control.action, true)}
            >
              {control.label}
            </button>
          ),
        )}
      </div>
    </article>
  );
}

/**
 * A saved, verified transfer played inside the AI Lab: the recipient before and after it borrowed
 * the recovered dash. Mounted only while open; it makes no model request.
 */
export function SavedGamePlayer({
  game,
  onClose,
  onTryLive,
}: {
  game: SavedGame;
  onClose(): void;
  onTryLive(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Keys go to the game, so Space or Enter cannot press the Close button instead.
    element?.querySelector<HTMLIFrameElement>('.game-frame--after iframe')?.focus();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="donor-dialog game-dialog"
      aria-labelledby="saved-game-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="donor-dialog__header">
        <div>
          <p className="eyebrow">SAVED, VERIFIED TRANSFER · NO MODEL REQUEST</p>
          <h2 id="saved-game-title">{game.name}</h2>
          <p className="donor-dialog__by">
            {game.credit} · carrying the dash <MetaChip model="wonder" /> recovered from Dashy Dango
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="game-dialog__frames">
        {game.frames.map((frame) => (
          <GameFrame key={frame.kind} game={game} frame={frame} />
        ))}
      </div>
      <dl className="game-dialog__notes">
        <div>
          <dt>Stays with {game.name}</dt>
          <dd>{game.keeps}</dd>
        </div>
        <div>
          <dt>Carried over</dt>
          <dd>{game.carries}</dd>
        </div>
      </dl>
      <p className="donor-dialog__help">{game.help}</p>
      <p className="donor-dialog__actions">
        <button type="button" className="btn btn--primary" onClick={onTryLive}>
          Remix it live in PARALLAXIA →
        </button>
        {game.extra ? (
          <a
            className="btn btn--ghost btn--small"
            href={linkHref(game.extra.href)}
            target="_blank"
            rel="noreferrer"
          >
            {game.extra.label}
          </a>
        ) : null}
      </p>
    </dialog>
  );
}
