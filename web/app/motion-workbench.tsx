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
import { LiveMechanicsEvidence } from './live-mechanics-evidence';
import { HoldButton } from './components/hold-button';
import { AgeAcknowledgment, AgeProvider } from './components/age-acknowledgment';
import { Afterimage, useDashPulse } from './ai-lab/afterimage';
import { DestinationPicker, type Destination } from './ai-lab/destination-picker';
import { DonorPlayer } from './ai-lab/donor-player';
import { SavedGamePlayer, type SavedGame } from './ai-lab/saved-game-player';
import { GameCabinet } from './ai-lab/game-cabinet';
import { Hero, TopBar } from './ai-lab/hero';
import { shortTitle, worldUnits, type DashIntent } from './ai-lab/intent';
import { Library, useCatalog } from './ai-lab/library';
import { MetaChip } from './ai-lab/meta-chip';
import { PipelineRibbon } from './ai-lab/pipeline-ribbon';
import { PixelSprite } from './ai-lab/pixel-sprite';
import { PortedGames, portedCount, portedPlayers } from './ai-lab/ported-games';
import { RecoveryPanel } from './ai-lab/recovery-panel';

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
  intent?: DashIntent | null;
}

function scrollToId(id: string, focus?: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
}

export function MotionWorkbench() {
  const [savedExperiment, setSavedExperiment] = useState<{
    receipt: ExperimentReceipt;
    parent: string;
    candidate: string;
    download: string;
  } | null>(null);
  const [routeVersion, setRouteVersion] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const refreshHistory = useCallback(() => setCatalogRevision((value) => value + 1), []);
  const selectVersion = useCallback((id: string) => {
    setPractice(false);
    history.pushState({}, '', linkHref('/?artifact=' + id));
    setRouteVersion((value) => value + 1);
  }, []);
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
  const [componentPulse, dashComponent] = useDashPulse();
  const [donorOpen, setDonorOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState<string | null>(null);
  const catalog = useCatalog(base?.componentId ?? null, catalogRevision);
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
        if (controller.signal.aborted) return;
        setBase(value);
        setError('');
        setCheckpoint(null);
        setExperiment(null);
        setSavedExperiment(null);
        setActive(null);
        const id =
          new URL(location.href).searchParams.get('artifact') ??
          window.__MOTION_TRANSFER__?.featuredArtifactId;
        setViewedId(id ?? value.id);
        if (!id || id === value.id) return;
        if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid saved artifact identity');
        const receipt = await fetchJson<{
          passed: boolean;
          componentId: string;
          recipient: { id: string };
          rule?: { kind: string } | null;
          experiment?: ExperimentReceipt;
          parentArtifactId: string;
          intent?: { unitScale: number; activation: string; direction: string } | null;
        }>('/artifacts/' + id + '/receipt.json', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (receipt.componentId !== value.componentId || receipt.recipient.id !== 'parallaxia')
          throw Error('Wrong recipient or component');
        if (receipt.experiment)
          setSavedExperiment({
            receipt: receipt.experiment,
            parent: '/parents/' + receipt.parentArtifactId,
            candidate: '/artifacts/' + id + '/play.html',
            download: '/artifacts/' + id + '/experiment.json',
          });
        if (receipt.passed === false || receipt.experiment?.satisfied === false) {
          setError(
            'Saved diagnostic: goal unsatisfied. The original integration remains selected.',
          );
          return;
        }
        setActive({
          id,
          play: '/artifacts/' + id + '/play.html',
          download: '/artifacts/' + id + '/download.zip',
          report: '/artifacts/' + id + '/receipt.json',
          rule: receipt.rule,
          intent: receipt.intent,
        });
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
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);
  const playback = readGenerationMode() === 'playback-only';
  const local = !window.__MOTION_TRANSFER__ && readGenerationMode() === 'local';
  const number = (id: string) => {
    const index = catalog.versions.findIndex((version) => version.id === id);
    return index === -1 ? null : index + 1;
  };
  const labelFor = (id: string) => {
    if (base && id === base.id) return 'Original integration';
    const n = number(id);
    const version = catalog.versions.find((entry) => entry.id === id);
    return n ? `v${n} · ${shortTitle(version?.prompt ?? version?.summary)}` : 'Saved version';
  };
  const currentId = active?.id ?? base?.id ?? '';
  const jujumpPage = readJujumpComparison() ?? '/accepted/jujump/index.html';
  const jujumpFolder = jujumpPage.replace(/index\.html$/, '');
  type SavedEntry = SavedGame & Omit<Destination, 'id' | 'name'>;
  const savedGames: SavedEntry[] = base
    ? [
        {
          id: 'jujump',
          name: 'JUJUMP',
          genre: 'One-button platformer · ABA Games',
          sprite: 'jumper',
          status: 'saved',
          note: 'Same accepted component. Play the original and the borrowed dash side by side.',
          credit: 'by Kenta Cho / ABA Games',
          aspect: 1,
          frames: [
            {
              kind: 'before',
              title: 'JUJUMP',
              src: jujumpFolder + 'original.html?mode=original',
              sameOrigin: true,
              controls: [{ action: 'jump', label: 'Start / jump', kbd: 'Space' }],
            },
            {
              kind: 'after',
              title: 'JUJUMP + dash',
              src: jujumpFolder + 'transferred.html?mode=transfer',
              sameOrigin: true,
              controls: [
                { action: 'jump', label: 'Start / jump', kbd: 'Space' },
                { action: 'dash', label: 'Hold to dash', kbd: 'D' },
              ],
            },
          ],
          keeps: 'Gravity, weakening air jumps, platform landing and scrolling.',
          carries:
            'The same 8-tick burst and 25-tick recharge, now across the air while gravity keeps pulling.',
          help: 'Click a game to focus it. Space starts and jumps; hold D to dash in the right-hand game.',
          idleLabel: 'PRESS SPACE TO START',
          readyLabel: 'DASH READY · HOLD D',
          extra: { label: 'Standalone developer project ↗', href: jujumpPage },
        },
        ...(base.historicalRoadster
          ? [
              {
                id: 'roadster',
                name: 'RDSTR Stunts',
                genre: '3D stunt driving · sebayaki',
                sprite: 'car' as const,
                status: 'historical' as const,
                note: 'An earlier saved transfer, kept with its original artifact bytes.',
                credit: 'by sebayaki',
                aspect: 1.5,
                frames: [
                  {
                    kind: 'after' as const,
                    title: 'RDSTR Stunts + air dash',
                    src: base.historicalRoadster,
                    sameOrigin: false,
                    controls: [
                      { action: 'run' as const, label: 'Run the stunt' },
                      { action: 'dash' as const, label: 'Air dash', kbd: 'X' },
                      { action: 'restart' as const, label: 'Restart' },
                    ],
                  },
                ],
                keeps: 'Native driving, gravity, rotation, terrain and collision rules.',
                carries: 'The same burst and recharge, mapped to horizontal driving world units.',
                help: 'Hold ↑ in the game to drive, or press Run the stunt for autopilot. Once airborne, hold X or Air dash.',
                idleLabel: 'LAUNCH OFF THE RAMP · THEN HOLD X',
                readyLabel: 'AIRBORNE · HOLD X TO DASH',
              },
            ]
          : []),
        ...(local
          ? [
              {
                id: 'paku-paku',
                name: 'PAKU PAKU',
                genre: 'Dot-eating maze · ABA Games',
                sprite: 'dots' as const,
                status: 'historical' as const,
                note: 'The first saved transfer of the recovered dash.',
                credit: 'by Kenta Cho / ABA Games',
                aspect: 2,
                frames: [
                  {
                    kind: 'before' as const,
                    title: 'PAKU PAKU',
                    src: '/play?mode=original',
                    sameOrigin: true,
                    controls: [{ action: 'jump' as const, label: 'Start / turn', kbd: 'Space' }],
                  },
                  {
                    kind: 'after' as const,
                    title: 'PAKU PAKU + dash',
                    src: '/play?mode=transfer',
                    sameOrigin: true,
                    controls: [
                      { action: 'jump' as const, label: 'Start / turn', kbd: 'Space' },
                      { action: 'dash' as const, label: 'Hold to dash', kbd: 'D' },
                    ],
                  },
                ],
                keeps: 'Turning, pellets, ghosts, power cookies and wraparound.',
                carries: 'A quick burst in your direction, with the donor’s duration and recharge.',
                help: 'Click a game to focus it. Space starts and turns; hold D to dash in the right-hand game.',
                idleLabel: 'PRESS SPACE TO START',
                readyLabel: 'DASH READY · HOLD D',
              },
            ]
          : []),
      ]
    : [];
  const destinations: Destination[] = base
    ? [
        {
          id: 'parallaxia',
          name: 'PARALLAXIA',
          genre: 'Bullet-hell shooter · ABA Games',
          status: 'live',
          sprite: 'ship',
          note: 'Live Meta remixes, the dash-end combo and checkpoint experiments.',
        },
        ...savedGames.map(({ id, name, genre, status, sprite, note }) => ({
          id,
          name,
          genre,
          status,
          sprite,
          note,
        })),
      ]
    : [];
  const openGame = [...savedGames, ...portedPlayers()].find((game) => game.id === gameOpen) ?? null;
  const badge = practice
    ? 'PRACTICE · SHIELD ON · BASELINE REUSE'
    : active
      ? active.fresh
        ? 'FRESH FROM MUSE SPARK · VERIFIED CHILD'
        : 'SAVED META-GENERATED CHILD · REUSE'
      : 'VERIFIED REUSE · NO MODEL REQUEST';
  return (
    <AgeProvider>
      <main className="motion-workbench ai-lab">
        <TopBar playback={playback} />
        <AgeAcknowledgment />
        <Hero playback={playback} savedCount={catalog.loading ? null : catalog.versions.length} />
        <PipelineRibbon onPlayDonor={() => setDonorOpen(true)} />
        <RecoveryPanel />
        <section className="stage" id="stage" aria-label="PARALLAXIA movement workbench">
          <aside className="component-card" aria-labelledby="component-title">
            <p className="eyebrow">STEP 1 · THE COMPONENT</p>
            <button
              type="button"
              className="component-card__art"
              onClick={() => setDonorOpen(true)}
              onPointerEnter={dashComponent}
              onFocus={dashComponent}
              aria-label="Play Dashy Dango, the original game"
            >
              <Afterimage pulse={componentPulse} trail>
                <PixelSprite name="courier" size={132} />
              </Afterimage>
              <span className="component-card__play" aria-hidden="true">
                ▶ PLAY THE ORIGINAL
              </span>
            </button>
            <h2 id="component-title">
              The dash <span>from Dashy Dango</span>
            </h2>
            <button
              type="button"
              className="btn btn--light component-card__cta"
              onClick={() => setDonorOpen(true)}
            >
              ▶ Play Dashy Dango
            </button>
            <MetaChip model="wonder">recovered from compiled WebAssembly</MetaChip>
            <dl className="component-card__specs">
              <div>
                <dt>active</dt>
                <dd>8 ticks</dd>
              </div>
              <div>
                <dt>burst</dt>
                <dd>60 px</dd>
              </div>
              <div>
                <dt>recharge</dt>
                <dd>25 ticks</dd>
              </div>
              <div>
                <dt>first ready</dt>
                <dd>10 ticks</dd>
              </div>
            </dl>
            <p>
              A light-speed burst that leaves afterimages: direction locks for the whole dash, then
              it recharges. It runs without the donor&apos;s binary, renderer or assets.
            </p>
            <p className="component-card__id" title={base?.componentId}>
              Component <code>{base ? base.componentId.slice(0, 16) + '…' : 'Loading…'}</code>
            </p>
            {base ? (
              <p className="component-card__mapping">
                Default mapping: {base.recipient.unitMapping}
              </p>
            ) : null}
            <p className="component-card__links">
              <a href={linkHref('/donor/play')}>Compiled donor</a>
              {base ? (
                <>
                  {' '}
                  ·{' '}
                  <a href={linkHref(`/parallaxia/artifacts/${base.id}/adapter.ts`)}>
                    Adapter source
                  </a>{' '}
                  ·{' '}
                  <a href={linkHref(`/parallaxia/artifacts/${base.id}/notices.txt`)}>
                    Licenses and notices
                  </a>
                </>
              ) : null}
            </p>
          </aside>
          {base ? (
            <GameCabinet
              frameRef={frame}
              channel={channel}
              practice={practice}
              heading={
                practice ? 'Practice challenge · shield enabled' : 'PARALLAXIA · native collisions'
              }
              versionLabel={
                practice ? 'Shielded practice · baseline integration' : labelFor(currentId)
              }
              badge={badge}
              badgeTone={practice || !active ? 'reuse' : active.fresh ? 'fresh' : 'saved'}
              frame={
                <iframe
                  key={practice ? 'practice:' + base.id : (active?.id ?? base.id)}
                  ref={frame}
                  id="parallaxia-game"
                  title="PARALLAXIA with accepted recovered dash"
                  src={linkHref(
                    (practice ? base.practice : (active?.play ?? base.play)) +
                      '#channel=' +
                      channel,
                  )}
                  sandbox="allow-scripts"
                  allow="autoplay"
                />
              }
              controls={
                <>
                  <div className="keys">
                    {!practice &&
                      [
                        ['left', '←'],
                        ['up', '↑'],
                        ['down', '↓'],
                        ['right', '→'],
                      ].map(([control, label]) => (
                        <HoldButton
                          key={control}
                          className={'key key--' + control}
                          aria-label={'Ship ' + control}
                          onHold={(pressed) => send('parallaxia-input', { control, pressed })}
                        >
                          {label}
                        </HoldButton>
                      ))}
                  </div>
                  <div className="keys keys--actions">
                    {!practice && (
                      <HoldButton
                        className="key key--action"
                        aria-label="Ship shot"
                        onHold={(pressed) => send('parallaxia-input', { control: 'shot', pressed })}
                      >
                        Shoot <kbd>Z</kbd>
                      </HoldButton>
                    )}
                    <HoldButton
                      className="key key--action key--dash"
                      onHold={(pressed) => send('dash', { pressed })}
                    >
                      Dash <kbd>X</kbd>
                    </HoldButton>
                  </div>
                  <div className="cabinet__buttons">
                    <button
                      className="btn btn--light btn--small"
                      onClick={() =>
                        send(practice ? 'challenge-command' : 'roadster-restart', {
                          action: 'start',
                        })
                      }
                    >
                      Restart
                    </button>
                    {practice && (
                      <button
                        className="btn btn--light btn--small"
                        onClick={() => send('challenge-command', { action: 'borrow' })}
                      >
                        Borrow dash
                      </button>
                    )}
                    <button
                      className="btn btn--ghost btn--small"
                      onClick={() => setPractice((value) => !value)}
                    >
                      {practice ? 'Play with native collisions' : 'Open shielded practice'}
                    </button>
                    {active && (
                      <button
                        className="btn btn--ghost btn--small"
                        onClick={() => {
                          if (base) selectVersion(base.id);
                        }}
                      >
                        Keep original integration
                      </button>
                    )}
                  </div>
                </>
              }
            >
              {practice && (
                <p className="cabinet__note">
                  Shielded practice reuses the baseline integration. Return to native play to use
                  your selected child.
                </p>
              )}
              {active?.intent && !practice && (
                <p className="cabinet__note">
                  Selected version: {worldUnits(active.intent)} world-unit nominal burst ·{' '}
                  {active.intent.direction} · {active.intent.activation}. Native bounds and
                  collisions still apply.
                </p>
              )}
              {active?.rule?.kind === 'dash-end-shot' && (
                <p className="cabinet__note">
                  Host composition: dash-end → one next-tick native shot attempt, subject to the
                  native cooldown and projectile cap.
                </p>
              )}
              <p className="cabinet__help">
                Click the game to focus it. Arrows/WASD move; Space/Z shoots; X dashes. Native mode
                adds no invulnerability. Practice measures position with a shield, not survival.
              </p>
              <p className="cabinet__links">
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
            </GameCabinet>
          ) : (
            <article className="cabinet cabinet--loading">
              <p role="status">{error || 'Loading the verified integration…'}</p>
            </article>
          )}
          <DestinationPicker
            destinations={destinations}
            onPlayLive={() => scrollToId('stage')}
            onOpen={setGameOpen}
            portedCount={portedCount}
          />
        </section>
        {error && base && (
          <p role="alert" className="workbench-alert">
            {error}
          </p>
        )}
        {savedExperiment && (
          <ExperimentResults
            receipt={savedExperiment.receipt}
            parentPlay={savedExperiment.parent}
            candidatePlay={savedExperiment.candidate}
            download={savedExperiment.download}
          />
        )}
        {base && (
          <div className="workshop">
            <MotionGeneration
              onPublished={refreshHistory}
              experiment={experiment}
              parentId={active?.id ?? base.id}
              parentIntent={active?.intent ?? base.intent ?? null}
              parentLabel={labelFor(active?.id ?? base.id)}
              onPlay={(job: MotionJob) => {
                if (!job.artifactId || !job.urls) return;
                setPractice(false);
                setCheckpoint(null);
                setExperiment(null);
                setSavedExperiment(null);
                setViewedId(job.artifactId);
                setActive({
                  id: job.artifactId,
                  play: job.urls.play,
                  download: '/artifacts/' + job.artifactId + '/download.zip',
                  report: '/artifacts/' + job.artifactId + '/receipt.json',
                  fresh: true,
                  rule: job.rule,
                  intent: job.intent,
                });
                history.pushState({}, '', linkHref('/?artifact=' + job.artifactId));
                scrollToId('stage');
              }}
            />
            {!practice && !playback && (
              <CheckpointGoals
                checkpoint={checkpoint}
                capture={(curated) =>
                  send(curated ? 'parallaxia-curated-checkpoint' : 'parallaxia-checkpoint')
                }
                resume={() => send('parallaxia-resume')}
                onFreeze={setExperiment}
              />
            )}
          </div>
        )}
        <PortedGames onPlay={setGameOpen} />
        {base && (
          <Library
            baseline={base}
            catalog={catalog}
            activeId={viewedId ?? active?.id ?? base.id}
            onSelect={(id) => {
              selectVersion(id);
              scrollToId('stage');
            }}
            onRemix={
              playback
                ? undefined
                : (id) => {
                    selectVersion(id);
                    scrollToId('motion-creation', 'motion-prompt');
                  }
            }
          />
        )}
        {openGame && (
          <SavedGamePlayer
            game={openGame}
            onClose={() => setGameOpen(null)}
            onTryLive={() => {
              setGameOpen(null);
              scrollToId('motion-creation', 'motion-prompt');
            }}
          />
        )}
        {donorOpen && (
          <DonorPlayer
            onClose={() => setDonorOpen(false)}
            onTryTransfer={() => {
              setDonorOpen(false);
              scrollToId('stage');
            }}
          />
        )}
        <LiveMechanicsEvidence />
        <footer className="ai-lab-footer">
          <p>
            <span className="ai-lab-footer__mark">
              motion<span>/</span>transfer
            </span>{' '}
            · built on <MetaChip model="wonder" /> <MetaChip /> through the Meta Model API.
          </p>
          <p>
            Dashy Dango by samX500 and willGuimont · PARALLAXIA and JUJUMP by Kenta Cho / ABA Games
            · RDSTR Stunts by sebayaki. Recovery tooling, adapters, host hooks, experiments,
            composition and verification are this project&apos;s added work.{' '}
            {base && <a href={linkHref(`/parallaxia/artifacts/${base.id}/notices.txt`)}>Notices</a>}
          </p>
        </footer>
      </main>
    </AgeProvider>
  );
}
