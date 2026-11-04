import { useCallback, useEffect, useRef, useState } from 'react';
import { HoldButton } from '../components/hold-button';
import { linkHref } from '../links';
import { DashMeter, type DashReading } from './game-cabinet';
import { MetaChip } from './meta-chip';

interface DonorState {
  status?: string;
  remaining?: number;
  cooldown?: number;
}

const BUTTONS = ['left', 'up', 'down', 'right', 'dash'] as const;

function readDonor(state: DonorState | null): DashReading {
  if (!state || state.status !== 'playing')
    return { known: false, active: false, remaining: 0, cooldown: null };
  const remaining = Number(state.remaining ?? 0) || 0;
  return {
    known: true,
    active: remaining > 0,
    remaining: Math.min(8, Math.max(0, remaining)),
    cooldown: typeof state.cooldown === 'number' ? Math.max(0, state.cooldown) : null,
  };
}

/**
 * The original compiled Dashy Dango cartridge in a modal game cabinet, so players can feel the
 * dash at its source before trying it in PARALLAXIA. Mounted only while open; no model request.
 */
export function DonorPlayer({
  onClose,
  onTryTransfer,
}: {
  onClose(): void;
  onTryTransfer(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<DonorState | null>(null);
  const send = useCallback(
    (button: string, pressed: boolean) =>
      frame.current?.contentWindow?.postMessage(
        { type: 'donor-control', button, pressed, channel },
        '*',
      ),
    [channel],
  );
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Keys go to the game, so Space or Enter cannot press the Close button instead.
    frame.current?.focus();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.channel === channel &&
        event.data.type === 'donor-status'
      )
        setState(event.data.state as DonorState);
    };
    const release = () => {
      for (const button of BUTTONS) send(button, false);
    };
    window.addEventListener('message', receive);
    window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('message', receive);
      window.removeEventListener('blur', release);
    };
  }, [channel, send]);
  const reading = readDonor(state);
  return (
    <dialog
      ref={dialog}
      className="donor-dialog"
      aria-labelledby="donor-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="donor-dialog__header">
        <div>
          <p className="eyebrow">THE ORIGINAL · COMPILED WASM-4 CARTRIDGE</p>
          <h2 id="donor-title">Dashy Dango</h2>
          <p className="donor-dialog__by">
            by willGuimont and samX500 · the binary <MetaChip model="wonder" /> read to recover the
            dash
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={onClose}>
          Close
        </button>
      </header>
      <div className={'donor-dialog__bezel' + (reading.active ? ' is-dashing' : '')}>
        <iframe
          ref={frame}
          src={linkHref('/donor/play#channel=' + channel)}
          title="Dashy Dango, the original compiled game"
          sandbox="allow-scripts"
          allow="autoplay"
        />
      </div>
      <DashMeter reading={reading} idleLabel="PRESS X TO START · THEN X TO DASH" />
      <div className="keys">
        {(
          [
            ['left', '←'],
            ['up', '↑'],
            ['down', '↓'],
            ['right', '→'],
          ] as const
        ).map(([button, label]) => (
          <HoldButton
            key={button}
            className={'key key--' + button}
            aria-label={'Move dango ' + button}
            onHold={(pressed) => send(button, pressed)}
          >
            {label}
          </HoldButton>
        ))}
        <HoldButton
          className="key key--action key--dash"
          onHold={(pressed) => send('dash', pressed)}
        >
          Start / dash <kbd>X</kbd>
        </HoldButton>
      </div>
      <p className="donor-dialog__help">
        Click the game to focus it. Arrow keys move; X starts and dashes. Watch the afterimages:
        this is the exact burst and recharge the recovered component reproduces.
      </p>
      <p className="donor-dialog__actions">
        <button type="button" className="btn btn--primary" onClick={onTryTransfer}>
          Now try it in PARALLAXIA →
        </button>
        <a
          className="btn btn--ghost btn--small"
          href={linkHref('/donor/play')}
          target="_blank"
          rel="noreferrer"
        >
          Open in a new tab ↗
        </a>
      </p>
    </dialog>
  );
}
