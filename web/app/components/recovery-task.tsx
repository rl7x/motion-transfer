import type { DevelopmentObservation, RecoveryTask } from '../types';
import { JsonDetails } from './shared';

function observation(value: DevelopmentObservation) {
  return `Position (${value.position.x.toFixed(2)}, ${value.position.y.toFixed(2)}) · ${value.ownsMotion ? 'dash owns movement' : 'ordinary movement'} · ${value.events.join(', ') || 'no event'}${value.timers ? ` · cooldown ${value.timers.cooldown}, remaining ${value.timers.remaining}` : ''}`;
}

export function RecoveryTaskView({
  task,
  disabled,
  reconnect,
  recover,
}: {
  task?: RecoveryTask;
  disabled: boolean;
  reconnect: boolean;
  recover: () => void;
}) {
  const m = task?.measurements;
  const base = task?.integration ? '/recovery-projects/' + task.integration.id : null;
  const active =
    task && !['ready', 'recovery-incomplete', 'integration-failed'].includes(task.status);
  const next = active ? task.milestones.find((item) => !item.complete) : null;
  return (
    <div className="recovery-task" id="recovery-task">
      <p className="eyebrow">DEVELOPER REQUEST / COMPILED REFERENCE TO WORKING PROJECT</p>
      <h3>Bring its dash into my platformer.</h3>
      <p>
        Meta inspects the donor, chooses experiments and develops a standalone component. A new
        candidate must pass separate acceptance and JUJUMP checks before you can play or download
        it.
      </p>
      <button id="recover-project" type="button" disabled={disabled} onClick={recover}>
        {reconnect ? 'Reconnect to recovery ↗' : 'Recover for JUJUMP ↗'}
      </button>
      <p className="saved-note">
        Starts a fresh Meta task, up to $0.50, after the 18+ confirmation. The saved transfers above
        use the earlier recovered component. No successful result is substituted if this task fails.
      </p>
      {task && (
        <>
          <p id="recovery-task-status" role="status">
            {task.origin === 'local-verification'
              ? 'HUMAN-SCRIPTED LOCAL VERIFICATION'
              : 'META RECOVERY TASK'}
            {' · '}
            {task.status === 'ready'
              ? 'CHECKED PROJECT READY'
              : task.status === 'recovery-incomplete'
                ? 'RECOVERY INCOMPLETE'
                : task.status === 'integration-failed'
                  ? 'COMPONENT ACCEPTED · INTEGRATION NOT VERIFIED'
                  : task.status.replaceAll('-', ' ').toUpperCase()}
          </p>
          <ol className="recovery-milestones" aria-label="Actual recovery milestones">
            {task.milestones.map((item) => (
              <li key={item.id} data-complete={item.complete}>
                <span aria-hidden="true">{item.complete ? '✓' : '○'}</span> {item.label}
              </li>
            ))}
          </ol>
          {next && (
            <p className="recovery-next" role="status">
              Working toward: <strong>{next.label}</strong>
            </p>
          )}
          {Boolean(task.development?.length) && (
            <div className="recovery-development" aria-label="Actual candidate development results">
              <h4>What the checks caught</h4>
              <p>
                Each candidate runs against the compiled donor. Failed checks guide the next
                revision.
              </p>
              {task.development?.map((attempt) => (
                <article key={attempt.attempt} data-passed={attempt.passed}>
                  <strong>
                    Candidate {attempt.attempt} ·{' '}
                    {attempt.passed ? 'Development passed' : 'Mismatch found'}
                  </strong>
                  <p>
                    {attempt.checks > 0
                      ? `${attempt.passedChecks} of ${attempt.checks} development checks passed`
                      : 'No behavioral checks completed'}
                  </p>
                  {attempt.error && <p>{attempt.error}</p>}
                  {attempt.firstFailure && (
                    <details open={!attempt.passed && attempt.attempt === m?.developmentAttempts}>
                      <summary>
                        First mismatch: {attempt.firstFailure.name} · update{' '}
                        {attempt.firstFailure.tick}
                      </summary>
                      <dl>
                        <dt>Compiled donor</dt>
                        <dd>{observation(attempt.firstFailure.expected)}</dd>
                        <dt>This candidate</dt>
                        <dd>{observation(attempt.firstFailure.actual)}</dd>
                      </dl>
                    </details>
                  )}
                </article>
              ))}
              <p className="saved-note">
                Development is the repair loop. Separate acceptance and project checks still
                determine whether a download is available.
              </p>
            </div>
          )}
          {m && (
            <p id="recovery-task-measurements">
              {m.modelRequests} model requests · ${m.estimatedCostUsd.toFixed(4)} estimated · $
              {m.reservedCostUsd.toFixed(4)} reserved · {m.developmentAttempts} development attempts
              {m.acceptanceTraces > 0 &&
                ` · ${m.acceptanceTraces} acceptance traces / ${m.acceptanceUpdates.toLocaleString()} updates`}
              {m.taskElapsedMs !== null &&
                ` · ${(m.taskElapsedMs / 1000).toFixed(1)}s task execution`}
            </p>
          )}
          {task.error && <p className="saved-note">Stopped: {task.error}</p>}
          {base && (
            <div className="developer-actions" id="recovery-project-links">
              <a href={base + '/play'} target="_blank" rel="noopener" id="recovery-play">
                Play this checked project ↗
              </a>
              <a href={base + '/project.zip'} download id="recovery-download">
                Download this project ↓
              </a>
              <a href={base + '/validation.json'}>Standalone verification + actual traces ↗</a>
              <p className="saved-note">
                {task.integration?.fileCount} files ·{' '}
                {((task.integration?.archiveBytes ?? 0) / 1024).toFixed(0)} KB · component{' '}
                {task.integration?.componentId.slice(0, 12)}
              </p>
            </div>
          )}
          <details>
            <summary>Task identity, human assistance and measurement limits</summary>
            <p>Session: {task.sessionId ?? 'not started'}</p>
            <p>Candidate: {task.candidateId ?? 'not submitted'}</p>
            <p>{task.assistanceScope}</p>
            <p>
              Finite checks cover the declared motion and this recipient. Developer time savings,
              adoption and a baseline comparison remain unmeasured.
            </p>
            <JsonDetails label="Task report" value={task} />
          </details>
        </>
      )}
    </div>
  );
}
