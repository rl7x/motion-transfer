import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTransfer } from '../transfer-context';
import { useJob, useLabStatus } from '../hooks/use-job';
import { modelFailure, readGenerationMode, readRecovery, stageLabel } from '../data-source';
import { linkHref } from '../links';
import { useAgeAcknowledgment } from './age-acknowledgment';
import { ShareStatus } from './share-status';
import type { Job, ServiceStatus } from '../types';

interface AdaptRequest {
  idempotencyKey: string;
  parentArtifactId: string;
  prompt: string;
}
function RoadsterRemix({ status }: { status: ServiceStatus | null }) {
  const { artifact, openRoadsterArtifact } = useTransfer();
  const { allow } = useAgeAcknowledgment();
  const [prompt, setPrompt] = useState('');
  const playbackOnly = readGenerationMode() === 'playback-only';
  const flow = useJob<AdaptRequest, unknown>({
    storageKey: 'motion-roadster-request',
    legacyRunKey: 'motion-roadster-run',
    submitPath: '/api/roadster/transfers',
    pollPath: '/api/roadster/transfers/',
    onReady: async (job: Job<unknown>) => {
      if (job.artifactId) await openRoadsterArtifact(job.artifactId);
    },
  });
  const available =
    status?.enabled &&
    !status.activeRunId &&
    !status.unsettled &&
    (status.budget?.remainingUsd ?? 0) >= 0.005;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const continuing = flow.reconnect || Boolean(flow.pending?.id);
    if (!allow(continuing) || !artifact) return;
    void flow.submit({
      parentArtifactId: artifact.id,
      prompt: prompt || flow.pending?.request.prompt || '',
      idempotencyKey: crypto.randomUUID(),
    });
  };
  const intent = artifact?.intent;
  return (
    <section id="roadster-panel" className="remix-panel">
      <p className="eyebrow">FRESH META ADAPTATION / FROZEN ABILITY</p>
      <h3>Describe how the car should use it.</h3>
      <p>
        Meta writes the adapter. The recovered controller stays unchanged; the host checks both its
        mapping and the playable simulation before saving a version.
      </p>
      <dl id="inherited-intent" className="inherited-intent">
        <dt>Distance</dt>
        <dd>{intent ? `${60 * intent.unitScale} meters` : 'Loading the saved mapping…'}</dd>
        <dt>Direction</dt>
        <dd>{intent?.direction === 'opposite' ? 'Backward' : 'Forward along the stunt'}</dd>
        <dt>Activation</dt>
        <dd>{intent?.activation === 'press' ? 'Fresh press' : 'Hold to repeat'}</dd>
        <dt>Inherited</dt>
        <dd>
          {artifact?.parentArtifactId
            ? 'Keeps the parent rules except the checked change.'
            : readRecovery() === 'accepted'
              ? 'Accepted transfer. No earlier remix.'
              : 'Saved transfer. No earlier remix.'}
        </dd>
      </dl>
      <p id="roadster-mapping">
        {intent &&
          `Current: ${60 * intent.unitScale} meters · ${intent.direction === 'opposite' ? 'backward' : 'forward along the stunt'} · ${intent.activation === 'press' ? 'fresh press' : 'hold to repeat'} · airborne activation only`}
      </p>
      {artifact?.summary && <p id="checked-mapping">{artifact.summary}</p>}
      <p id="roadster-lineage">
        {artifact?.parentArtifactId ? (
          <>
            <a href={linkHref('/roadster/play/' + artifact.parentArtifactId)}>Parent version</a> →
            this checked transfer
          </>
        ) : readRecovery() === 'accepted' ? (
          'Accepted Roadster transfer. The native simulation is upstream work.'
        ) : (
          'Saved initial Meta transfer. The native simulation is upstream work.'
        )}
      </p>
      <a
        id="roadster-source"
        href={linkHref(
          playbackOnly && artifact?.id
            ? '/versions/' + artifact.id + '/download.zip'
            : '/api/roadster/artifacts/' + artifact?.id + '/source',
        )}
      >
        Download adapter, verification and source ↗
      </a>
      <form id="roadster-form" onSubmit={submit}>
        <label htmlFor="roadster-prompt">
          Change distance, direction or activation. Earlier changes carry forward.
        </label>
        <div className="prompt-row">
          <textarea
            id="roadster-prompt"
            rows={2}
            maxLength={600}
            required
            value={prompt || flow.pending?.request.prompt || ''}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Make the air dash go backward and require a fresh press. Keep its distance."
          />
          <button
            id="roadster-submit"
            disabled={
              flow.running || (!flow.reconnect && (playbackOnly || !artifact || !available))
            }
          >
            {flow.reconnect ? 'Reconnect to adaptation ↗' : 'Adapt with Meta ↗'}
          </button>
        </div>
      </form>
      <div className="examples">
        {[
          [
            'Backward + fresh press',
            'Make the air dash go backward and require a fresh press. Keep its current distance.',
          ],
          ['3-meter dash', 'Make it a shorter 3-meter dash. Keep everything else the same.'],
          ['Half as long', 'Make the dash half as long. Keep the direction and activation.'],
          ['One dash per flight', 'Give me one air dash, and restore it when I land.'],
        ].map(([label, value]) => (
          <button
            type="button"
            key={label}
            data-car-example={value}
            onClick={() => setPrompt(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p id="playback-note" className="saved-note">
        {playbackOnly
          ? 'Playback cannot start a model request. The version above stays playable.'
          : 'One dash per flight is not supported. Submitting it should explain the limit and leave this version in place.'}
      </p>
      <ol id="roadster-steps">
        {flow.job?.events.map((event, index) => (
          <li key={index}>
            {stageLabel(event.status)} ({event.status})
          </li>
        ))}
      </ol>
      <p id="roadster-progress" role="status" aria-live="polite">
        {flow.error
          ? modelFailure(flow.error)
          : flow.job?.status === 'ready'
            ? 'Checked and saved. Your earlier mapping changes are retained.'
            : flow.job
              ? `Model stage: ${stageLabel(flow.job.status)} (${flow.job.status}).`
              : 'Saved transfer is ready. A new model request starts only when you submit.'}
      </p>
      <p id="roadster-budget" className="saved-note">
        {status?.budget
          ? `Up to $0.05 / adapter request · shared development ceiling $${status.budget.limitUsd.toFixed(2)} · $${status.budget.remainingUsd.toFixed(3)} available`
          : 'Live adaptation is unavailable.'}
      </p>
    </section>
  );
}
function PakuRemix() {
  const { artifact, share } = useTransfer();
  const { allow } = useAgeAcknowledgment();
  const [prompt, setPrompt] = useState('');
  const playbackOnly = readGenerationMode() === 'playback-only';
  const status = useLabStatus('/api/remixes/status');
  const flow = useJob<AdaptRequest, unknown>({
    storageKey: 'motion-paku-request',
    submitPath: '/api/remixes',
    pollPath: '/api/runs/',
    onReady: async (job) => {
      if (job.artifactId) location.assign('/play/' + job.artifactId);
    },
  });
  const available =
    status?.enabled && !status.unsettled && (status.budget?.remainingUsd ?? 0) >= 0.005;
  const intent = artifact?.intent;
  return (
    <details id="remix-details" open={Boolean(artifact?.parentArtifactId)}>
      <summary>
        Remix this PAKU PAKU transfer with Meta <span>FRESH MODEL ACTIVITY ON SUBMIT</span>
      </summary>
      <section className="remix-panel" id="remix-panel" aria-label="Remix this game">
        <div className="remix-heading">
          <h3>Change the way it dashes.</h3>
          <button
            id="share-remix"
            type="button"
            onClick={() => {
              void share();
            }}
          >
            Copy this version ↗
          </button>
        </div>
        <p id="remix-summary">
          {intent
            ? `Your dash travels ${60 * intent.unitScale} pixels ${intent.direction === 'opposite' ? 'backward' : 'forward'}. ${intent.activation === 'press' ? 'Release D before the next dash.' : 'Keep D held to repeat after recharge.'}`
            : 'The recovered component stays frozen. Meta edits its adapter.'}
        </p>
        <p className="mapping" id="parent-mapping">
          {intent &&
            `Current: ${60 * intent.unitScale}px · ${intent.activation === 'held' ? 'hold to repeat' : 'fresh press'} · ${intent.direction === 'facing' ? 'forward' : 'backward'}`}
        </p>
        <p>
          <a id="source-download" href={linkHref('/api/artifacts/' + artifact?.id + '/source')}>
            Download source and report ↗
          </a>
        </p>
        <p id="remix-lineage" hidden={!artifact?.parentArtifactId}>
          <a href={linkHref('/')}>Original transfer</a> →{' '}
          <a id="parent-link" href={linkHref('/play/' + artifact?.parentArtifactId)}>
            Parent version
          </a>{' '}
          → this remix. Earlier rules stay until a checked change replaces them.
        </p>
        <form
          id="remix-form"
          onSubmit={(event) => {
            event.preventDefault();
            const continuing = flow.reconnect || Boolean(flow.pending?.id);
            if (!allow(continuing) || !artifact) return;
            void flow.submit({
              parentArtifactId: artifact.id,
              prompt,
              idempotencyKey: crypto.randomUUID(),
            });
          }}
        >
          <label htmlFor="remix-prompt">
            Describe a change to dash distance, activation, or direction.
          </label>
          <div className="prompt-row">
            <textarea
              id="remix-prompt"
              name="prompt"
              rows={2}
              maxLength={600}
              required
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Make the dash go backward and require a fresh press each time."
            />
            <button
              id="remix-submit"
              type="submit"
              disabled={
                flow.running || (!flow.reconnect && (playbackOnly || !artifact || !available))
              }
            >
              Remix with Meta ↗
            </button>
          </div>
        </form>
        <div className="examples">
          {[
            [
              'Backward + fresh press',
              'Make the dash go backward and require a fresh press each time.',
            ],
            [
              'Twice the distance',
              'Double the current dash distance, keeping everything else the same.',
            ],
            ['Short dash', 'Use a shorter 15-pixel dash, keeping everything else the same.'],
            ['One dash per flight', 'Give me one air dash, and restore it when I land.'],
          ].map(([label, value]) => (
            <button type="button" key={label} data-example={value} onClick={() => setPrompt(value)}>
              {label}
            </button>
          ))}
        </div>
        <ol id="remix-steps" aria-label="Remix progress">
          {flow.job?.events.map((event, index) => (
            <li className={event.status === flow.job?.status ? 'current' : ''} key={index}>
              {stageLabel(event.status)} ({event.status})
            </li>
          ))}
        </ol>
        <p id="remix-progress" role="status" aria-live="polite">
          {flow.error
            ? modelFailure(flow.error)
            : flow.job
              ? `Model stage: ${stageLabel(flow.job.status)} (${flow.job.status}).`
              : 'Each child must pass mapping and playable-browser checks. Unsupported requests leave this version unchanged.'}
        </p>
        <p id="remix-budget">
          {status?.budget
            ? `Local budget: $${status.budget.remainingUsd.toFixed(3)} remaining of $${status.budget.limitUsd.toFixed(2)} · max $0.03 / request`
            : 'Reading local remix availability…'}
        </p>
      </section>
    </details>
  );
}
export function RemixPanel({ status }: { status: ServiceStatus | null }) {
  const { destination, share } = useTransfer();
  const playbackOnly = readGenerationMode() === 'playback-only';
  const car = destination?.id === 'roadster',
    paku = destination?.id === 'paku-paku';
  return (
    <section className="remix-area" aria-labelledby="remix-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">05 / THEN MAKE IT YOURS</p>
          <h2 id="remix-heading">Adapt the ability after the transfer.</h2>
        </div>
        <button
          id="share-transfer"
          onClick={() => {
            void share();
          }}
        >
          Copy playable link ↗
        </button>
      </div>
      <ShareStatus id="share-status" fallback={destination?.id !== 'roadster'} />
      {(car || paku) && (
        <ul id="supported-capabilities">
          <li>Distance, within the checked range for this game.</li>
          <li>Direction: forward, or backward.</li>
          <li>Activation: hold to repeat, or a fresh press.</li>
          <li>A follow-up keeps the earlier changes that you do not replace.</li>
          <li>
            Not supported: one dash per flight, restoring a dash on landing, or a new physics rule.
            The request is explained and this version stays playable.
          </li>
        </ul>
      )}
      <p id="jujump-remix-note" hidden={destination?.id !== 'jujump'}>
        JUJUMP plays the saved dash transfer. Live edits are currently supported in PAKU PAKU and
        Roadster.
      </p>
      <div hidden={!car}>
        <RoadsterRemix status={status} />
      </div>
      {playbackOnly && !paku ? null : (
        <div hidden={!paku}>
          <PakuRemix />
        </div>
      )}
    </section>
  );
}
