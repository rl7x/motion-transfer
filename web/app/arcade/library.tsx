import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, fetchJson } from '../api';
import { linkHref } from '../links';
import { intentBadges, shortTitle } from './intent';
import type { DashIntent } from './intent';
import { MetaChip } from './meta-chip';
import { MetaOutputPanel } from './meta-output';
import type { ReceiptRecord } from './meta-output';

export interface SavedVersion {
  id: string;
  parentArtifactId: string | null;
  componentId: string;
  recipientId: string;
  status: 'ready' | 'unsuccessful';
  prompt: string | null;
  summary: string | null;
  createdAt: string | null;
  estimatedCostUsd: number | null;
  intent: DashIntent | null;
}

export interface Catalog {
  versions: SavedVersion[];
  loading: boolean;
  error: string;
  refresh(): void;
}

/** Saved PARALLAXIA versions for one component, oldest first. Reading them makes no model request. */
export function useCatalog(componentId: string | null, revision: number): Catalog {
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(0);
  const refresh = useCallback(() => setManual((value) => value + 1), []);
  useEffect(() => {
    if (!componentId) return;
    const controller = new AbortController();
    setLoading(true);
    void fetchJson<{ versions?: SavedVersion[] }>('/api/catalog', { signal: controller.signal })
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setVersions(
          (catalog.versions ?? [])
            .filter(
              (version) =>
                version.recipientId === 'parallaxia' && version.componentId === componentId,
            )
            .sort(
              (left, right) =>
                (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
                left.id.localeCompare(right.id),
            ),
        );
        setError('');
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [componentId, revision, manual]);
  return { versions, loading, error, refresh };
}

type Kind = 'remix' | 'combo' | 'experiment' | 'diagnostic';
interface Classified {
  kind: Kind;
  checks: number | null;
}
const KIND_LABEL: Record<Kind, string> = {
  remix: 'REMIX',
  combo: 'COMBO',
  experiment: 'SOLVED MOMENT',
  diagnostic: 'DIAGNOSTIC',
};
const FILTERS: { id: 'all' | Kind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'remix', label: 'Remixes' },
  { id: 'combo', label: 'Combos' },
  { id: 'experiment', label: 'Solved moments' },
  { id: 'diagnostic', label: 'Diagnostics' },
];

function classify(version: SavedVersion, receipt: ReceiptRecord | undefined): Classified {
  const checks = receipt
    ? (receipt.native?.checks?.length ?? 0) + (receipt.browser?.checks?.length ?? 0) || null
    : null;
  if (version.status === 'unsuccessful') return { kind: 'diagnostic', checks };
  if (receipt?.kind === 'checkpoint-experiment') return { kind: 'experiment', checks };
  if (receipt?.rule?.kind === 'dash-end-shot') return { kind: 'combo', checks };
  return { kind: 'remix', checks };
}

/** Receipts tell combos and solved moments apart. Each is read once and cached. */
function useReceipts(ids: string[]) {
  const [receipts, setReceipts] = useState<Record<string, ReceiptRecord>>({});
  const requested = useRef(new Set<string>());
  const lifetime = useRef<AbortController | null>(null);
  const key = ids.join(',');
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const signal = lifetime.current?.signal;
    for (const id of key.split(',')) {
      if (!id || requested.current.has(id)) continue;
      requested.current.add(id);
      void fetchJson<ReceiptRecord>(`/artifacts/${id}/receipt.json`, { signal })
        .then((receipt) => {
          if (!signal?.aborted) setReceipts((value) => ({ ...value, [id]: receipt }));
        })
        .catch(() => {
          requested.current.delete(id);
        });
    }
  }, [key]);
  return receipts;
}

const money = (value: number | null) => (value === null ? null : `$${value.toFixed(4)}`);
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

