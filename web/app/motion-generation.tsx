import { useEffect, useState } from 'react';
import { readGenerationMode } from './data-source';
import { ApiError, fetchJson, postJson, errorMessage } from './api';
import { ExperimentResults, type ExperimentReceipt } from './motion-experiment';
import { readSession, writeSession } from './creator/session';
import type { PendingRemix } from './creator/types';
import { Celebrate } from './ai-lab/celebrate';
import { diffIntent, type DashIntent, intentBadges, readRequest } from './ai-lab/intent';
import { MetaChip } from './ai-lab/meta-chip';
import { MetaOutputPanel, attemptsOf, checksOf, useArtifactEvidence } from './ai-lab/meta-output';
import { PipelineTrack, type JobEvent } from './ai-lab/pipeline-track';
import { PixelSprite } from './ai-lab/pixel-sprite';

export interface MotionJob {
  id: string;
  status: string;
  parentArtifactId: string;
  artifactId: string | null;
  summary: string | null;
  error: string | null;
  estimatedCostUsd: number;
  intent: { unitScale: number; activation: string; direction: string } | null;
  createdAt: string;
  finishedAt: string | null;
  urls: { play: string; download: string; receipt: string; parent?: string } | null;
  experiment?: ExperimentReceipt | null;
  rule?: { id: string | null; kind: string } | null;
  events?: JobEvent[];
}
const terminal = (status: string) =>
  ['ready', 'failed', 'unsupported', 'cancelled', 'unsuccessful'].includes(status);

const PROMPTS = {
  adapt: 'Make the dash backward, only on a fresh press.',
  shot: 'When the recovered dash ends, fire one additional native shot. Keep the dash mapping unchanged.',
  remove: 'Remove the dash-end shot rule. Keep the dash mapping unchanged.',
};
const CHIPS: { label: string; prompt: string; composition: 'dash-end-shot' | '' }[] = [
  { label: '← Backward', prompt: 'Make the dash backward.', composition: '' },
  { label: '⏎ Fresh press only', prompt: 'Only dash on a fresh press.', composition: '' },
  { label: '½ Half as far', prompt: 'Half as far.', composition: '' },
  { label: '2× Twice as far', prompt: 'Make the dash twice as far.', composition: '' },
  { label: '3 world units', prompt: 'Make the dash 3 world units.', composition: '' },
  { label: '✦ Shot on dash-end', prompt: PROMPTS.shot, composition: 'dash-end-shot' },
];

