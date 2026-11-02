import type { InvestigationReport, ExperimentPayload, NormalizedMotion, Capture } from '../types';
import { DownloadButton, EvidenceLinks, JsonDetails, MeasurementTable } from './shared';

const pair = (value: NormalizedMotion | null | undefined) =>
  value ? `${value.dx.toFixed(2)} / ${value.dy.toFixed(2)}` : 'unavailable';
function ManagedComparison({
  experiment: e,
  artifactId,
}: {
  experiment: ExperimentPayload;
  artifactId: string;
}) {
  const trace = e.trace ?? [];
  const table = (samples: typeof trace) => (
    <MeasurementTable
      labels={[
        'Elapsed update',
        'Control Δx / Δy',
        'Intervention Δx / Δy',
        'Recharge: control / intervention',
        'Burst left: control / intervention',
        'Events: control / intervention',
      ]}
      rows={samples.map((sample) => {
        const a = sample.control.normalized,
          b = sample.intervention.normalized;
        return [
          sample.elapsedFrame,
          pair(a),
          pair(b),
          `${a?.cooldown ?? '—'} / ${b?.cooldown ?? '—'}`,
          `${a?.remaining ?? '—'} / ${b?.remaining ?? '—'}`,
          `${a?.events.join(', ') || '—'} / ${b?.events.join(', ') || '—'}`,
        ];
      })}
    />
  );
  return (
    <article className="comparison-card managed-comparison" id={'evidence-' + e.experimentId}>
      <h4>
        {e.experimentId} · {e.status}
      </h4>
      <p>{e.hypothesis}</p>
      <p>
        {e.identicalStartingConditions
          ? 'Both branches restored and verified from identical starting conditions.'
          : 'Starting conditions were not verified.'}
      </p>
      <small id={'evidence-' + artifactId}>
        Artifact {artifactId} · session {e.sessionId}
      </small>
      <p id={'evidence-' + e.checkpoint?.id}>Replay checkpoint {e.checkpoint?.id}</p>
      <p>
        Initial memory edit: checkpoint update {e.initialEditDifference?.frame}. This is separate
        from subsequent behavior.
      </p>
      <p>
        {e.firstBehavioralDivergence
          ? `First observed behavior or rendering divergence: elapsed update ${e.firstBehavioralDivergence.elapsedFrame}.`
          : 'No behavior or rendering divergence observed in these inputs.'}
      </p>
      <p>
        First timer difference: {e.firstTimerDifference ?? 'none'} · first rendering difference:{' '}
        {e.firstRenderingDifference ?? 'none'}.
      </p>
      {trace.length > 0 && (
        <>
          {table(trace.filter((_, index) => index < 3 || index === trace.length - 1))}
          <details>
            <summary>All {trace.length} update measurements</summary>
            {table(trace)}
          </details>
        </>
      )}
      <JsonDetails
        label="Exact inputs, edits, memory and rendering hashes"
        value={{
          checkpoint: e.checkpoint,
          inputs: e.inputs,
          initialEditDifference: e.initialEditDifference,
          final: e.final,
          trace,
        }}
      />
      <DownloadButton
        label="Download experiment evidence"
        text={JSON.stringify(e)}
        name={artifactId + '.json'}
      />
      <p>{e.normalization}</p>
      {e.error && <p>{e.error}</p>}
    </article>
  );
}
export function InvestigationView({ report }: { report?: InvestigationReport }) {
  const session = report?.session;
  if (!session) return <section id="investigation-workspace" hidden />;
  const workbench = session.experimentWorkbench,
    artifacts = workbench?.artifacts ?? [],
    managed = artifacts.filter((item) => item.payload.kind === 'experiment');
  const calls = report.toolCalls ?? [],
    latest = calls.at(-1),
    hypothesis = [...calls]
      .reverse()
      .find((call) => call.args?.hypothesis || call.args?.claim || call.args?.scope);
  const captures = [
    ...new Map<string, Capture>(
      [
        ...(session.captures ?? []),
        ...artifacts.flatMap((item) => item.payload.captures ?? []),
      ].map((item) => [item.evidenceId, item]),
    ).values(),
  ];
  const edits = session.branches.flatMap((branch) =>
    branch.actions
      .filter((action) => action.kind === 'write')
      .map((action) => [
        branch.id,
        action.frame,
        '0x' + action.address?.toString(16),
        action.type,
        action.previousValue,
        action.newValue,
        action.hypothesis,
      ]),
  );
  return (
    <section id="investigation-workspace" className="investigation-workspace">
      <p className="eyebrow" id="investigation-session-id">
        SESSION / {session.id}
      </p>
      <h3>Current hypothesis</h3>
      <p id="investigation-hypothesis">
        {String(
          hypothesis?.args?.hypothesis ??
            hypothesis?.args?.claim ??
            hypothesis?.args?.scope ??
            'Meta is choosing its next inspection or experiment.',
        )}
      </p>
      <p id="investigation-action" role="status">
        {latest
          ? `${latest.name} · ${latest.ok ? 'returned evidence' : latest.error ? 'failed' : 'running'}`
          : 'Starting an isolated investigation worker.'}
      </p>
      <div id="investigation-programs">
        {workbench?.programs.map((program) => (
          <article key={program.id} id={'evidence-' + program.id} className="program-card">
            <h3>Experiment program · {program.status}</h3>
            <p>{program.hypothesis}</p>
            <small>
              {report.model === 'none'
                ? 'Human-scripted local verification · no model request'
                : 'Model-authored program · executed locally in an isolated interpreter'}
            </small>
            <JsonDetails
              label={`${program.language} source · ${program.sourceSha256.slice(0, 12)}`}
              value={program.source}
              open
            />
            <MeasurementTable
              labels={['Operation', 'Capability', 'Status', 'Evidence']}
              rows={program.operations.map((operation) => [
                operation.index,
                operation.name,
                operation.status,
                operation.result?.experimentId ??
                  operation.result?.artifactRef?.id ??
                  operation.result?.checkpointId ??
                  operation.error ??
                  '—',
              ])}
            />
            {program.error && <p>{program.error}</p>}
            <p>
              Completed host operations survive interruption. The interpreter execution stack is not
              restored.
            </p>
            <JsonDetails
              label="Host operations, arguments and returned evidence"
              value={program.operations}
            />
            <DownloadButton
              label="Download experiment program"
              text={program.source}
              name={program.id + (program.language === 'typescript' ? '.ts' : '.js')}
              type="text/plain"
            />
            {artifacts
              .filter((item) => item.id === program.artifactId)
              .map((item) => (
                <span key={item.id}>
                  <small id={'evidence-' + item.id}>{item.id}</small>
                  <DownloadButton
                    label="Export program evidence"
                    text={JSON.stringify(item.payload)}
                    name={item.id + '.json'}
                  />
                </span>
              ))}
          </article>
        ))}
      </div>
      <div id="investigation-branches" className="investigation-branches">
        {session.branches.map((branch) => (
          <article key={branch.id} className="branch-card" id={'branch-' + branch.id}>
            <strong>{branch.id}</strong>
            <p>
              Update {branch.verification.frame} ·{' '}
              {branch.experimental
                ? branch.actions.some((action) => action.kind === 'write')
                  ? 'perturbed branch'
                  : 'unchanged checkpoint branch'
                : 'original branch'}
            </p>
            <small>Memory {branch.verification.memoryHash.slice(0, 12)}</small>
            {branch.parentCheckpointId && <EvidenceLinks ids={[branch.parentCheckpointId]} />}
          </article>
        ))}
        {managed.flatMap(({ payload: e }) =>
          Object.entries(e.branches ?? {}).map(([role, id]) => (
            <article key={id} className="branch-card managed-branch" id={'branch-' + id}>
              <strong>{role === 'control' ? 'Unedited control' : 'Intervention'}</strong>
              <p>{id}</p>
              <small>Host-managed replay · checkpoint update {e.starting?.frame}</small>
              <EvidenceLinks ids={[e.experimentId!]} />
            </article>
          )),
        )}
      </div>
      <p className="saved-note">
        Motion fields and address hints use a human-mapped registry; the field layout is supplied as
        assistance. Checkpoints replay into clean instances, including globals and host storage.
      </p>
      <details open>
        <summary>Memory interventions and actual consequences</summary>
        <div id="investigation-edits">
          {edits.length > 0 && (
            <MeasurementTable
              labels={['Branch', 'Update', 'Address', 'Type', 'Before', 'After', 'Hypothesis']}
              rows={edits}
            />
          )}
          {managed.map(({ id, payload: e }) =>
            e.edits?.length ? (
              <MeasurementTable
                key={id}
                labels={[
                  'Branch',
                  'Update',
                  'Bound address',
                  'Type',
                  'Before',
                  'After',
                  'Hypothesis',
                ]}
                rows={e.edits.map((edit) => [
                  e.branches?.intervention,
                  edit.frame,
                  '0x' + edit.address.toString(16),
                  edit.type,
                  edit.previousValue,
                  edit.newValue,
                  edit.hypothesis,
                ])}
              />
            ) : null,
          )}
        </div>
        <div id="investigation-comparisons">
          {session.comparisons.map((comparison) => (
            <article
              className="comparison-card"
              key={comparison.comparisonId}
              id={'evidence-' + comparison.comparisonId}
            >
              <h4>
                {comparison.comparisonId} · {comparison.controlBranchId} →{' '}
                {comparison.experimentalBranchId}
              </h4>
              <p>{comparison.hypothesis}</p>
              <MeasurementTable
                labels={[
                  'Elapsed update',
                  'Control Δx / Δy',
                  'Variant Δx / Δy',
                  'Recharge: control / variant',
                  'Burst left: control / variant',
                  'Events: control / variant',
                ]}
                rows={comparison.normalizedTrace
                  .filter((sample) => sample.control && sample.experimental)
                  .map((sample) => [
                    sample.elapsedFrame,
                    pair(sample.control),
                    pair(sample.experimental),
                    `${sample.control?.cooldown} / ${sample.experimental?.cooldown}`,
                    `${sample.control?.remaining} / ${sample.experimental?.remaining}`,
                    `${sample.control?.events.join(', ') || '—'} / ${sample.experimental?.events.join(', ') || '—'}`,
                  ])}
              />
              <p>
                {comparison.firstBehaviorDivergence
                  ? `First measured motion/timer/event difference: update ${comparison.firstBehaviorDivergence.elapsedFrame}.`
                  : 'No measured motion/timer/event difference was recorded in the sampled comparison.'}
              </p>
              <small>{comparison.scope}</small>
            </article>
          ))}
          {managed.map((item) => (
            <ManagedComparison key={item.id} artifactId={item.id} experiment={item.payload} />
          ))}
        </div>
      </details>
      <h3>Interpretations from finite evidence</h3>
      <div id="investigation-findings" className="investigation-findings">
        {['supported', 'rejected', 'unresolved'].map((status) => {
          const values = [...(session.findings ?? []), ...(session.annotations ?? [])].filter(
            (item) => item.status === status,
          );
          return (
            <section className="finding-group" key={status}>
              <h4>{status.toUpperCase()}</h4>
              {!values.length && <p>No interpretation recorded.</p>}
              {values.map((value) => (
                <article key={value.id} id={'evidence-' + value.id}>
                  <p>{value.claim ?? value.hypothesis}</p>
                  <small>
                    {value.confidence} confidence ·{' '}
                    {report.model === 'none'
                      ? 'human-scripted interpretation'
                      : 'model interpretation'}
                  </small>
                  <EvidenceLinks ids={value.evidenceIds} />
                  {value.inferredName && (
                    <p>
                      Function {value.functionIndex}: “{value.inferredName}” · inferred name
                    </p>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <div id="investigation-captures">
        {captures.map((capture) => (
          <figure key={capture.evidenceId} id={'evidence-' + capture.evidenceId}>
            <img
              src={capture.dataUrl}
              width={160}
              height={160}
              alt={`Actual framebuffer, branch ${capture.branchId}, update ${capture.frame}`}
            />
            <figcaption>
              {capture.evidenceId} · {capture.branchId} · update {capture.frame}
            </figcaption>
            <small>{capture.reason ?? capture.stage}</small>
          </figure>
        ))}
      </div>
      <details>
        <summary>Component development and exports</summary>
        <div id="investigation-candidates">
          {session.recovery?.attempts.map((attempt) => {
            const accepted = session.recovery?.acceptedAttempt === attempt.attempt,
              first = attempt.development.results?.find((item) => item.firstDivergence);
            return (
              <article key={attempt.candidateId} className="candidate-card">
                <h4>
                  Candidate {attempt.attempt} ·{' '}
                  {accepted
                    ? 'accepted for finite donor cases'
                    : attempt.acceptance
                      ? 'acceptance failed'
                      : attempt.frozenAt
                        ? 'frozen'
                        : attempt.development.passed
                          ? 'development passed'
                          : 'development failed'}
                </h4>
                <p>Source {attempt.sourceSha256.slice(0, 12)}</p>
                {first && (
                  <p>
                    First divergence: {first.name}, update {first.firstDivergence?.tick}.
                  </p>
                )}
                {attempt.development.error && <p>{attempt.development.error}</p>}
                <JsonDetails
                  label="Development feedback and finite verification scope"
                  value={{
                    development: attempt.development,
                    acceptance: attempt.acceptance,
                    timerFields: attempt.timerFields,
                  }}
                />
                <DownloadButton
                  label="Download candidate TypeScript"
                  text={attempt.candidate.source}
                  name={'candidate-' + attempt.candidateId.slice(0, 12) + '.ts'}
                  type="text/plain"
                />
                <DownloadButton
                  label="Export candidate and checks"
                  text={JSON.stringify(attempt, null, 2)}
                  name={'candidate-' + attempt.candidateId.slice(0, 12) + '.json'}
                />
                {accepted && (
                  <p>
                    This candidate has not replaced the saved ability. Recipient-specific
                    integration checks are still required.
                  </p>
                )}
              </article>
            );
          })}
          {!session.recovery?.attempts.length && (
            <p>No new component candidate submitted. Saved demo components remain separate.</p>
          )}
        </div>
      </details>
    </section>
  );
}