export function Library({
  baseline,
  catalog,
  activeId,
  onSelect,
  onRemix,
}: {
  baseline: { id: string; intent?: DashIntent | null };
  catalog: Catalog;
  activeId: string;
  onSelect(id: string): void;
  onRemix?(id: string): void;
}) {
  const { versions, loading, error, refresh } = catalog;
  const [selectedId, setSelectedId] = useState(activeId);
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const receipts = useReceipts(versions.map((version) => version.id));
  useEffect(() => setSelectedId(activeId), [activeId]);
  useEffect(() => {
    if (loading) return;
    const ids = versions.map((version) => version.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current?.has(id));
    added.forEach((id) => seen.current?.add(id));
    if (added.length > 0) setFresh(added);
  }, [versions, loading]);
  useEffect(() => {
    if (inspectId) inspector.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [inspectId]);

  const number = new Map(versions.map((version, index) => [version.id, index + 1]));
  const label = (version: SavedVersion) => {
    const request = version.prompt ?? version.summary ?? 'Saved generation';
    return `Version ${number.get(version.id)} · ${version.status === 'unsuccessful' ? 'Goal unsatisfied · ' : ''}${request.slice(0, 100)}`;
  };
  const selected = versions.find((version) => version.id === selectedId);
  const canOpen = selectedId === baseline.id || Boolean(selected);
  const classified = new Map(
    versions.map((version) => [version.id, classify(version, receipts[version.id])]),
  );
  const counts = FILTERS.map((entry) => ({
    ...entry,
    count:
      entry.id === 'all'
        ? versions.length + 1
        : versions.filter((version) => classified.get(version.id)?.kind === entry.id).length,
  }));
  const shown = [...versions]
    .reverse()
    .filter((version) => filter === 'all' || classified.get(version.id)?.kind === filter);
  const inspected = inspectId ? versions.find((version) => version.id === inspectId) : undefined;

  return (
    <section className="library" id="library" aria-labelledby="library-title">
      <header className="library__header">
        <div>
          <p className="eyebrow">STEP 4 · THE LIBRARY</p>
          <h2 id="library-title">Saved generations</h2>
          <p>
            Every verified version stays saved on this server. Anyone visiting can play it again —
            switching versions restarts the game and makes no model request.
          </p>
        </div>
        <div className="version-toolbar">
          <label htmlFor="generation-version">Version</label>
          <select
            id="generation-version"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value={baseline.id}>Original integration</option>
            {[...versions].reverse().map((version) => (
              <option key={version.id} value={version.id}>
                {label(version)}
              </option>
            ))}
          </select>
          <button
            id="generation-play"
            className="btn btn--primary btn--small"
            disabled={!canOpen}
            onClick={() => onSelect(selectedId)}
          >
            {selected?.status === 'unsuccessful' ? 'View unsuccessful comparison' : 'Play version'}
          </button>
          <button className="btn btn--ghost btn--small" onClick={refresh} disabled={loading}>
            Refresh versions
          </button>
        </div>
      </header>
      {selected && (
        <div className="saved-version-details">
          <p>{selected.prompt ?? selected.summary}</p>
          {selected.createdAt && (
            <p>
              Saved {new Date(selected.createdAt).toLocaleString()}
              {selected.estimatedCostUsd !== null &&
                ` · generation estimate $${selected.estimatedCostUsd.toFixed(5)}`}
            </p>
          )}
          {selected.status === 'unsuccessful' && (
            <p>Goal unsatisfied. Reopen its recorded comparison; the original stays selected.</p>
          )}
          <p>
            <a href={linkHref(`/artifacts/${selected.id}/download.zip`)} download>
              Download this version
            </a>{' '}
            · <a href={linkHref(`/artifacts/${selected.id}/receipt.json`)}>Verification</a>
            {selected.parentArtifactId &&
              (selected.parentArtifactId === baseline.id ||
                versions.some((version) => version.id === selected.parentArtifactId)) && (
                <>
                  {' '}
                  ·{' '}
                  <button
                    className="btn btn--ghost btn--small"
                    onClick={() => onSelect(selected.parentArtifactId!)}
                  >
                    Play parent
                  </button>
                </>
              )}
          </p>
        </div>
      )}
      <div className="library__filters" role="group" aria-label="Filter saved generations">
        {counts.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={'chip' + (filter === entry.id ? ' is-on' : '')}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label} <span>{entry.count}</span>
          </button>
        ))}
      </div>
      <ul className="library__grid">
        {filter === 'all' || filter === 'remix' ? (
          <li
            className={
              'saved-card saved-card--original' + (activeId === baseline.id ? ' is-active' : '')
            }
          >
            <p className="saved-card__top">
              <span className="saved-card__kind">ORIGINAL</span>
              {activeId === baseline.id ? (
                <span className="saved-card__now">NOW PLAYING</span>
              ) : null}
            </p>
            <h3>Original integration</h3>
            <p className="badges">
              {intentBadges(baseline.intent ?? null).map((badge) => (
                <span key={badge.key} className="badge">
                  <b>{badge.glyph}</b> {badge.label}
                </span>
              ))}
            </p>
            <p className="saved-card__meta">
              VERIFIED REUSE · the accepted recovered dash, unchanged
            </p>
            <p className="saved-card__actions">
              <button
                className="btn btn--primary btn--small"
                aria-label="Play the original integration"
                onClick={() => onSelect(baseline.id)}
              >
                ▶ Play
              </button>
              {onRemix ? (
                <button
                  className="btn btn--light btn--small"
                  aria-label="Remix the original integration"
                  onClick={() => onRemix(baseline.id)}
                >
                  ⚡ Remix
                </button>
              ) : null}
            </p>
          </li>
        ) : null}
        {shown.map((version) => {
          const n = number.get(version.id) ?? 0;
          const info = classified.get(version.id) ?? { kind: 'remix', checks: null };
          const parent =
            version.parentArtifactId === baseline.id
              ? 'original'
              : version.parentArtifactId && number.has(version.parentArtifactId)
                ? `v${number.get(version.parentArtifactId)}`
                : null;
          const isNew = fresh.includes(version.id);
          return (
            <li
              key={version.id}
              className={
                `saved-card saved-card--${info.kind}` +
                (activeId === version.id ? ' is-active' : '') +
                (isNew ? ' is-new' : '')
              }
            >
              <p className="saved-card__top">
                <span className="saved-card__kind">
                  v{n} · {KIND_LABEL[info.kind]}
                </span>
                {activeId === version.id ? (
                  <span className="saved-card__now">NOW PLAYING</span>
                ) : null}
                {isNew ? <span className="saved-card__new">JUST SAVED</span> : null}
              </p>
              <h3 title={version.prompt ?? undefined}>
                {shortTitle(version.prompt ?? version.summary)}
              </h3>
              <p className="badges">
                {intentBadges(version.intent).map((badge) => (
                  <span key={badge.key} className="badge">
                    <b>{badge.glyph}</b> {badge.label}
                  </span>
                ))}
                {info.kind === 'combo' ? (
                  <span className="badge badge--combo">
                    <b>✦</b> shot on dash-end
                  </span>
                ) : null}
              </p>
              <p className="saved-card__meta">
                <MetaChip />
                {[
                  parent ? `child of ${parent}` : null,
                  info.checks ? `${info.checks} checks` : null,
                  money(version.estimatedCostUsd),
                  when(version.createdAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="saved-card__actions">
                <button
                  className="btn btn--primary btn--small"
                  aria-label={(version.status === 'unsuccessful' ? 'Compare v' : 'Play v') + n}
                  onClick={() => onSelect(version.id)}
                >
                  {version.status === 'unsuccessful' ? '◎ Compare' : '▶ Play'}
                </button>
                {onRemix && version.status === 'ready' ? (
                  <button
                    className="btn btn--light btn--small"
                    aria-label={`Remix v${n}`}
                    onClick={() => onRemix(version.id)}
                  >
                    ⚡ Remix
                  </button>
                ) : null}
                <button
                  className={
                    'btn btn--ghost btn--small' + (inspectId === version.id ? ' is-on' : '')
                  }
                  aria-label={`What Meta wrote for v${n}`}
                  aria-expanded={inspectId === version.id}
                  onClick={() =>
                    setInspectId((value) => (value === version.id ? null : version.id))
                  }
                >
                  What Meta wrote
                </button>
              </p>
            </li>
          );
        })}
      </ul>
      {inspected ? (
        <div ref={inspector} className="library__inspector">
          <MetaOutputPanel
            artifactId={inspected.id}
            title={`v${number.get(inspected.id)}`}
            onClose={() => setInspectId(null)}
          />
        </div>
      ) : null}
      {loading && <p role="status">Loading saved generations…</p>}
      {!loading && versions.length === 0 && !error && (
        <p>New verified generations will appear here automatically.</p>
      )}
      {error && <p role="note">Could not load saved generations: {error}</p>}
    </section>
  );
}
