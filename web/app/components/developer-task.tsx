import { useResource } from '../hooks/use-resource';
import { useTransfer } from '../transfer-context';
interface DeveloperCase {
  componentId: string;
  package: {
    fileCount: number;
    bytes: number;
    id: string;
    sha256: string;
    download: string;
    play: string;
  };
  verification: { nodeChecks: number; browserChecks: number; report: string } | null;
  measurements: {
    traceCount: number;
    updates: number;
    maxPositionError: number;
    adapterSourceLines: number;
    recordedRecoveryCostUsd: number;
    airborne: {
      ordinaryDistance: number;
      dashDistance: number;
      ticks: number;
      maxVerticalDifference: number;
    };
  };
  recovery: { requests: { responseStatus?: string }[]; attempts: { acceptancePassed: boolean }[] };
}
export function DeveloperTask() {
  const { data, error } = useResource<DeveloperCase>('/api/developer-task');
  const { selectDestination } = useTransfer();
  const m = data?.measurements;
  return (
    <section
      className="developer-task"
      id="developer-task"
      aria-labelledby="developer-task-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">DEVELOPER TASK / RECOVER A MECHANIC, KEEP BUILDING</p>
          <h2 id="developer-task-heading">Take the ability into your own project.</h2>
        </div>
        <span className="pill neutral">SAVED RECOVERY</span>
      </div>
      <p className="developer-intro">
        Porting a game mechanic means preserving its timing and quirks. Start with a compiled
        reference. Finish with editable source and a working integration.
      </p>
      <div className="developer-steps">
        <article>
          <span className="eyebrow">01 / COMPILED REFERENCE</span>
          <h3>Keep the original behavior.</h3>
          <p>
            Dashy Dango&apos;s compiled WASM-4 build was the recovery input. Its source was withheld
            from recovery; it wasn&apos;t lost.
          </p>
          <a href="#recovery-details">Inspect the saved recovery ↓</a>
        </article>
        <article>
          <span className="eyebrow">02 / A CHECKED COMPONENT</span>
          <h3>Recover the timing and rules.</h3>
          <p>
            Meta generated and repaired the controller. Human assistance supplied the boundary,
            mapped fields and evaluator.
          </p>
          <p id="developer-recovery" className="saved-note">
            {m
              ? `${m.traceCount} saved traces · ${m.updates.toLocaleString()} updates · ${m.maxPositionError} maximum measured position error. Finite default-configuration checks.`
              : (error ?? 'Reading saved recovery measurements…')}
          </p>
        </article>
        <article>
          <span className="eyebrow">03 / WORKING INTEGRATION</span>
          <h3>Keep JUJUMP&apos;s own physics.</h3>
          <p>
            The human-authored adapter adds a horizontal dash. Jumping, gravity, landing and
            scrolling stay with JUJUMP.
          </p>
          <a
            href="/?destination=jujump#developer-task"
            id="developer-select"
            onClick={(event) => {
              event.preventDefault();
              void selectDestination('jujump').then(() =>
                document
                  .querySelector('.games')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
              );
            }}
          >
            Play the platformer transfer ↑
          </a>
        </article>
      </div>
      <div className="developer-handoff">
        <div>
          <h3>A project you can run without this app.</h3>
          <p>
            Before/after players, editable component and adapter, bundled runtime, checks and
            recovery history. No installation or API key needed; use Node.js 22+.
          </p>
          <code>npm test &amp;&amp; npm start</code>
          <p
            id="developer-package"
            className="saved-note"
            title={
              data ? `Package ${data.package.id}\nZIP SHA-256 ${data.package.sha256}` : undefined
            }
          >
            {data
              ? `${data.package.fileCount} files · ${(data.package.bytes / 1024).toFixed(0)} KB ZIP · component ${data.componentId.slice(0, 12)}`
              : (error ?? 'Checking export identity…')}
          </p>
        </div>
        <div className="developer-actions">
          <a
            className="download-project"
            id="developer-download"
            hidden={!data}
            href={data?.package.download}
            download="jujump-dash.zip"
          >
            Download working integration ↓
          </a>
          <a
            id="developer-preview"
            hidden={!data}
            href={data?.package.play}
            target="_blank"
            rel="noopener"
          >
            Open the standalone example ↗
          </a>
          <a href="/integrations/jujump/README.md">Read the integration guide ↗</a>
        </div>
      </div>
      <div id="developer-measurements" className="developer-measurements" aria-live="polite">
        {m &&
          [
            [
              `${m.airborne.ordinaryDistance} → ${m.airborne.dashDistance} px`,
              `Horizontal travel over ${m.airborne.ticks} updates`,
            ],
            [
              `${m.airborne.maxVerticalDifference.toExponential(1)} px`,
              'Vertical difference in matched open-air traces',
            ],
            [
              `$${m.recordedRecoveryCostUsd.toFixed(3)}`,
              'Recorded recovery cost · export uses no API',
            ],
          ].map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
      </div>
      <p id="developer-standalone-checks" className="saved-note">
        {data?.verification ? (
          <>
            Saved local verification of this exact ZIP: {data.verification.nodeChecks} Node checks
            and {data.verification.browserChecks} browser scenarios passed after extraction into a
            fresh folder. <a href={data.verification.report}>Inspect the standalone run ↗</a>
          </>
        ) : (
          'No standalone verification recording matches this exact export yet. Its included checks can be run locally.'
        )}
      </p>
      <details>
        <summary>Measured outcome, recovery history and remaining work</summary>
        <p id="developer-history">
          {data &&
            `${data.recovery.requests.length} saved model requests: ${data.recovery.requests.filter((request) => request.responseStatus === 'incomplete').length} incomplete response, ${data.recovery.attempts.filter((attempt) => attempt.acceptancePassed === false).length} candidate failing acceptance, then a focused Meta repair. That failed suite became development evidence; the repaired candidate passed a fresh acceptance seed after freezing. The original failure remains in the exported history.`}
        </p>
        <p>
          The standalone example can execute a matched before/after comparison and download its
          actual traces. This is a local scripted check, with an explicit open-air fixture. Platform
          contact and ordinary gameplay have separate saved checks.
        </p>
        <p id="developer-effort">
          {m &&
            `The adapter is ${m.adapterSourceLines} source lines; that excludes host hooks, runtime work, field mapping and evaluator construction. Human effort and developer time savings were not measured. No independent user validation or productivity improvement is claimed. Current compiled-target scope is WASM-4.`}
        </p>
        <p>
          Later live workbench investigations are separate from this accepted component. The
          recorded programmatic investigation remains incomplete; this download does not claim a new
          independent recovery. Modified files need new verification.
        </p>
        <p>
          <a href="/api/developer-task">Case measurements and evidence references ↗</a> ·{' '}
          <a href="/integrations/jujump/evidence/recovery-history.json">
            Full recovery and failure history ↗
          </a>
        </p>
      </details>
    </section>
  );
}
