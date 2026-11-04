import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  CreatorRequestError,
  loadCatalog,
  loadJob,
  loadStatus,
  playableAddress,
  submitRemix,
} from './api';
import { intentLines, statusText, terminalStatus } from './format';
import { readSession, writeSession } from './session';
import type { Catalog, CatalogVersion, CreatorSession, RemixJob } from './types';
import { MetaChip } from '../ai-lab/meta-chip';
import { MetaOutputPanel } from '../ai-lab/meta-output';
import { PipelineTrack } from '../ai-lab/pipeline-track';

const EXAMPLES = [
  ['Half as long', 'Make the dash half as long.'],
  ['Backward fresh press', 'Make it a backward dodge on a fresh press.'],
  ['Three meters', 'Make it three meters.'],
] as const;

function publishedVersion(job: RemixJob | null): CatalogVersion | null {
  if (!job || job.status !== 'ready' || !job.artifactId || !job.urls?.play) return null;
  return {
    id: job.artifactId,
    play: job.urls.play,
    download: job.urls.download,
    intent: job.intent,
    summary: job.summary,
    parentArtifactId: job.parentArtifactId || null,
    parentChain: job.parentChain,
    controls: null,
    source: job.urls.source,
    adapter: job.urls.adapter,
    report: job.urls.report,
    notices: job.urls.notices,
  };
}

function frameSrc(version: CatalogVersion, channel: string): string {
  if (version.controls !== 'challenge') return version.play;
  const joiner = version.play.includes('?') ? '&' : '?';
  return `${version.play}${joiner}quality=low#channel=${channel}`;
}

