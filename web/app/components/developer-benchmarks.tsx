import { useEffect, useState } from 'react';
import { useResource } from '../hooks/use-resource';
import { linkHref } from '../links';
import { JsonDetails } from './shared';

interface Evaluation {
  name: string;
  observedCases: number;
  failedCases: number;
  maxPositionError: number | null;
  firstFailures: unknown[];
  error: string | null;
}
interface Measurement {
  passed: boolean;
  issues: string[];
  origin: string;
  modelRequests: number | null;
  estimatedCostUsd: number;
  reservedCostUsd: number;
  elapsedMachineMs: number | null;
  evaluations: Evaluation[];
  manualInterventionsDuringRun: number;
  interventionScope: string;
}
interface Attempt {
  id: string;
  stage: string;
  status: string;
  jobId?: string;
  artifactId?: string;
  artifactRef?: { sha256: string };
  jobRef?: { sha256: string };
  measurements?: Measurement;
  accounting?: { estimatedCostUsd: number; reservedCostUsd: number };
  error?: string;
}
interface TaskOutcome {
  id: string;
  name: string;
  kind: string;
  attempted: boolean;
  complete: boolean;
  partial: boolean;
  attempts: number;
}
interface CampaignIndex {
  id: string;
  status: string;
  origin: string;
  updatedAt: string;
  summary: {
    estimatedCostUsd: number;
    providerReservedUsd: number;
    completedTasks: number;
    attemptedTasks: number;
    tasks: TaskOutcome[];
  };
}
interface Campaign {
  id: string;
  status: string;
  error?: string;
  attempts: Attempt[];
  interventions: unknown[];
  definition: {
    origin: string;
    sha256: string;
    scope: string;
    observedSetup: { actor: string; observedWallMs: number; scope: string } | null;
    historicalSetup: unknown;
  };
}

