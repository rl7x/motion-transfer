import { useEffect, useState } from 'react';
import { readGenerationMode } from './data-source';
import { ApiError, fetchJson, postJson, errorMessage } from './api';
import { ExperimentResults, type ExperimentReceipt } from './motion-experiment';
import { readSession, writeSession } from './creator/session';
import type { PendingRemix } from './creator/types';
import { useAgeAcknowledgment } from './components/age-acknowledgment';

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
}
const terminal = (status: string) =>
  ['ready', 'failed', 'unsupported', 'cancelled', 'unsuccessful'].includes(status);

export function MotionGeneration({
  parentId,
  onPlay,
  experiment = null,
}: {
  parentId: string;
  experiment?: unknown;
  onPlay(job: MotionJob): void;
}) {
  const age = useAgeAcknowledgment();
  const playback = readGenerationMode() === 'playback-only';
  const [session] = useState(readSession);
  const [pending, setPending] = useState<PendingRemix | null>(playback ? null : session.pending);
  const [job, setJob] = useState<MotionJob | null>(null);
  const [prompt, setPrompt] = useState(
    session.pending?.prompt ?? 'Make the dash backward, only on a fresh press.',
  );
  const [composition, setComposition] = useState<'dash-end-shot' | 'none' | ''>(
    session.pending?.composition ?? '',
  );
  const [enabled, setEnabled] = useState(false);
  const [maxJobCostUsd, setMaxJobCostUsd] = useState(7);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(Date.now);
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
                adultConfirmed: true,
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
  if (playback)
    return (
      <section className="destination-section">
        <h2>Saved verified versions</h2>
        <p>
          Creation is unavailable on this static copy. Playing, comparing and downloading these
          saved results makes no model request.
        </p>
      </section>
    );
  return (
    <section className="destination-section" id="motion-creation">
      <h2>Adapt the dash</h2>
      <p>
        Change distance, direction, or held/fresh-press activation. Other mapping properties are
        inherited. The parent stays playable while Meta generates and the isolated worker checks the
        candidate.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !enabled) return;
          const submit = () => {
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
          };
          if (age.allow(false, submit)) submit();
        }}
      >
        {!experiment && (
          <label>
            Request kind{' '}
            <select
              id="motion-task"
              value={composition}
              onChange={(event) => {
                const value = event.target.value as 'dash-end-shot' | 'none' | '';
                setComposition(value);
                setPrompt(
                  value === 'dash-end-shot'
                    ? 'When the recovered dash ends, fire one additional native shot. Keep the dash mapping unchanged.'
                    : value === 'none'
                      ? 'Remove the dash-end shot rule. Keep the dash mapping unchanged.'
                      : 'Make the dash backward, only on a fresh press.',
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
          <p>
            One native shot attempt on the next tick. Ordinary shooting runs first; the native
            cooldown and projectile cap can suppress the extra shot. A suppressed action is
            consumed.
          </p>
        )}
        <label htmlFor="motion-prompt">Request a supported alternative</label>
        <textarea
          id="motion-prompt"
          maxLength={1000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          required
        />
        <button id="motion-submit" disabled={!enabled || busy}>
          {experiment
            ? 'Generate alternative · frozen checkpoint'
            : 'Generate and verify · Standard Meta'}
        </button>
      </form>
      {!enabled && (
        <p>
          Generation is unavailable in this process. Saved play remains available. Start the
          configured local preview with Docker and Standard Meta credentials to create a new
          version.
        </p>
      )}
      {job && (
        <div role="status" id="motion-job">
          <p>
            {job.status} ·{' '}
            {Math.max(0, (Date.parse(job.finishedAt ?? '') || now) - Date.parse(job.createdAt)) /
              1000}
            s · estimated ${job.estimatedCostUsd.toFixed(5)}
          </p>
          <p>{job.summary ?? job.error}</p>
          {job.status === 'ready' && (
            <button id="motion-play-child" onClick={() => onPlay(job)}>
              Play this checked candidate
            </button>
          )}
          {terminal(job.status) && (
            <p>
              The original and every published parent remain available. Requests and failures are
              retained with the job.
            </p>
          )}
          {!terminal(job.status) && (
            <button
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
      {job?.experiment && job.urls?.parent && (
        <ExperimentResults
          receipt={job.experiment}
          parentPlay={job.urls.parent}
          candidatePlay={job.urls.play}
          download={'/artifacts/' + job.artifactId + '/experiment.json'}
        />
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          {reconnecting
            ? 'Reconnecting with the same request ID; no new request is created.'
            : 'Automatic retries stopped. Review the request before submitting again.'}
        </p>
      )}
      <p>
        Maximum ${maxJobCostUsd} for the whole job, including at most one repair. Refresh reconnects
        to this job. Uncertain charges remain reserved.
      </p>
    </section>
  );
}
