import { useEffect, useState } from 'react';
import { errorMessage, fetchJson } from './api';
import { linkHref } from './links';

interface SavedVersion {
  id: string;
  parentArtifactId: string | null;
  componentId: string;
  recipientId: string;
  status: 'ready' | 'unsuccessful';
  prompt: string | null;
  summary: string | null;
  createdAt: string | null;
  estimatedCostUsd: number | null;
  intent: { activation: string; direction: string; unitScale: number } | null;
}

export function GenerationHistory({
  baseline,
  activeId,
  revision,
  onSelect,
}: {
  baseline: { id: string; componentId: string };
  activeId: string;
  revision: number;
  onSelect(id: string): void;
}) {
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [selectedId, setSelectedId] = useState(activeId);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => setSelectedId(activeId), [activeId]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void fetchJson<{ versions: SavedVersion[] }>('/api/catalog', { signal: controller.signal })
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setVersions(
          (catalog.versions ?? [])
            .filter(
              (version) =>
                version.recipientId === 'parallaxia' &&
                version.componentId === baseline.componentId,
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
  }, [baseline.componentId, revision, refresh]);
  const selected = versions.find((version) => version.id === selectedId);
  const label = (version: SavedVersion, index: number) => {
    const request = version.prompt ?? version.summary ?? 'Saved generation';
    return `Version ${index + 1} · ${version.status === 'unsuccessful' ? 'Goal unsatisfied · ' : ''}${request.slice(0, 100)}`;
  };
  const canOpen = selectedId === baseline.id || Boolean(selected);
  return (
    <section className="generation-history" aria-label="Saved generations">
      <h2>Saved generations</h2>
      <p>
        Earlier verified candidates stay saved on this server. Switching versions restarts the game
        and makes no model request.
      </p>
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
              {label(version, versions.indexOf(version))}
            </option>
          ))}
        </select>
        <button id="generation-play" disabled={!canOpen} onClick={() => onSelect(selectedId)}>
          {selected?.status === 'unsuccessful' ? 'View unsuccessful comparison' : 'Play version'}
        </button>
        <button onClick={() => setRefresh((value) => value + 1)} disabled={loading}>
          Refresh versions
        </button>
      </div>
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
          {selected.intent && (
            <p>
              {selected.intent.unitScale * 60} world-unit burst ·{' '}
              {selected.intent.direction === 'opposite' ? 'backward' : 'with the ship’s facing'} ·{' '}
              {selected.intent.activation === 'press' ? 'fresh press' : 'held activation'}
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
                  <button onClick={() => onSelect(selected.parentArtifactId!)}>Play parent</button>
                </>
              )}
          </p>
        </div>
      )}
      {loading && <p role="status">Loading saved generations…</p>}
      {!loading && versions.length === 0 && !error && (
        <p>New verified generations will appear here automatically.</p>
      )}
      {error && <p role="alert">Could not load saved generations: {error}</p>}
    </section>
  );
}
