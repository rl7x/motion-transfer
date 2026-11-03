import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HoldButton } from './components/hold-button';

interface ChallengeState {
  phase?: string;
  borrowed?: boolean;
}

function resultText(state: ChallengeState | null): string {
  if (state?.phase === 'landed') return 'Landed in the zone!';
  if (state?.phase === 'missed') return 'Outside the zone. Try a different dash timing.';
  if (state?.phase === 'running') return 'Press X while airborne. Aim for the green zone.';
  if (state?.borrowed) return 'Dash borrowed. Launch, then choose when to dash.';
  return 'Try the original. Then borrow a move from Dashy Dango.';
}

export function ReleaseChallengePlayer({ src, activation }: { src: string; activation: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<ChallengeState | null>(null);
  const send = useCallback(
    (type: string, extra: Record<string, unknown> = {}) => {
      frame.current?.contentWindow?.postMessage({ type, channel, ...extra }, '*');
    },
    [channel],
  );
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel ||
        event.data.type !== 'challenge-status'
      )
        return;
      setState(event.data.state as ChallengeState);
    };
    const release = () => send('dash', { pressed: false });
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyX') return;
      event.preventDefault();
      send('dash', { pressed: event.type === 'keydown' });
    };
    window.addEventListener('message', message);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('pagehide', release);
    return () => {
      release();
      window.removeEventListener('message', message);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('pagehide', release);
    };
  }, [channel, send]);
  const command = (action: string) => send('challenge-command', { action });
  const joiner = src.includes('?') ? '&' : '?';
  return (
    <>
      <iframe
        ref={frame}
        src={`${src}${joiner}quality=low#channel=${channel}`}
        title="Roadster landing challenge"
        sandbox="allow-scripts"
        allow="autoplay"
      />
      <div className="toolbar">
        <button type="button" data-action="start" onClick={() => command('start')}>
          Launch car
        </button>
        <button type="button" data-action="borrow" onClick={() => command('borrow')}>
          Borrow dash
        </button>
        <HoldButton data-dash type="button" onHold={(pressed) => send('dash', { pressed })}>
          {activation === 'press' ? 'Press' : 'Hold'} to dash
        </HoldButton>
        <button type="button" data-action="original" onClick={() => command('original')}>
          Watch original
        </button>
        <button type="button" data-action="demonstrate" onClick={() => command('demonstrate')}>
          Watch borrowed dash
        </button>
      </div>
      <p data-result data-phase={state?.phase ?? ''} role="status">
        {resultText(state)}
      </p>
    </>
  );
}

const mount = document.querySelector('[data-release-player]');
if (mount instanceof HTMLElement && mount.dataset.src) {
  createRoot(mount).render(
    <ReleaseChallengePlayer
      src={mount.dataset.src}
      activation={mount.dataset.activation || 'held'}
    />,
  );
}
