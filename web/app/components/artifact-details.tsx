import { useTransfer } from '../transfer-context';
import { linkHref } from '../links';
export function ArtifactDetails() {
  const { destination: d, artifact: a } = useTransfer();
  const car = d?.id === 'roadster',
    child = Boolean(a?.parentArtifactId),
    id = a?.id ?? d?.artifactId;
  const source = car
    ? `/roadster/artifacts/${id}/adapter.ts`
    : child
      ? `/artifacts/${id}/adapter.ts`
      : d?.source;
  return (
    <details className="artifact-details">
      <summary>Current transfer source, identity, and checks</summary>
      <div className="evidence">
        <div>
          <p className="eyebrow">CHECKED BEHAVIOR</p>
          <p id="check-count">
            {a
              ? `${a.conformanceChecks} mapping cases + ${a.browserChecks} browser checks`
              : '11 mapping cases + 7 browser checks'}
          </p>
        </div>
        <div>
          <p className="eyebrow">ADAPTER AUTHOR</p>
          <p id="model">
            {d?.id === 'jujump'
              ? 'Human-authored integration'
              : (a?.model ?? 'Meta-generated adapter')}
          </p>
          <small>
            <span id="generation-cost">
              {d?.id === 'jujump'
                ? '$0 (no new model call)'
                : '$' + (a?.estimatedGenerationCostUsd ?? a?.estimatedCostUsd ?? 0).toFixed(3)}
            </span>{' '}
            adapter generation cost
          </small>
        </div>
        <div>
          <p className="eyebrow">SAVED VERSION</p>
          <p>
            <a
              id="artifact-id"
              title={id}
              href={linkHref(
                car ? '/api/roadster/artifacts/' + id : a ? '/api/artifacts/' + id : d?.report,
              )}
            >
              {id?.slice(0, 12) ?? '—'}
            </a>
          </p>
          <small>
            <a id="adapter-source" href={linkHref(source)}>
              Adapter source
            </a>{' '}
            · <a href={linkHref('/artifact/component.ts')}>Frozen component source</a>
          </small>
        </div>
      </div>
    </details>
  );
}
