import { useState } from 'react';
import { errorMessage, fetchJson } from '../api';
import { modelFailure, readGenerationMode } from '../data-source';
import { linkHref } from '../links';
import { useJob } from '../hooks/use-job';
import type { InvestigationReport, Job, ServiceStatus } from '../types';
import { InvestigationView } from './investigation-view';
import { JsonDetails, MeasurementTable } from './shared';
import { RecoveryTaskView } from './recovery-task';
import { useResource } from '../hooks/use-resource';

interface Request {
  questionId: string;
  idempotencyKey: string;
}
const recordings = [
  [
    'view-programmatic-investigation',
    'programmatic-investigation',
    'View Meta experiment program · incomplete ↗',
    ' Saved Meta-chosen intervention and later evidence read; function-body inspection incomplete. No new model request.',
  ],
  [
    'view-programmatic-control',
    'programmatic-control',
    'View local experiment program · no model ↗',
    '',
  ],
  ['view-local-control', 'local-control', 'View local control experiment · no model ↗', ''],
  [
    'view-investigation',
    'neutral-after-left',
    'View recorded investigation · no model call ↗',
    ' Viewing saved evidence; no new model request.',
  ],
  [
    'view-branch-investigation',
    'branch-experiment',
    'View recorded branch exploration · incomplete ↗',
    ' Saved model-chosen exploration; incomplete comparison. No new model request.',
  ],
];
export function InvestigationPanel({ status }: { status: ServiceStatus | null }) {
  const { data: recoveryRecordings } = useResource<{ id: string; title: string }[]>(
    '/api/investigations/recordings',
  );
  const playbackOnly = readGenerationMode() === 'playback-only';
  const flow = useJob<Request, InvestigationReport>({
    storageKey: 'motion-transfer-investigation',
    submitPath: '/api/investigations',
    pollPath: '/api/investigations/',
  });
  const [question, setQuestion] = useState(flow.pending?.request.questionId ?? 'memory');
  const [saved, setSaved] = useState<{ job: Job; path: string; note: string } | null>(null),
    [loadError, setLoadError] = useState('');
  const job = saved?.job ?? flow.job,
    report = job?.report;
  const local = job?.origin === 'local-verification';
  const path = saved?.path ?? '/api/investigations/' + job?.id;
  const mode = local
    ? 'LOCAL VERIFICATION'
    : saved
      ? 'SAVED RECORDING'
      : job?.status === 'ready'
        ? 'COMPLETED META RUN'
        : job?.status === 'failed'
          ? 'STOPPED META RUN'
          : job
            ? 'FRESH META ACTIVITY'
            : 'NO MODEL REQUEST ON LOAD';
  const incomplete =
    job?.status === 'failed'
      ? report?.turns
          ?.at(-1)
          ?.messages.filter((message) => message.phase === 'final')
          .map((message) => message.text)
          .join('\n')
      : null;
  const conclusion = report?.conclusion ?? incomplete;
  const elapsed =
    report?.finishedAt && report.startedAt
      ? ` · ${((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000).toFixed(1)}s recorded elapsed`
      : '';
  const cost = `${report?.requests?.length ?? 0} generation requests · $${(report?.estimatedCostUsd ?? 0).toFixed(4)} estimated${elapsed}`;
  const progress = local
    ? 'Local experiment verification · no model request. Inputs, field selection and intervention were human-scripted; measurements come from actual execution.'
    : (job?.error ??
      (job?.status === 'ready'
        ? `Investigation complete · ${cost}. The model’s interpretation requires review.`
        : job
          ? `Meta investigation: ${job.status} · ${cost}.`
          : 'Fresh model activity starts only when you submit. Saved recovery above remains unchanged.'));
  const budget = status?.budget;
  return (
    <section className="lab-section" aria-labelledby="lab-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">LIVE / LET META CHOOSE THE EXPERIMENT</p>
          <h2 id="lab-heading">Find out what the dash really does.</h2>
        </div>
        <span className="pill neutral" id="lab-mode">
          {mode}
        </span>
      </div>
      <p>
        Meta chooses a hypothesis, interventions and inputs. The workbench restores the checkpoint,
        runs an unchanged control beside the intervention, and returns the actual differences. A
        short experiment program can test several values and choose a follow-up from the
        measurements.
      </p>
      <RecoveryTaskView
        task={job?.task}
        disabled={
          flow.running ||
          Boolean(flow.pending && flow.pending.request.questionId !== 'extraction') ||
          (!flow.reconnect &&
            (!status?.enabled ||
              Boolean(status.activeRunId || status.unsettled) ||
              (budget?.remainingUsd ?? 0) < 0.005))
        }
        reconnect={flow.reconnect && flow.pending?.request.questionId === 'extraction'}
        recover={() => {
          const continuing = Boolean(
            flow.reconnect && flow.pending?.request.questionId === 'extraction',
          );
          if (playbackOnly && !continuing) return;
          setSaved(null);
          setQuestion('extraction');
          void flow.submit({ questionId: 'extraction', idempotencyKey: crypto.randomUUID() });
        }}
      />
      {recoveryRecordings?.map((record) => (
        <button
          key={record.id}
          type="button"
          className="recorded-recovery"
          disabled={Boolean(flow.pending || flow.submitting)}
          onClick={() => {
            const path = '/api/investigations/saved/' + record.id;
            setLoadError('');
            void fetchJson<Job>(path)
              .then((job) => setSaved({ job, path, note: ' Saved outcome; no new model request.' }))
              .catch((error: unknown) => setLoadError(errorMessage(error)));
          }}
        >
          {record.title} · saved outcome ↗
        </button>
      ))}
      <p className="recording-controls">
        {recordings.map(([id, name, label, note]) => (
          <button
            key={id}
            id={id}
            type="button"
            disabled={Boolean(flow.pending || flow.submitting)}
            onClick={() => {
              const path = '/api/investigations/saved/' + name;
              setLoadError('');
              void fetchJson<Job>(path)
                .then((job) => setSaved({ job, path, note }))
                .catch((error: unknown) => setLoadError(errorMessage(error)));
            }}
          >
            {label}
          </button>
        ))}
      </p>
      <form
        id="investigation-form"
        className="lab-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (playbackOnly && !flow.reconnect && !flow.pending?.id) return;
          setSaved(null);
          void flow.submit({ questionId: question, idempotencyKey: crypto.randomUUID() });
        }}
      >
        <label htmlFor="investigation-question">What should Meta investigate?</label>
        <div className="prompt-row">
          <select
            id="investigation-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          >
            <option value="memory">Choose and test a memory intervention</option>
            <option value="extraction">Investigate and develop a new component</option>
            <option value="held">Does holding dash differ from tapping it?</option>
            <option value="neutral">What happens with no direction after a left dash?</option>
          </select>
          <button
            id="investigation-submit"
            type="submit"
            disabled={
              flow.running ||
              (!flow.reconnect &&
                (!status?.enabled ||
                  Boolean(status.activeRunId || status.unsettled) ||
                  (budget?.remainingUsd ?? 0) < 0.005))
            }
          >
            {flow.reconnect ? 'Reconnect to investigation ↗' : 'Investigate with Meta ↗'}
          </button>
        </div>
      </form>
      <p className="saved-note" id="lab-budget">
        {budget
          ? `Up to $0.50 per investigation · $${budget.spentUsd.toFixed(4)} spent / $${budget.limitUsd.toFixed(2)} development ceiling · $${budget.reservedUsd.toFixed(4)} reserved. Existing remix budget is separate.`
          : 'Live investigation is unavailable in this server.'}
      </p>
      <details>
        <summary>What changes with experiment programs?</summary>
        <p>
          In two human-scripted local scenarios, the same paired experiment took six low-level tool
          calls, two complete-workflow calls, or one program call. All three reached matching
          measured endpoints. This measures orchestration and evidence size; it does not measure
          model round trips, cost savings or reliability.
        </p>
        <a href={linkHref('/evidence/experiment-benchmark.json')}>
          Download the measured comparison ↗
        </a>
      </details>
      <p id="lab-progress" role="status" aria-live="polite">
        {loadError || (flow.error ? modelFailure(flow.error) : progress)}
        {saved?.note}
      </p>
      <InvestigationView report={report} />
      <ol id="investigation-events" className="investigation-events">
        {report?.toolCalls?.map((call) => {
          const evidenceId =
            call.experimentId ??
            call.result?.checkpointId ??
            call.result?.evidenceId ??
            call.result?.observationId;
          const measurements = (
            call.result?.checkpoints ?? (call.result?.motion ? [call.result] : [])
          ).flatMap((point) =>
            point.motion
              ? [
                  [
                    point.checkpoint ?? point.observationId ?? 'current',
                    point.frame,
                    point.motion.position.x.toFixed(2),
                    point.motion.position.y.toFixed(2),
                    point.motion.remaining,
                    point.motion.cooldown,
                  ],
                ]
              : [],
          );
          return (
            <li key={call.callId} id={evidenceId ? 'event-' + evidenceId : undefined}>
              <strong>
                {call.experimentId ?? call.name} ·{' '}
                {call.ok ? 'returned evidence' : call.error ? 'failed' : 'running'}
              </strong>
              <p>
                {call.args?.hypothesis ??
                  call.args?.claim ??
                  (call.name === 'inspect_function' || call.name === 'decompile_function'
                    ? `Function ${call.args?.functionIndex}, lines ${call.args?.startLine} onward.`
                    : call.name.replaceAll('_', ' ') + ' on the pinned compiled cartridge.')}
              </p>
              {measurements.length > 0 && (
                <MeasurementTable
                  labels={['Checkpoint', 'Update', 'World x', 'World y', 'Burst left', 'Recharge']}
                  rows={measurements}
                />
              )}
              {(call.result || call.error) && (
                <JsonDetails
                  label="Actual inputs and returned observations"
                  value={{ inputs: call.args, observations: call.result, error: call.error }}
                />
              )}
            </li>
          );
        })}
      </ol>
      <div id="investigation-conclusion" className="lab-conclusion" hidden={!conclusion}>
        {conclusion
          ? (local
              ? 'LOCAL VERIFICATION · HUMAN-SCRIPTED EXPERIMENT'
              : report?.conclusion
                ? 'MODEL INTERPRETATION · NOT INDEPENDENTLY VERIFIED'
                : 'INCOMPLETE RUN · COMPLETION CHECKS DID NOT PASS') +
            '\n\n' +
            conclusion
          : ''}
      </div>
      <a
        id="investigation-report"
        hidden={!job}
        href={linkHref(path)}
        download={'investigation-' + job?.id + '.json'}
      >
        Download this investigation and measurements ↗
      </a>
    </section>
  );
}
