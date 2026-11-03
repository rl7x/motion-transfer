import { useCallback, useEffect, useRef, useState } from 'react';
import { useTransfer } from '../transfer-context';
import { readGenerationMode, readRecovery } from '../data-source';
import { linkHref } from '../links';
import { useResource } from '../hooks/use-resource';
import { HoldButton } from './hold-button';
import { useExpanded, ExpandButton } from './player-expansion';
import { ShareStatus } from './share-status';

interface ChallengeInfo {
  id: string;
  componentId: string;
  play: string;
  download: string;
  source: string;
  report: string;
  target: { minX: number; maxX: number };
  measurements: {
    baselineLandingX: number;
    transferredLandingX: number;
    netLandingShiftMeters: number;
    durationSeconds: number;
  };
}
interface ChallengeState {
  phase: 'ready' | 'running' | 'landed' | 'missed';
  borrowed: boolean;
  tick: number;
  dashHeld: boolean;
  activeUpdates: number;
  dashMeters: number;
  landing: { type: string; position: { x: number } } | null;
  motion: { output?: { ownsMotion: boolean }; state?: { core?: { cooldown: number } } };
}
export function ChallengePlayer() {
  const { artifact, share } = useTransfer();
  const { data, error } = useResource<ChallengeInfo>('/api/roadster/challenge/' + artifact?.id);
  const frame = useRef<HTMLIFrameElement>(null),
    card = useRef<HTMLElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<ChallengeState | null>(null);
  const visible = useRef(true);
  const [demo, setDemo] = useState(false);
  const { expanded, toggle } = useExpanded(card, frame);
  const send = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      frame.current?.contentWindow?.postMessage({ type, channel, ...payload }, '*');
    },
    [channel],
  );
  const command = (action: string) => {
    setDemo(action === 'demonstrate');
    send('challenge-command', { action });
  };
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel ||
        event.data.type !== 'challenge-status'
      )
        return;
      setState(event.data.state as ChallengeState);
      send('roadster-visibility', { pressed: visible.current });
    };
    const release = () => send('dash', { pressed: false });
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)
      )
        return;
      if (event.code === 'KeyX') {
        event.preventDefault();
        send('dash', { pressed: true });
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'KeyX') release();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.current = entry.isIntersecting;
          send('roadster-visibility', { pressed: entry.isIntersecting });
        }
      },
      { threshold: 0.05 },
    );
    if (frame.current) observer.observe(frame.current);
    window.addEventListener('message', message);
    window.addEventListener('blur', release);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      release();
      observer.disconnect();
      window.removeEventListener('message', message);
      window.removeEventListener('blur', release);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, [channel, send, data?.play]);
  useEffect(() => {
    if (!demo || !state) return;
    window.guidedState =
      state.phase === 'landed' || state.phase === 'missed'
        ? {
            phase: 'complete',
            activeUpdates: state.activeUpdates,
            measuredMeters: state.dashMeters,
          }
        : { phase: 'running' };
  }, [demo, state]);
  const running = state?.phase === 'running';
  const result =
    state?.phase === 'landed'
      ? 'Reached the safe zone!'
      : state?.phase === 'missed'
        ? state.landing?.type === 'crash'
          ? 'Clipped by the barrage. Try again.'
          : 'Pinned outside the safe zone. Try a different dash timing.'
        : running
          ? state.borrowed
            ? 'Press X during the barrage. Phase-dash into the green safe zone.'
            : 'The original wave is running. Watch where the barrage pins the ship.'
          : state?.borrowed
            ? 'Dash borrowed. Launch, then choose when to phase-dash.'
            : 'Launch the original wave. Then borrow a move from Dashy Dango.';
  return (
    <section className="challenge-section games" aria-label="PARALLAXIA barrage challenge">
      <article ref={card} className="game-card challenge-card transferred">
        <div className="card-heading">
          <div>
            <p className="eyebrow">01 / BORROW A MOVE. SURVIVE THE BARRAGE.</p>
            <h2 id="hybrid-title">Phase-dash into the green safe zone.</h2>
          </div>
          <div className="card-heading-actions">
            <span className="pill" id="transfer-status" role="status">
              {state
                ? artifact?.parentArtifactId
                  ? 'CHECKED REMIX'
                  : 'VERIFIED TRANSFER'
                : error
                  ? 'LOAD FAILED'
                  : 'LOADING'}
            </span>
            <ExpandButton id="transfer-game" expanded={expanded} toggle={toggle} />
          </div>
        </div>
        <div className="play-area">
          {data && (
            <iframe
              ref={frame}
              id="transfer-game"
              src={linkHref(data.play + '?quality=low#channel=' + channel)}
              title="PARALLAXIA barrage challenge"
              sandbox="allow-scripts"
              allow="autoplay"
            />
          )}
          {!state && (
            <div id="transfer-placeholder">{error ?? 'Preparing the saved challenge…'}</div>
          )}
        </div>
        <div className="toolbar challenge-controls">
          <button data-challenge="start" disabled={!state} onClick={() => command('start')}>
            {running ? 'Restart run' : 'Launch ship'}
          </button>
          <button
            className="borrow-button"
            data-challenge="borrow"
            disabled={!state || state.borrowed}
            onClick={() => command('borrow')}
          >
            {state?.borrowed ? 'Dash borrowed ✓' : 'Borrow dash'}
          </button>
          <HoldButton
            className="dash-button"
            data-dash
            disabled={!state?.borrowed || !running}
            onHold={(pressed) => send('dash', { pressed })}
          >
            {artifact?.intent.activation === 'press' ? 'Press' : 'Hold'} to dash <kbd>X</kbd>
          </HoldButton>
          <button
            className="quiet"
            data-reset="transfer-game"
            aria-label="Restart challenge"
            disabled={!state}
            onClick={() => command('reset')}
          >
            ↻
          </button>
        </div>
        <p
          className={'challenge-result ' + (state?.phase ?? '')}
          id="challenge-result"
          role="status"
          aria-live="polite"
        >
          {result}
        </p>
        <div className="challenge-secondary">
          <button
            className="quiet"
            data-challenge="original"
            disabled={!state}
            onClick={() => command('original')}
          >
            Watch original
          </button>
          <button
            className="quiet"
            id="watch-transfer"
            disabled={!state}
            onClick={() => command('demonstrate')}
          >
            Watch borrowed dash
          </button>
          <button
            className="quiet"
            data-share-challenge
            onClick={() => {
              void share();
            }}
          >
            Copy playable link ↗
          </button>
          {data && (
            <a id="challenge-download" href={linkHref(data.download)} download>
              Download playable game ↗
            </a>
          )}
        </div>
        <ShareStatus id="challenge-share-status" fallback />
        {readGenerationMode() !== 'playback-only' && (
          <p id="audience-notice" className="saved-note">
            The download is a playable game for adults 18 and older. It makes no model request.
            Opened on its own, a PARALLAXIA file shows that notice.
          </p>
        )}
        <p className="saved-note" id="guided-progress">
          {readRecovery() === 'accepted' ? 'Accepted ability.' : 'Saved ability.'} Borrowing and
          replaying make no model request. The ship&apos;s native 60 Hz simulation, lock-on lasers,
          and bullet collisions stay active.
        </p>
        <p className="controls" id="transfer-controls">
          An assisted pilot flies the Sector 1 barrage. You choose the phase-dash timing with X or
          the ability button. Each attempt takes about 13 seconds of game time.
        </p>
        <p className="card-note">
          <span className="status-dot" />
          <span id="dash-state">
            {state?.motion.output?.ownsMotion
              ? 'DASH ACTIVE'
              : (state?.motion.state?.core?.cooldown ?? 0) > 0
                ? 'RECHARGING'
                : 'DASH READY'}
          </span>
        </p>
      </article>
      <aside className="challenge-context">
        <p className="eyebrow">THE MOVE COMES FROM ANOTHER GAME</p>
        <h3>Dashy Dango → PARALLAXIA</h3>
        <p>
          A dash recovered from compiled WASM-4 bytecode becomes a 60-pixel horizontal phase-dash in
          Kenta Cho&apos;s bullet-hell shooter.
        </p>
        <p>
          The green safe zone is our challenge. PARALLAXIA&apos;s ship, raster renderer, enemy
          formations, barrages and NES chiptune synth are upstream work by Kenta Cho (ABA Games).
        </p>
        <p>
          <a href={linkHref('/donor/play')} target="_blank" rel="noreferrer">
            Play the original donor ↗
          </a>{' '}
          · <a href="#remix-heading">Make your version ↓</a>
        </p>
        {data && (
          <details>
            <summary>See the matched-input evidence</summary>
            <p>
              The recorded native run lands at {data.measurements.baselineLandingX.toFixed(2)} m.
              The same controls plus this dash land at{' '}
              {data.measurements.transferredLandingX.toFixed(2)} m.
            </p>
            <p>
              The default dash supplies six meters across eight updates. Its net landing shift also
              includes the native movement it replaces.
            </p>
            <a href={linkHref(data.report)}>Exact traces and checks ↗</a> ·{' '}
            <a href={linkHref(data.source)}>Component, adapter and notices ↗</a>
          </details>
        )}
      </aside>
    </section>
  );
}