function CampaignResult({ index }: { index: CampaignIndex }) {
  const path = '/api/developer-benchmarks/' + index.id;
  const { data: campaign, error } = useResource<Campaign>(
    path + '?version=' + encodeURIComponent(index.updatedAt),
  );
  return (
    <article className="benchmark-campaign">
      <p className="eyebrow">
        {index.origin === 'local-verification'
          ? 'HUMAN-SCRIPTED LOCAL VERIFICATION'
          : 'SAVED META TASK RESULTS'}
      </p>
      <p id="benchmark-summary" role="status">
        {index.summary.completedTasks} / {index.summary.attemptedTasks} attempted tasks completed ·{' '}
        {index.status.toUpperCase()} · ${index.summary.estimatedCostUsd.toFixed(4)} estimated · $
        {index.summary.providerReservedUsd.toFixed(4)} provider reservations
      </p>
      <p className="saved-note">
        Three predefined tasks: one binary recovery and two adapter-editing tasks. A partial edit
        chain does not count as a completed task. These are self-run cases, not independent adoption
        or a productivity baseline.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="measurement-table">
        <table id="benchmark-tasks">
          <thead>
            <tr>
              <th>Developer task</th>
              <th>Observed outcome</th>
              <th>Requests / cost</th>
              <th>Execution / interventions</th>
            </tr>
          </thead>
          <tbody>
            {index.summary.tasks.map((task) => {
              const attempts =
                campaign?.attempts.filter(
                  (item) =>
                    item.stage === task.id ||
                    (task.id === 'paku-lineage' && item.stage.startsWith('paku-')),
                ) ?? [];
              const measurements = attempts.flatMap((item) =>
                item.measurements ? [item.measurements] : [],
              );
              const elapsed = measurements.reduce(
                (sum, item) => sum + (item.elapsedMachineMs ?? 0),
                0,
              );
              return (
                <tr key={task.id}>
                  <td>
                    <strong>{task.name}</strong>
                    <br />
                    <small>{task.kind}</small>
                  </td>
                  <td>
                    {task.complete
                      ? 'Completed'
                      : task.partial
                        ? 'Partial'
                        : task.attempted
                          ? 'Incomplete'
                          : 'Not attempted'}
                    <br />
                    {task.attempts} attempts
                  </td>
                  <td>
                    {measurements.length &&
                    measurements.every((item) => item.modelRequests !== null)
                      ? measurements.reduce((sum, item) => sum + (item.modelRequests ?? 0), 0) +
                        ' requests'
                      : 'Usage pending'}
                    <br />$
                    {attempts
                      .reduce(
                        (sum, item) =>
                          sum +
                          (item.measurements?.estimatedCostUsd ??
                            item.accounting?.estimatedCostUsd ??
                            0),
                        0,
                      )
                      .toFixed(4)}
                  </td>
                  <td>
                    {measurements.length
                      ? (elapsed / 1000).toFixed(1) + 's machine time'
                      : 'Pending'}
                    <br />
                    {measurements.reduce(
                      (sum, item) => sum + item.manualInterventionsDuringRun,
                      0,
                    )}{' '}
                    in-run edits
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {campaign?.attempts.map((attempt) => {
        const measurements = attempt.measurements;
        const base = '/api/developer-benchmarks/' + index.id + '/' + attempt.id;
        return (
          <details key={attempt.id} className="benchmark-attempt">
            <summary>
              {attempt.stage} · {attempt.status} ·{' '}
              {measurements
                ? measurements.evaluations.length
                  ? measurements.evaluations.reduce((sum, item) => sum + item.failedCases, 0) +
                    ' observed failed checks'
                  : 'no behavioral evaluation ran'
                : 'verification pending'}
            </summary>
            <p>
              {measurements?.issues.join(' · ') || attempt.error || 'No task failures recorded.'}
            </p>
            <p>{measurements?.interventionScope}</p>
            {attempt.jobId && <p>Job {attempt.jobId}</p>}
            {attempt.jobRef && (
              <p>
                <a href={linkHref(base + '/report')} download>
                  Full task report and investigation evidence ↓
                </a>
              </p>
            )}
            {attempt.artifactRef && (
              <p className="evidence-links">
                <a href={linkHref(base + '/source')} download>
                  Source and artifact ↓
                </a>{' '}
                <a href={linkHref(base + '/verification')}>Actual verification ↗</a>{' '}
                {attempt.stage !== 'recovery' && measurements?.passed && (
                  <a
                    href={linkHref(
                      '/developer-benchmarks/' + index.id + '/' + attempt.id + '/play.html',
                    )}
                    target="_blank"
                    rel="noopener"
                  >
                    Play recorded output ↗
                  </a>
                )}
                {attempt.stage === 'recovery' && measurements?.passed && (
                  <>
                    <a
                      href={linkHref('/recovery-projects/' + attempt.artifactId + '/play')}
                      target="_blank"
                      rel="noopener"
                    >
                      Play checked project ↗
                    </a>{' '}
                    <a
                      href={linkHref('/recovery-projects/' + attempt.artifactId + '/project.zip')}
                      download
                    >
                      Download project ↓
                    </a>
                  </>
                )}
              </p>
            )}
            <JsonDetails
              label="Measurements and first divergences"
              value={measurements ?? attempt.accounting}
            />
          </details>
        );
      })}
      <details>
        <summary>Setup effort, protocol and measurement limits</summary>
        <p>{campaign?.definition.scope}</p>
        <p>
          Historical setup effort is unmeasured. Zero in-run edits does not mean zero setup effort.
        </p>
        {campaign?.definition.observedSetup && (
          <p>
            Captured setup window:{' '}
            {(campaign.definition.observedSetup.observedWallMs / 60000).toFixed(1)} minutes of{' '}
            {campaign.definition.observedSetup.actor} wall time.{' '}
            {campaign.definition.observedSetup.scope}
          </p>
        )}
        <JsonDetails
          label="Between-trial interventions and historical setup"
          value={{
            interventions: campaign?.interventions,
            historicalSetup: campaign?.definition.historicalSetup,
          }}
        />
        <p>Definition {campaign?.definition.sha256}</p>
      </details>
      {campaign?.error && <p role="alert">Stopped: {campaign.error}</p>}
      <a href={linkHref(path)} download={'developer-benchmark-' + index.id + '.json'}>
        Download this task report ↓
      </a>
    </article>
  );
}

export function DeveloperBenchmarks() {
  const [revision, setRevision] = useState(0);
  const { data: campaigns, error } = useResource<CampaignIndex[]>(
    '/api/developer-benchmarks?revision=' + revision,
  );
  const active = campaigns?.some((item) => ['prepared', 'running'].includes(item.status)) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setRevision((value) => value + 1), 2000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <section
      className="developer-task"
      id="developer-benchmarks"
      aria-labelledby="benchmark-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">MEASURED DEVELOPER TASKS</p>
          <h2 id="benchmark-heading">What did the workflow actually deliver?</h2>
        </div>
      </div>
      <p>
        Completion, behavioral checks, source lineage, interventions and API cost from predefined
        tasks. Viewing results makes no model request.
      </p>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        Refresh measured results ↻
      </button>
      {error && <p role="alert">{error}</p>}
      {campaigns?.length ? (
        campaigns.map((campaign) => <CampaignResult key={campaign.id} index={campaign} />)
      ) : (
        <p className="saved-note">
          No task campaign recorded yet. Existing saved recovery and local verification remain
          separate above.
        </p>
      )}
    </section>
  );
}
