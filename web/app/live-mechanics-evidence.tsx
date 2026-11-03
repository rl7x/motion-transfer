import { injectedResource } from './data-source';
import { linkHref } from './links';

interface TaskMeasurement {
  id: string;
  kind: 'positive' | 'negative';
  passed: boolean;
  responses: number;
  firstResponseMs: number | null;
  jobWallMs: number | null;
  wallMs: number;
  estimatedCostUsd: number;
}
interface TaskEvidence {
  positive: { passed: number; total: number };
  negative: { correct: number; total: number };
  estimatedCostUsd: number;
  observedRepairBenefits: string[];
  tasks: TaskMeasurement[];
}
const taskNames: Record<string, string> = {
  transfer: 'Fresh-press transfer',
  backward: 'Backward edit',
  'half-followup': 'Half-distance follow-up',
  'jujump-export': 'JUJUMP clean export',
  'right-goal': 'Right checkpoint goal',
  'left-goal': 'Left checkpoint goal',
  'infeasible-goal': 'Infeasible goal',
  'add-rule': 'Add dash-end shot',
  'remove-rule': 'Remove composition',
  'restart-replay': 'Restart and exact replay',
};
const seconds = (milliseconds: number | null) =>
  milliseconds === null ? '—' : (milliseconds / 1000).toFixed(3);

/** Only a release with an explicitly supplied measured campaign includes this resource. */
export function LiveMechanicsEvidence() {
  const evidence = injectedResource('/api/live-mechanics/results') as TaskEvidence | undefined;
  if (!evidence) return null;
  const jobTimes = evidence.tasks
    .map((task) => task.jobWallMs)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  const responses = evidence.tasks.reduce((sum, task) => sum + task.responses, 0);
  return (
    <section className="scoreboard" aria-label="Measured task results">
      <p className="eyebrow">PROOF · ONE FROZEN CAMPAIGN</p>
      <h2>Measured tasks</h2>
      <dl className="scoreboard__tiles">
        <div>
          <dt>positive tasks passed</dt>
          <dd>
            {evidence.positive.passed}/{evidence.positive.total}
          </dd>
        </div>
        <div>
          <dt>impossible task refused</dt>
          <dd>
            {evidence.negative.correct}/{evidence.negative.total}
          </dd>
        </div>
        <div>
          <dt>Muse Spark responses</dt>
          <dd>{responses}</dd>
        </div>
        <div>
          <dt>total inference</dt>
          <dd>${evidence.estimatedCostUsd.toFixed(3)}</dd>
        </div>
        {jobTimes.length > 0 ? (
          <div>
            <dt>admission → verified</dt>
            <dd>
              {(Math.min(...jobTimes) / 1000).toFixed(1)}–
              {(Math.max(...jobTimes) / 1000).toFixed(1)} s
            </dd>
          </div>
        ) : null}
      </dl>
      <p>
        {evidence.positive.passed}/{evidence.positive.total} positive tasks passed ·{' '}
        {evidence.negative.correct}/{evidence.negative.total} negative cases handled correctly ·
        estimated inference ${evidence.estimatedCostUsd.toFixed(6)}.
      </p>
      <p>
        One frozen, tool-driven run. Failed tasks and repairs remain in the evidence. This measures
        these selected tasks, not general reliability or time saved by people. Playing these saved
        results makes no model request.
      </p>
      <details>
        <summary>Individual outcomes, time and cost</summary>
        <p>
          First response runs from admission through the first model response, before verification.
          Job time includes verification and any repair; task time also includes its assertions.
          Estimated costs use returned usage. Uncertain charges remain reserved in the shared phase
          ledger.
        </p>
        <div className="measurement-table">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Outcome</th>
                <th>Responses</th>
                <th>First response (s)</th>
                <th>Job (s)</th>
                <th>Task (s)</th>
                <th>Estimated USD</th>
              </tr>
            </thead>
            <tbody>
              {evidence.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{taskNames[task.id] ?? task.id}</td>
                  <td>
                    {task.passed
                      ? task.kind === 'negative'
                        ? 'Correct negative'
                        : 'Passed'
                      : 'Failed'}
                  </td>
                  <td>{task.responses}</td>
                  <td>{seconds(task.firstResponseMs)}</td>
                  <td>{seconds(task.jobWallMs)}</td>
                  <td>{seconds(task.wallMs)}</td>
                  <td>${task.estimatedCostUsd.toFixed(8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Observed repair benefits in this run: {evidence.observedRepairBenefits.length}. A benefit
          requires an actual failed candidate followed by a passing repair in the same job.
        </p>
      </details>
      <p>
        <a href={linkHref('/evidence/live-mechanics-tasks.json')} download>
          Frozen requests, timings and outcomes
        </a>{' '}
        · <a href={linkHref('/versions.html')}>Every saved version and diagnostic</a>
      </p>
    </section>
  );
}
