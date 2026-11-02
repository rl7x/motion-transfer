import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTransfer } from '../transfer-context';
import { useJob } from '../hooks/use-job';
import { useResource } from '../hooks/use-resource';
import type { Job, ServiceStatus } from '../types';

interface AdaptRequest {
  idempotencyKey: string;
  parentArtifactId: string;
  prompt: string;
}
function RoadsterRemix({ status }: { status: ServiceStatus | null }) {
  const { artifact, openRoadsterArtifact } = useTransfer();
  const [prompt, setPrompt] = useState('');
  const flow = useJob<AdaptRequest, unknown>({
    storageKey: 'motion-roadster-request',
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
    if (artifact)
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
      <p id="roadster-mapping">
        {intent &&
          `Current: ${60 * intent.unitScale} meters · ${intent.direction === 'opposite' ? 'backward' : 'forward along the stunt'} · ${intent.activation === 'press' ? 'fresh press' : 'hold to repeat'} · airborne activation only`}
      </p>
      <p id="roadster-lineage">
        {artifact?.parentArtifactId ? (
          <>
            <a href={'/roadster/play/' + artifact.parentArtifactId}>Parent version</a> → this
            checked transfer
          </>
        ) : (
          'Saved initial Meta transfer. The native simulation is upstream work.'
        )}
      </p>
      <a id="roadster-source" href={'/api/roadster/artifacts/' + artifact?.id + '/source'}>
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
            disabled={flow.running || (!flow.reconnect && (!artifact || !available))}
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
      <ol id="roadster-steps">
        {flow.job?.events.map((event, index) => (
          <li key={index}>{event.status}</li>
        ))}
      </ol>
      <p id="roadster-progress" role="status" aria-live="polite">
        {flow.error ??
          (flow.job?.status === 'ready'
            ? 'Checked and saved. Your earlier mapping changes are retained.'
            : flow.job
              ? `Transfer ${flow.job.status}.`
              : 'Saved transfer is ready. A new model request starts only on submit.')}
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
  const { artifact } = useTransfer();
  const [prompt, setPrompt] = useState('');
  const [shareNote, setShareNote] = useState('');
  const { data: status } = useResource<ServiceStatus>('/api/remixes/status');
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
              const url = new URL('/play/' + artifact?.id, location.origin).href;
              void navigator.clipboard
                .writeText(url)
                .then(() =>
                  setShareNote(
                    'Playable link copied. It works while this local server is available.',
                  ),
                )
                .catch(() => setShareNote(url));
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
          <a id="source-download" href={'/api/artifacts/' + artifact?.id + '/source'}>
            Download source and report ↗
          </a>
        </p>
        <p id="remix-lineage" hidden={!artifact?.parentArtifactId}>
          <a href="/">Original transfer</a> →{' '}
          <a id="parent-link" href={'/play/' + artifact?.parentArtifactId}>
            Parent version
          </a>{' '}
          → this remix
        </p>
        <form
          id="remix-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (artifact)
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
              disabled={flow.running || !artifact || (!available && !flow.reconnect)}
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
          ].map(([label, value]) => (
            <button type="button" key={label} data-example={value} onClick={() => setPrompt(value)}>
              {label}
            </button>
          ))}
        </div>
        <ol id="remix-steps" aria-label="Remix progress">
          {flow.job?.events.map((event, index) => (
            <li className={event.status === flow.job?.status ? 'current' : ''} key={index}>
              {event.status}
            </li>
          ))}
        </ol>
        <p id="remix-progress" role="status" aria-live="polite">
          {flow.error ??
            (shareNote ||
              (flow.job
                ? `Remix ${flow.job.status}.`
                : 'Each child must pass mapping and playable-browser checks. Unsupported requests leave this version unchanged.'))}
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
      <p id="jujump-remix-note" hidden={destination?.id !== 'jujump'}>
        JUJUMP plays the saved dash transfer. Live edits are currently supported in PAKU PAKU and
        Roadster.
      </p>
      <div hidden={!car}>
        <RoadsterRemix status={status} />
      </div>
      <div hidden={!paku}>
        <PakuRemix />
      </div>
    </section>
  );
}