export function CreatorPage() {
  const [session, setSession] = useState<CreatorSession>(() => readSession());
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [statusConfigured, setStatusConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<RemixJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(() => readSession().pending?.prompt ?? '');
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [channel] = useState(() => crypto.randomUUID());
  const frame = useRef<HTMLIFrameElement>(null);
  const replayed = useRef(false);
  const openedJob = useRef<string | null>(null);
  const submitRequest = useRef<AbortController | null>(null);
  const jobId = session.pending?.jobId ?? null;
  const configured = catalog?.generationConfigured === true && statusConfigured === true;
  const busy = submitting || (job !== null && !terminalStatus(job.status));

  const versions = useMemo(() => {
    const map = new Map<string, CatalogVersion>();
    for (const parent of catalog?.parents ?? []) map.set(parent.id, parent);
    for (const artifact of catalog?.artifacts ?? []) map.set(artifact.id, artifact);
    const published = publishedVersion(job);
    if (published) map.set(published.id, published);
    return map;
  }, [catalog, job]);

  const active = (activeId && versions.get(activeId)) || catalog?.parents[0] || null;
  const lines = intentLines(active?.intent ?? null);
  const chain =
    (job?.parentChain && job.parentChain.length > 0 ? job.parentChain : null) ??
    (active?.parentChain && active.parentChain.length > 0 ? active.parentChain : null) ??
    (active ? [active.id] : []);

  function commit(next: CreatorSession) {
    writeSession(next);
    setSession(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [nextCatalog, nextStatus] = await Promise.all([
          loadCatalog(controller.signal),
          loadStatus(controller.signal).catch((error: unknown) => {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            return null;
          }),
        ]);
        if (controller.signal.aborted) return;
        setCatalog(nextCatalog);
        setStatusConfigured(nextStatus ? nextStatus.generationConfigured : null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'The catalog could not be loaded');
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!jobId) return undefined;
    const controller = new AbortController();
    let timer = 0;
    const tick = async () => {
      try {
        const next = await loadJob(jobId, controller.signal);
        if (controller.signal.aborted) return;
        setJob(next);
        if (!terminalStatus(next.status)) timer = window.setTimeout(() => void tick(), 400);
      } catch (error) {
        if (controller.signal.aborted) return;
        setJobError(
          error instanceof Error ? error.message : 'The remix status could not be loaded',
        );
      }
    };
    void tick();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (!catalog || !configured || replayed.current) return undefined;
    const pending = readSession().pending;
    if (!pending || pending.jobId) return undefined;
    replayed.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await submitRemix(
          {
            invite: readSession().invite,
            sessionId: readSession().sessionId,
            idempotencyKey: pending.idempotencyKey,
            parentArtifactId: pending.parentArtifactId,
            prompt: pending.prompt,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const saved = readSession();
        const nextSession = { ...saved, pending: { ...pending, jobId: next.id } };
        writeSession(nextSession);
        setSession(nextSession);
        setJob(next);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof CreatorRequestError && error.status === 0)) {
          const saved = readSession();
          const nextSession = { ...saved, pending: null };
          writeSession(nextSession);
          setSession(nextSession);
        }
        setJobError(error instanceof Error ? error.message : 'The remix could not be reconnected');
      }
    })();
    return () => controller.abort();
  }, [catalog, configured]);

  useEffect(() => () => submitRequest.current?.abort(), []);

  useEffect(() => {
    if (job?.status === 'ready' && job.artifactId && openedJob.current !== job.id) {
      openedJob.current = job.id;
      setActiveId(job.artifactId);
    }
  }, [job]);

  function send(type: string, extra: Record<string, unknown> = {}) {
    frame.current?.contentWindow?.postMessage({ type, channel, ...extra }, '*');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!configured || busy || !session.adult || session.invite.trim().length < 8 || !active)
      return;
    const text = prompt.trim();
    if (!text) return;
    const pending = {
      idempotencyKey: crypto.randomUUID(),
      parentArtifactId: active.id,
      prompt: text,
      jobId: null,
    };
    commit({ ...session, pending });
    const controller = new AbortController();
    submitRequest.current = controller;
    setSubmitting(true);
    setJob(null);
    setJobError(null);
    setCopyNote(null);
    try {
      const next = await submitRemix(
        {
          invite: session.invite.trim(),
          sessionId: session.sessionId,
          idempotencyKey: pending.idempotencyKey,
          parentArtifactId: pending.parentArtifactId,
          prompt: pending.prompt,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      commit({ ...readSession(), pending: { ...pending, jobId: next.id } });
      setJob(next);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof CreatorRequestError && error.status === 0)) {
        commit({ ...readSession(), pending: null });
      }
      setJobError(error instanceof Error ? error.message : 'The remix was not accepted');
    } finally {
      if (submitRequest.current === controller) submitRequest.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  async function copyAddress() {
    const address = playableAddress(active?.play);
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setShareFallback(null);
      setCopyNote('Playable address copied.');
    } catch {
      setShareFallback(address);
      setCopyNote('Copy was blocked. The address is in the field below.');
    }
  }

  const createDisabled =
    !configured ||
    busy ||
    !session.adult ||
    session.invite.trim().length < 8 ||
    !prompt.trim() ||
    !active;

  return (
    <main id="creator" className="ai-lab creator">
      <header className="creator__bar">
        <p className="wordmark">
          motion<span>/</span>transfer
        </p>
        <MetaChip>Meta Model API</MetaChip>
        <p className="edition">PLAY A SAVED VERSION</p>
      </header>
      <p id="creator-policy">
        No account. Playback does not send a model request. Creating a remix uses Standard Muse
        Spark and is limited to adults 18 and older with an invite code.
      </p>
      {loadError && (
        <p id="creator-load-error" role="alert">
          {loadError}
        </p>
      )}
      {catalog && !configured && (
        <p id="creator-disabled" role="status">
          Creation is disabled. The service has not configured generation. You can still play the
          saved version.
        </p>
      )}
      {active && (
        <section className="stage">
          <iframe
            id="creator-frame"
            ref={frame}
            src={frameSrc(active, channel)}
            title="Roadster"
            sandbox="allow-scripts"
            allow="autoplay"
          />
          <p id="creator-controls">
            Click the game, then use its own keys. The Roadster challenge frame dashes with X.
          </p>
          {active.controls === 'challenge' && (
            <button
              id="creator-watch"
              type="button"
              onClick={() => send('challenge-command', { action: 'original' })}
            >
              Watch original stunt
            </button>
          )}
        </section>
      )}
      <section>
        <h1>Borrow a dash</h1>
        {lines ? (
          <dl id="creator-intent">
            <dt>Distance</dt>
            <dd>{lines.distance}</dd>
            <dt>Direction</dt>
            <dd>{lines.direction}</dd>
            <dt>Activation</dt>
            <dd>{lines.activation}</dd>
          </dl>
        ) : (
          <p id="creator-intent-missing">
            This version did not include distance, direction, or activation.
          </p>
        )}
        <p id="creator-inherit">
          A follow-up keeps this version&apos;s full distance, direction, and activation, then
          applies only the change you describe.
        </p>
        {active?.summary && <p id="creator-summary">{active.summary}</p>}
        {chain.length > 0 && (
          <ol id="creator-chain">
            {chain.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  data-chain={id}
                  onClick={() => versions.has(id) && setActiveId(id)}
                >
                  {id}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="links">
          {active?.play && (
            <button id="creator-copy" type="button" onClick={() => void copyAddress()}>
              Copy playable address
            </button>
          )}
          {active?.download && (
            <a id="creator-download" href={active.download} download>
              Download
            </a>
          )}
          {active?.source && <a href={active.source}>Source</a>}
          {active?.adapter && <a href={active.adapter}>Adapter</a>}
          {active?.report && <a href={active.report}>Report</a>}
          {active?.notices && <a href={active.notices}>Notices</a>}
        </div>
        {active && catalog?.artifacts.some((artifact) => artifact.id === active.id) && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            aria-expanded={inspecting}
            onClick={() => setInspecting((value) => !value)}
          >
            {inspecting ? 'Hide what Meta wrote' : 'What Meta wrote'}
          </button>
        )}
        {inspecting &&
          active &&
          catalog?.artifacts.some((artifact) => artifact.id === active.id) && (
            <MetaOutputPanel artifactId={active.id} />
          )}
        {copyNote && <p id="creator-copy-note">{copyNote}</p>}
        {shareFallback && (
          <input
            id="creator-share-fallback"
            readOnly
            spellCheck={false}
            value={shareFallback}
            aria-label="Playable address"
          />
        )}
      </section>
      <form id="creator-form" onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor="creator-invite">Invite code</label>
        <input
          id="creator-invite"
          autoComplete="off"
          maxLength={128}
          value={session.invite}
          onChange={(event) => commit({ ...session, invite: event.target.value })}
        />
        <label className="check">
          <input
            id="creator-age"
            type="checkbox"
            checked={session.adult}
            onChange={(event) => commit({ ...session, adult: event.target.checked })}
          />
          I am 18 or older.
        </label>
        <label htmlFor="creator-prompt">Distance, direction, or activation</label>
        <textarea
          id="creator-prompt"
          rows={3}
          maxLength={1000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="examples">
          {EXAMPLES.map(([label, text]) => (
            <button key={label} type="button" onClick={() => setPrompt(text)}>
              {label}
            </button>
          ))}
        </div>
        <button id="creator-create" type="submit" disabled={createDisabled}>
          {busy ? 'Working' : 'Create remix'}
        </button>
      </form>
      {job && (
        <p id="creator-status" role="status" data-job-status={job.status}>
          {statusText(job.status)}
        </p>
      )}
      {job?.createdAt && (
        <PipelineTrack
          job={{ ...job, createdAt: job.createdAt, finishedAt: job.finishedAt ?? null }}
          experiment={false}
          now={Date.now()}
        />
      )}
      {(jobError || job?.error) && (
        <p id="creator-error" role="alert">
          {jobError || job?.error}
        </p>
      )}
    </main>
  );
}
