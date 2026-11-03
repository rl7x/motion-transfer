import { useCallback, useEffect, useRef, useState } from 'react';
import { readGenerationMode, readJujumpComparison } from './data-source';
import { fetchJson, errorMessage } from './api';
import { linkHref } from './links';
import {
  CheckpointGoals,
  ExperimentResults,
  type ExperimentReceipt,
  type Checkpoint,
} from './motion-experiment';
import { MotionGeneration, type MotionJob } from './motion-generation';
import { HoldButton } from './components/hold-button';
import { Header } from './components/static-content';
import { AgeAcknowledgment, AgeProvider } from './components/age-acknowledgment';

interface Baseline {
  id: string;
  componentId: string;
  play: string;
  practice: string;
  practiceDownload?: string;
  practiceReport?: string;
  historicalRoadster?: string;
  download: string;
  report: string;
  recipient: { name: string; unitMapping: string };
}

export function MotionWorkbench() {
  const [savedExperiment, setSavedExperiment] = useState<{
    receipt: ExperimentReceipt;
    parent: string;
    candidate: string;
    download: string;
  } | null>(null);
  const [routeVersion, setRouteVersion] = useState(0);
  useEffect(() => {
    const route = () => setRouteVersion((value) => value + 1);
    window.addEventListener('popstate', route);
    return () => window.removeEventListener('popstate', route);
  }, []);
  const [base, setBase] = useState<Baseline | null>(null);
  const [active, setActive] = useState<{
    id: string;
    play: string;
    download: string;
    report: string;
    rule?: { kind: string } | null;
    fresh?: boolean;
    intent?: { unitScale: number; activation: string; direction: string } | null;
  } | null>(null);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [experiment, setExperiment] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [practice, setPractice] = useState(false);
  const [channel] = useState(() => crypto.randomUUID());
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState('Loading the verified integration…');
  const send = useCallback(
    (type: string, extra: Record<string, unknown> = {}) => {
      frame.current?.contentWindow?.postMessage({ channel, type, ...extra }, '*');
    },
    [channel],
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<Baseline>('/api/parallaxia/base', { signal: controller.signal })
      .then(async (value) => {
        setBase(value);
        const id =
          new URL(location.href).searchParams.get('artifact') ??
          window.__MOTION_TRANSFER__?.featuredArtifactId;
        if (!id) {
          setActive(null);
          setSavedExperiment(null);
        }
        if (id && /^[a-f0-9]{64}$/.test(id)) {
          const receipt = await fetchJson<{
            componentId: string;
            recipient: { id: string };
            rule?: { kind: string } | null;
            experiment?: ExperimentReceipt;
            parentArtifactId: string;
            intent?: { unitScale: number; activation: string; direction: string } | null;
          }>('/artifacts/' + id + '/receipt.json', { signal: controller.signal });
          if (receipt.componentId !== value.componentId || receipt.recipient.id !== 'parallaxia')
            throw Error('Wrong recipient or component');
          setActive({
            id,
            play: '/artifacts/' + id + '/play.html',
            download: '/artifacts/' + id + '/download.zip',
            report: '/artifacts/' + id + '/receipt.json',
            rule: receipt.rule,
            intent: receipt.intent,
          });
          if (receipt.experiment)
            setSavedExperiment({
              receipt: receipt.experiment,
              parent: '/parents/' + receipt.parentArtifactId,
              candidate: '/artifacts/' + id + '/play.html',
              download: '/artifacts/' + id + '/experiment.json',
            });
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [routeVersion]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data.type === 'parallaxia-checkpoint-result') {
        if (event.data.error) setError(String(event.data.error));
        else {
          setCheckpoint(event.data.checkpoint as Checkpoint);
          setError('');
        }
      }
      if (event.data.type === 'motion-status') {
        setStatus(
          event.data.motion?.output?.ownsMotion
            ? 'Recovered dash active'
            : 'Native flight · X to dash',
        );
      }
      if (event.data.type === 'challenge-status')
        setStatus('Practice shield · ' + String(event.data.state?.phase ?? 'ready'));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);
  return (
    <AgeProvider>
      <main className="motion-workbench">
        <Header />
        <AgeAcknowledgment />
        <section className="destination-section">
          <p className="eyebrow">BORROW A MOVE · MAKE IT PLAYABLE</p>
          <h1>Dashy Dango → PARALLAXIA</h1>
          <p>
            Reuse the accepted eight-update dash with its 25-tick recharge. PARALLAXIA keeps its
            native movement, enemy rules and collisions.
          </p>
          <p className="pill">
            {active
              ? active.fresh
                ? 'NEW META GENERATION · VERIFIED CHILD'
                : 'SAVED META-GENERATED CHILD · REUSE'
              : 'VERIFIED REUSE · NO MODEL REQUEST'}
          </p>
          <p>
            Component <code>{base?.componentId ?? 'Loading…'}</code>
          </p>
          <p>Default mapping: {base?.recipient.unitMapping}</p>
          {active?.intent && (
            <p>
              Selected version: {active.intent.unitScale * 60} world-unit nominal burst ·{' '}
              {active.intent.direction} · {active.intent.activation}. Native bounds and collisions
              still apply.
            </p>
          )}
        </section>
        <section className="games" aria-label="PARALLAXIA movement workbench">
          <article className="game-card transferred">
            <h2>
              {practice ? 'Practice challenge · shield enabled' : 'PARALLAXIA · native collisions'}
            </h2>
            {base ? (
              <iframe
                ref={frame}
                id="parallaxia-game"
                title="PARALLAXIA with accepted recovered dash"
                src={linkHref(
                  (practice ? base.practice : (active?.play ?? base.play)) + '#channel=' + channel,
                )}
                sandbox="allow-scripts"
                allow="autoplay"
              />
            ) : (
              <p role="status">{error || status}</p>
            )}
            <div className="toolbar">
              <button
                onClick={() =>
                  send(practice ? 'challenge-command' : 'roadster-restart', { action: 'start' })
                }
              >
                Restart
              </button>
              {!practice &&
                [
                  ['left', '←'],
                  ['right', '→'],
                  ['up', '↑'],
                  ['down', '↓'],
                  ['shot', 'Shoot'],
                ].map(([control, label]) => (
                  <HoldButton
                    key={control}
                    aria-label={'Ship ' + control}
                    onHold={(pressed) => send('parallaxia-input', { control, pressed })}
                  >
                    {label}
                  </HoldButton>
                ))}
              <HoldButton onHold={(pressed) => send('dash', { pressed })}>
                Dash <kbd>X</kbd>
              </HoldButton>
              {practice && (
                <button onClick={() => send('challenge-command', { action: 'borrow' })}>
                  Borrow dash
                </button>
              )}
              <button onClick={() => setPractice((value) => !value)}>
                {practice ? 'Play with native collisions' : 'Open shielded practice'}
              </button>
            </div>
            <p role="status">{status}</p>
            {practice && (
              <p>
                Shielded practice reuses the baseline integration. Return to native play to use your
                selected child.
              </p>
            )}
            {active?.rule?.kind === 'dash-end-shot' && (
              <p>
                Host composition: dash-end → one next-tick native shot attempt, subject to the
                native cooldown and projectile cap.
              </p>
            )}
            <p>
              Focus the game. Arrows/WASD move; Space/Z shoots; X dashes. Native mode adds no
              invulnerability. Practice measures position with a shield, not survival.
            </p>
            {base && (
              <p>
                <a
                  href={linkHref(
                    practice
                      ? (base.practiceDownload ?? base.download)
                      : (active?.download ?? base.download),
                  )}
                  download
                >
                  Download this exact game
                </a>{' '}
                ·{' '}
                <a
                  href={linkHref(
                    practice
                      ? (base.practiceReport ?? base.report)
                      : (active?.report ?? base.report),
                  )}
                >
                  Recipient verification
                </a>
              </p>
            )}
          </article>
        </section>
        {savedExperiment && (
          <ExperimentResults
            receipt={savedExperiment.receipt}
            parentPlay={savedExperiment.parent}
            candidatePlay={savedExperiment.candidate}
            download={savedExperiment.download}
          />
        )}
        {base && !practice && readGenerationMode() !== 'playback-only' && (
          <CheckpointGoals
            checkpoint={checkpoint}
            capture={(curated) =>
              send(curated ? 'parallaxia-curated-checkpoint' : 'parallaxia-checkpoint')
            }
            resume={() => send('parallaxia-resume')}
            onFreeze={setExperiment}
          />
        )}
        {error && <p role="alert">{error}</p>}
        {base && (
          <MotionGeneration
            experiment={experiment}
            parentId={active?.id ?? base.id}
            onPlay={(job: MotionJob) => {
              if (!job.artifactId || !job.urls) return;
              setPractice(false);
              setCheckpoint(null);
              setExperiment(null);
              setSavedExperiment(null);
              setActive({
                id: job.artifactId,
                play: job.urls.play,
                download: '/artifacts/' + job.artifactId + '/download.zip',
                report: '/artifacts/' + job.artifactId + '/receipt.json',
                fresh: true,
                rule: job.rule,
                intent: job.intent,
              });
              history.pushState({}, '', '/?artifact=' + job.artifactId);
            }}
          />
        )}
        {active && (
          <button
            onClick={() => {
              setActive(null);
              setPractice(false);
              history.pushState({}, '', '/');
            }}
          >
            Keep original integration
          </button>
        )}

        <p>
          <a href={linkHref(readJujumpComparison() ?? '/accepted/jujump/index.html')}>
            Same accepted component in JUJUMP
          </a>{' '}
          ·{' '}
          <a href={linkHref(base?.historicalRoadster ?? '/?destination=roadster')}>
            Historical Roadster
          </a>{' '}
          · <a href="/donor/play">Compiled donor</a>
        </p>
        <footer>
          Dashy Dango by willGuimont · PARALLAXIA and JUJUMP by Kenta Cho / ABA Games.{' '}
          {base && (
            <a href={linkHref(`/parallaxia/artifacts/${base.id}/notices.txt`)}>
              Licenses and notices
            </a>
          )}
        </footer>
      </main>
    </AgeProvider>
  );
}
