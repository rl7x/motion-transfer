import { useCallback, useEffect, useRef, useState } from 'react';
import { useTransfer } from '../transfer-context';
import { linkHref } from '../links';
import type { PlayerSnapshot, PlayerWindow } from '../types';
import { HoldButton } from './hold-button';
import { useExpanded, ExpandButton } from './player-expansion';
import { ChallengePlayer } from './challenge-player';

const reset = (frame: HTMLIFrameElement | null) => {
  if (frame?.getAttribute('src')) frame.src = frame.getAttribute('src')!;
};

function DonorPlayer() {
  const card = useRef<HTMLElement>(null),
    frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<{
    status: string;
    remaining: number;
    cooldown: number;
  } | null>(null);
  const { expanded, toggle } = useExpanded(card, frame);
  const send = useCallback(
    (button: string, pressed: boolean) =>
      frame.current?.contentWindow?.postMessage(
        { type: 'donor-control', button, pressed, channel },
        '*',
      ),
    [channel],
  );
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (
        event.source === frame.current?.contentWindow &&
        event.data?.channel === channel &&
        event.data.type === 'donor-status'
      )
        setState(event.data.state);
    };
    const release = () => {
      for (const button of ['left', 'right', 'up', 'down', 'dash']) send(button, false);
    };
    window.addEventListener('message', message);
    window.addEventListener('blur', release);
    return () => {
      release();
      window.removeEventListener('message', message);
      window.removeEventListener('blur', release);
    };
  }, [channel, send]);
  return (
    <article ref={card} className="game-card donor-card">
      <div className="card-heading">
        <div>
          <p className="eyebrow">02 / FEEL THE ORIGINAL ABILITY</p>
          <h2>Dashy Dango</h2>
        </div>
        <div className="card-heading-actions">
          <span className="pill neutral">COMPILED DONOR</span>
          <ExpandButton id="donor-game" expanded={expanded} toggle={toggle} />
        </div>
      </div>
      <iframe
        ref={frame}
        id="donor-game"
        src={linkHref('/donor/play#channel=' + channel)}
        title="Compiled Dashy Dango donor"
        sandbox="allow-scripts"
        allow="autoplay"
      />
      <div className="toolbar donor-toolbar">
        {[
          ['left', '←'],
          ['up', '↑'],
          ['down', '↓'],
          ['right', '→'],
        ].map(([name, label]) => (
          <HoldButton
            key={name}
            data-donor={name}
            aria-label={'Move donor ' + name}
            disabled={!state}
            onHold={(pressed) => send(name, pressed)}
          >
            {label}
          </HoldButton>
        ))}
        <HoldButton
          className="dash-button"
          data-donor="dash"
          disabled={!state}
          onHold={(pressed) => send('dash', pressed)}
        >
          Start / dash <kbd>X</kbd>
        </HoldButton>
        <button
          className="quiet"
          data-reset="donor-game"
          aria-label="Reset donor"
          onClick={() => reset(frame.current)}
        >
          ↻
        </button>
      </div>
      <p className="controls">
        Focus the game. Arrow keys move; <kbd>X</kbd> starts and dashes. Or use the buttons above.
      </p>
      <p className="card-note" id="donor-state">
        {!state
          ? 'The original compiled cartridge, running locally.'
          : state.status !== 'playing'
            ? 'Use X or Start / dash to enter the compiled game.'
            : state.remaining > 0
              ? 'ORIGINAL DASH ACTIVE'
              : state.cooldown > 0
                ? 'ORIGINAL DASH RECHARGING'
                : 'ORIGINAL DASH READY'}
      </p>
    </article>
  );
}
function RecipientPair() {
  const { destination, artifact } = useTransfer();
  const before = useRef<HTMLIFrameElement>(null),
    after = useRef<HTMLIFrameElement>(null);
  const beforeCard = useRef<HTMLElement>(null),
    afterCard = useRef<HTMLElement>(null);
  const beforeExpand = useExpanded(beforeCard, before),
    afterExpand = useExpanded(afterCard, after);
  const [channel] = useState(() =>
    destination?.id === 'roadster' || artifact?.parentArtifactId ? crypto.randomUUID() : null,
  );
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [dashState, setDashState] = useState('READY TO PLAY'),
    [pressed, setPressed] = useState(false);
  const childState = useRef<PlayerSnapshot | null>(null);
  const car = destination?.id === 'roadster';
  const send = useCallback(
    (frame: HTMLIFrameElement | null, type: string, down: boolean) => {
      if (!frame) return;
      if (frame === after.current && channel) {
        frame.contentWindow?.postMessage({ type, pressed: down, channel }, '*');
        return;
      }
      const win = frame.contentWindow as PlayerWindow | null;
      if (car && frame === before.current) {
        if (type === 'turn' && down) win?.roadsterStart?.();
        return;
      }
      if (!win || !(win.pakuReady || win.jujumpReady)) return;
      const code = type === 'dash' ? 'KeyD' : 'Space';
      frame.contentDocument?.dispatchEvent(
        new win.KeyboardEvent(down ? 'keydown' : 'keyup', {
          code,
          key: code === 'Space' ? ' ' : 'd',
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [car, channel],
  );
  useEffect(() => {
    const started = Date.now();
    const visibilityState = new Map<Element, boolean>();
    const syncVisibility = () => {
      if (!car || window.guidedRunning) return;
      try {
        const afterVisible = after.current ? visibilityState.get(after.current) : undefined;
        if (afterVisible !== undefined && childState.current && channel)
          after.current?.contentWindow?.postMessage(
            { type: 'roadster-visibility', pressed: afterVisible, channel },
            '*',
          );
        const beforeVisible = before.current ? visibilityState.get(before.current) : undefined;
        const win = before.current?.contentWindow as PlayerWindow | null;
        if (
          beforeVisible !== undefined &&
          win?.roadsterReady &&
          !before.current?.src.includes('test=1')
        )
          win?.__game?.realtime(beforeVisible);
      } catch {
        /* A visibility event can precede player initialization. Retry after readiness. */
      }
    };
    const message = (event: MessageEvent) => {
      if (
        channel &&
        event.source === after.current?.contentWindow &&
        event.data?.channel === channel &&
        event.data.type === 'motion-status'
      ) {
        childState.current = event.data;
      }
    };
    const release = () => {
      send(after.current, 'dash', false);
      setPressed(false);
    };
    window.addEventListener('message', message);
    window.addEventListener('blur', release);
    const timer = setInterval(() => {
      try {
        const win = after.current?.contentWindow as PlayerWindow | null;
        const state = channel
          ? childState.current
          : destination?.id === 'jujump'
            ? win?.jujumpSnapshot?.()
            : win?.pakuSnapshot?.();
        const loaded = channel
          ? Boolean(childState.current)
          : Boolean(win?.pakuReady || win?.jujumpReady);
        setReady(loaded);
        syncVisibility();
        if (!loaded && Date.now() - started > 10000) setFailed(true);
        const motion = state?.motion,
          core = motion?.core ?? motion?.state?.core;
        setDashState(
          !motion || state?.status !== 'playing'
            ? 'READY TO PLAY'
            : state.isReplaying
              ? 'REPLAY'
              : motion.output?.ownsMotion
                ? 'DASH ACTIVE'
                : core && core.cooldown > 0
                  ? 'RECHARGING · ' + (core.cooldown / 60).toFixed(2) + 's'
                  : 'DASH READY',
        );
      } catch {
        /* A player can be between documents during reset. */
      }
    }, 80);
    const visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visibilityState.set(entry.target, entry.isIntersecting);
        syncVisibility();
      },
      { threshold: 0.05 },
    );
    if (before.current) visibility.observe(before.current);
    if (after.current) visibility.observe(after.current);
    return () => {
      release();
      clearInterval(timer);
      visibility.disconnect();
      window.removeEventListener('message', message);
      window.removeEventListener('blur', release);
    };
  }, [car, channel, destination?.id, send]);
  if (!destination) return null;
  const fresh = artifact?.intent.activation === 'press';
  const afterSrc = car
    ? `/roadster/artifacts/${artifact?.id}/play.html?quality=low&session=${channel}#channel=${channel}`
    : artifact?.parentArtifactId
      ? `/artifacts/${artifact.id}/play.html?session=${channel}#channel=${channel}`
      : destination.after;
  const controls = car
    ? `Run the stunt, then ${fresh ? 'press' : 'hold'} X for the horizontal air dash. Native controls and touch buttons still work.`
    : fresh
      ? 'Tap or Space to turn. Press D to dash; release it before the next dash.'
      : destination.control;
  return (
    <>
      <article ref={beforeCard} className="game-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">03 / BEFORE THE TRANSFER</p>
            <h2 id="recipient-title">{destination.name}</h2>
          </div>
          <div className="card-heading-actions">
            <span className="pill neutral">BEFORE</span>
            <ExpandButton id="original-game" {...beforeExpand} />
          </div>
        </div>
        <iframe
          ref={before}
          id="original-game"
          src={linkHref(destination.before)}
          title={destination.name + ' before transfer'}
          allow="autoplay"
        />
        <div className="toolbar">
          <HoldButton
            data-turn="original-game"
            disabled={!ready}
            onHold={(down) => send(before.current, 'turn', down)}
          >
            {destination.action} <kbd>{car ? 'Enter' : 'Space'}</kbd>
          </HoldButton>
          <button
            className="quiet"
            data-reset="original-game"
            aria-label="Reset recipient before transfer"
            onClick={() => reset(before.current)}
          >
            ↻
          </button>
        </div>
        <p className="controls" id="original-controls">
          {car
            ? 'Run stunt starts the assisted driver. Inside the game, arrows/WASD drive and rotate; Space fires native lift thrusters.'
            : destination.id === 'jujump'
              ? 'Tap or Space to jump and alternate direction. Hold the jump button for lighter gravity.'
              : 'Tap or Space to turn. Eat dots and avoid the ghost.'}
        </p>
        <p className="card-note">The recipient&apos;s own rules, without the recovered ability.</p>
      </article>
      <article ref={afterCard} className="game-card transferred">
        <div className="card-heading">
          <div>
            <p className="eyebrow">04 / THE SAME ABILITY, REHOMED</p>
            <h2 id="hybrid-title">
              {destination.name + (artifact?.parentArtifactId ? ' + REMIX' : ' + DASH')}
            </h2>
          </div>
          <div className="card-heading-actions">
            <span className="pill" id="transfer-status" role="status">
              {ready
                ? artifact?.parentArtifactId
                  ? 'CHECKED REMIX'
                  : 'VERIFIED TRANSFER'
                : failed
                  ? 'LOAD FAILED'
                  : 'LOADING'}
            </span>
            <ExpandButton id="transfer-game" {...afterExpand} />
          </div>
        </div>
        <div className="play-area">
          <iframe
            ref={after}
            id="transfer-game"
            src={linkHref(afterSrc)}
            title={destination.name + ' after transfer'}
            sandbox={channel ? 'allow-scripts' : undefined}
            allow="autoplay"
          />
          <div id="transfer-placeholder" hidden={ready}>
            {failed
              ? 'The saved player did not start. Reset the player to retry.'
              : 'Loading the saved transfer…'}
          </div>
        </div>
        <div className="toolbar">
          <HoldButton
            data-turn="transfer-game"
            data-transfer-control
            disabled={!ready}
            onHold={(down) => send(after.current, 'turn', down)}
          >
            {destination.action} <kbd>{car ? 'Enter' : 'Space'}</kbd>
          </HoldButton>
          <HoldButton
            className={'dash-button' + (pressed ? ' pressed' : '')}
            data-dash
            data-transfer-control
            disabled={!ready}
            onHold={(down) => {
              send(after.current, 'dash', down);
              setPressed(down);
            }}
          >
            {fresh ? 'Press' : 'Hold'} to dash <kbd>{destination.dashKey ?? 'D'}</kbd>
          </HoldButton>
          <button
            className="quiet"
            data-reset="transfer-game"
            data-transfer-control
            disabled={!ready}
            aria-label="Reset recipient after transfer"
            onClick={() => {
              send(after.current, 'dash', false);
              childState.current = null;
              setReady(false);
              reset(after.current);
            }}
          >
            ↻
          </button>
        </div>
        <p className="controls" id="transfer-controls">
          {controls}
        </p>
        <p className="card-note">
          <span className="status-dot" />
          <span id="dash-state">{dashState}</span>
        </p>
      </article>
    </>
  );
}
export function Players() {
  const { destination, artifact, revision, error } = useTransfer();
  if (destination?.id === 'roadster' && artifact) return <ChallengePlayer key={revision} />;
  return (
    <section
      className="games"
      aria-label="Donor, recipient before transfer, recipient after transfer"
    >
      <DonorPlayer />
      {destination ? (
        <RecipientPair key={revision} />
      ) : (
        <>
          <article className="game-card" aria-busy={!error}>
            <div className="card-heading">
              <h2>Recipient</h2>
              <span className="pill neutral">BEFORE</span>
            </div>
            <div className="play-area">
              <p className="controls">{error ?? 'Loading the recipient…'}</p>
            </div>
          </article>
          <article className="game-card transferred" aria-busy={!error}>
            <div className="card-heading">
              <h2>Recipient + dash</h2>
              <span className="pill" id="transfer-status" role="status">
                {error ? 'UNAVAILABLE' : 'LOADING'}
              </span>
            </div>
            <div className="play-area">
              <p className="controls">{error ?? 'Loading the saved transfer…'}</p>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
export function Destinations() {
  const { destinations, destination, ability, note, selectDestination } = useTransfer();
  return (
    <section className="destination-section" aria-labelledby="destination-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / CHOOSE ITS NEW HOME</p>
          <h2 id="destination-heading">One recovered ability. Different worlds.</h2>
        </div>
        <span className="shared-tag" id="shared-component" title={ability?.id}>
          {ability ? 'SAME COMPONENT / ' + ability.id.slice(0, 12) : 'Checking component identity…'}
        </span>
      </div>
      <div className="destinations" id="destinations" aria-label="Working transfer destinations">
        {destinations.map((item) => (
          <button
            key={item.id}
            className="destination"
            data-destination={item.id}
            aria-pressed={destination?.id === item.id}
            onClick={() => {
              void selectDestination(item.id);
            }}
          >
            <span className="eyebrow">{item.kind}</span>
            <strong>{item.name}</strong>
            <span className="destination-action">Give it the dash →</span>
            <small>
              {item.id === 'roadster'
                ? 'Saved transfer · live Meta adaptation'
                : item.liveEdits.length
                  ? 'Saved transfer · live remix supported'
                  : 'Saved transfer · gravity and landing'}
            </small>
          </button>
        ))}
      </div>
      <p className="selection-note" id="selection-note" role="status">
        {note}
      </p>
    </section>
  );
}