/** A verified publish: Meta's own words, what changed, the checks, and play. */
function ResultCard({
  job,
  parentIntent,
  onPlay,
}: {
  job: MotionJob;
  parentIntent: DashIntent | null;
  onPlay(): void;
}) {
  const evidence = useArtifactEvidence(job.artifactId);
  const [open, setOpen] = useState(false);
  const attempts = attemptsOf(evidence.generation);
  const last = attempts[attempts.length - 1];
  const checks = checksOf(evidence.receipt);
  const all = [...checks.native, ...checks.browser];
  const tokens = attempts.reduce(
    (sum, attempt) => sum + (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0),
    0,
  );
  const changes = diffIntent(parentIntent, job.intent);
  return (
    <div className="result">
      <Celebrate />
      <p className="eyebrow">VERIFIED · SAVED TO THE LIBRARY</p>
      <h3>{job.summary ?? 'New version ready'}</h3>
      {last?.message ? (
        <blockquote className="result__quote">
          <PixelSprite name="spark" size={36} mood="cheer" />
          <span>
            “{last.message}” <cite>— Muse Spark</cite>
          </span>
        </blockquote>
      ) : null}
      {changes.length > 0 ? (
        <ul className="result__diff" aria-label="What changed from the parent">
          {changes.map((change) => (
            <li key={change.key} className={change.changed ? 'is-changed' : undefined}>
              <small>{change.label}</small>
              {change.changed ? (
                <span>
                  {change.from} → <b>{change.to}</b>
                </span>
              ) : (
                <span>
                  {change.to} <em>inherited</em>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="result__stats">
        {[
          attempts.length > 0
            ? `${attempts.length} Meta ${attempts.length > 1 ? 'responses (one repair)' : 'response'}`
            : null,
          tokens > 0 ? `${tokens.toLocaleString()} tokens` : null,
          all.length > 0
            ? `${all.filter((check) => check.passed).length}/${all.length} checks passed`
            : null,
          `$${job.estimatedCostUsd.toFixed(5)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="result__actions">
        <button id="motion-play-child" className="btn btn--primary btn--large" onClick={onPlay}>
          ▶ Play it now
        </button>
        {job.artifactId ? (
          <button
            type="button"
            className="btn btn--ghost"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide what Meta wrote' : 'See what Meta wrote'}
          </button>
        ) : null}
      </p>
      {open && job.artifactId ? <MetaOutputPanel artifactId={job.artifactId} /> : null}
    </div>
  );
}

export function MotionGeneration({
  parentId,
  onPlay,
  experiment = null,
  onPublished,
  parentIntent = null,
  parentLabel,
}: {
  parentId: string;
  experiment?: unknown;
  onPlay(job: MotionJob): void;
  onPublished?(): void;
  parentIntent?: DashIntent | null;
  parentLabel?: string;
}) {
  const playback = readGenerationMode() === 'playback-only';
  const [session] = useState(readSession);
  const [pending, setPending] = useState<PendingRemix | null>(playback ? null : session.pending);
  const [job, setJob] = useState<MotionJob | null>(null);
  const [prompt, setPrompt] = useState(session.pending?.prompt ?? PROMPTS.adapt);
  const [composition, setComposition] = useState<'dash-end-shot' | 'none' | ''>(
    session.pending?.composition ?? '',
  );
  const [enabled, setEnabled] = useState(false);
  const [maxJobCostUsd, setMaxJobCostUsd] = useState(7);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (job?.artifactId) onPublished?.();
  }, [job?.artifactId, onPublished]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<{ generationConfigured: boolean; maxJobCostUsd?: number }>(
      '/api/remixes/status',
      {
        signal: controller.signal,
      },
    )
      .then((status) => {
        setEnabled(status.generationConfigured === true);
        if (Number.isFinite(status.maxJobCostUsd) && Number(status.maxJobCostUsd) > 0)
          setMaxJobCostUsd(Number(status.maxJobCostUsd));
      })
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = pending.jobId
          ? await fetchJson<MotionJob>('/api/remixes/' + pending.jobId, {
              signal: controller.signal,
            })
          : await fetchJson<MotionJob>('/api/remixes', {
              ...postJson({
                idempotencyKey: pending.idempotencyKey,
                parentArtifactId: pending.parentArtifactId,
                prompt: pending.prompt,
                sessionId: session.sessionId,
                ...(pending.experiment ? { experiment: pending.experiment } : {}),
                ...(pending.composition ? { composition: pending.composition } : {}),
              }),
              signal: controller.signal,
            });
        if (controller.signal.aborted) return;
        setJob(result);
        setError('');
        setReconnecting(false);
        if (!pending.jobId) {
          const next = { ...pending, jobId: result.id };
          writeSession({ ...session, pending: next });
          setPending(next);
          return;
        }
        if (!terminal(result.status)) timer = setTimeout(() => void poll(), 800);
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(errorMessage(failure));
          if (
            failure instanceof ApiError &&
            failure.status >= 400 &&
            failure.status < 500 &&
            failure.status !== 408
          ) {
            setReconnecting(false);
            setPrompt(pending.prompt);
            setComposition(pending.composition ?? '');
            writeSession({ ...session, pending: null });
            setPending(null);
            return;
          }
          setReconnecting(true);
          timer = setTimeout(() => void poll(), 2500);
        }
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [pending, session]);
  useEffect(() => {
    if (!job || terminal(job.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job]);
  const busy = Boolean(pending && (!job || !terminal(job.status)));
  const reading =
    parentIntent && !experiment && !composition ? readRequest(prompt, parentIntent) : undefined;
  const unreadable = reading === null;
  if (playback)
    return (
      <section className="console console--offline" id="motion-creation">
        <p className="eyebrow">STEP 3 · REMIX WITH META</p>
        <h2>Saved verified versions</h2>
        <p>
          Creation is unavailable on this static copy. Playing, comparing and downloading these
          saved results makes no model request.
        </p>
        <p>
          Every version in the library below was written by <MetaChip /> and checked by the isolated
          verifier. Open “What Meta wrote” on any card to see the exact response.
        </p>
      </section>
    );
  const elapsed =
    job &&
    Math.max(0, (Date.parse(job.finishedAt ?? '') || now) - Date.parse(job.createdAt)) / 1000;
  return (
    <section className="console" id="motion-creation" aria-labelledby="console-title">
      <header className="console__header">
        <p className="eyebrow">STEP 3 · REMIX WITH META</p>
        <h2 id="console-title">Adapt the dash</h2>
        <MetaChip>Meta Model API</MetaChip>
      </header>
      <p>
        Change distance, direction, or held/fresh-press activation. Other mapping properties are
        inherited. The parent stays playable while Meta generates and the isolated worker checks the
        candidate.
      </p>
      {parentLabel ? (
        <p className="console__parent">
          Remixing <b>{parentLabel}</b> — unspecified properties are inherited.
        </p>
      ) : null}
      <form
        className="console__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !enabled || unreadable) return;
          const next = {
            experiment,
            composition: experiment ? null : composition || null,
            idempotencyKey: crypto.randomUUID(),
            parentArtifactId: parentId,
            prompt: prompt.trim(),
            jobId: null,
          };
          writeSession({ ...session, pending: next });
          setJob(null);
          setPending(next);
          setError('');
          setReconnecting(false);
        }}
      >
        {experiment ? (
          <p className="console__frozen">
            ◎ Frozen checkpoint attached. Muse Spark may propose one dash tick and a supported
            mapping; the target and constraints stay fixed.
          </p>
        ) : (
          <label className="console__mode">
            Mode{' '}
            <select
              id="motion-task"
              value={composition}
              onChange={(event) => {
                const value = event.target.value as 'dash-end-shot' | 'none' | '';
                setComposition(value);
                setPrompt(
                  value === 'dash-end-shot'
                    ? PROMPTS.shot
                    : value === 'none'
                      ? PROMPTS.remove
                      : PROMPTS.adapt,
                );
              }}
            >
              <option value="">Adapt distance, direction or activation</option>
              <option value="dash-end-shot">Compose dash-end → native shot</option>
              <option value="none">Remove composition, keep the dash</option>
            </select>
          </label>
        )}
        {composition && !experiment && (
          <p className="console__hint">
            One native shot attempt on the next tick. Ordinary shooting runs first; the native
            cooldown and projectile cap can suppress the extra shot. A suppressed action is
            consumed.
          </p>
        )}
        <label htmlFor="motion-prompt" className="console__label">
          Request a supported alternative
        </label>
        <div className="console__prompt">
          <span aria-hidden="true">&gt;</span>
          <textarea
            id="motion-prompt"
            maxLength={1000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            required
          />
        </div>
        {!experiment && (
          <div className="chips" role="group" aria-label="Example requests">
            {CHIPS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className={'chip' + (prompt === chip.prompt ? ' is-on' : '')}
                disabled={busy}
                onClick={() => {
                  setComposition(chip.composition);
                  setPrompt(chip.prompt);
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {reading ? (
          <p className="console__reading">
            Muse Spark will read this as:{' '}
            <b>
              {intentBadges(reading)
                .map((badge) => badge.label)
                .join(' · ')}
            </b>
          </p>
        ) : null}
        {unreadable ? (
          <p className="console__reading console__reading--stuck">
            Try a change this version supports: backward or forward, a fresh press or hold, half or
            twice as far, or a distance from 1.5 to 12 units.
          </p>
        ) : null}
        <div className="console__submit">
          <button
            id="motion-submit"
            className="btn btn--primary btn--large"
            disabled={!enabled || busy || unreadable}
          >
            {experiment
              ? '⚡ Generate alternative · frozen checkpoint'
              : '⚡ Generate & verify with Muse Spark'}
          </button>
          <p className="console__budget">
            Maximum ${maxJobCostUsd} for the whole job, including at most one repair. Refresh
            reconnects to this job. Uncertain charges remain reserved.
          </p>
        </div>
      </form>
      {!enabled && (
        <p className="console__offline-note">
          Generation is unavailable in this process. Saved play remains available. Start the
          configured local preview with Docker and Standard Meta credentials to create a new
          version.
        </p>
      )}
      {job && (
        <div role="status" id="motion-job" className="console__job">
          <p className="console__status">
            <span className={'status-dot is-' + job.status} aria-hidden="true" />
            {job.status} · {elapsed}s · estimated ${job.estimatedCostUsd.toFixed(5)}
          </p>
          <PipelineTrack
            job={job}
            experiment={Boolean(job.experiment ?? pending?.experiment)}
            now={now}
          />
          {job.status !== 'ready' && (job.summary ?? job.error) ? (
            <p className="console__summary">{job.summary ?? job.error}</p>
          ) : null}
          {terminal(job.status) && (
            <p className="console__kept">
              The original and every published parent remain available. Requests and failures are
              retained with the job.
            </p>
          )}
          {!terminal(job.status) && (
            <button
              className="btn btn--ghost btn--small"
              onClick={() => {
                void fetchJson(
                  '/api/remixes/' + job.id + '/cancel',
                  postJson({ sessionId: session.sessionId }),
                ).catch((failure) => setError(errorMessage(failure)));
              }}
            >
              Cancel future stages
            </button>
          )}
        </div>
      )}
      {job?.status === 'ready' && (
        <ResultCard job={job} parentIntent={parentIntent} onPlay={() => onPlay(job)} />
      )}
      {job?.experiment && job.urls?.parent && (
        <ExperimentResults
          receipt={job.experiment}
          parentPlay={job.urls.parent}
          candidatePlay={job.urls.play}
          download={'/artifacts/' + job.artifactId + '/experiment.json'}
        />
      )}
      {error && (
        <p role="alert" className="console__error">
          {error}{' '}
          {reconnecting
            ? 'Reconnecting with the same request ID; no new request is created.'
            : 'Automatic retries stopped. Review the request before submitting again.'}
        </p>
      )}
    </section>
  );
}
