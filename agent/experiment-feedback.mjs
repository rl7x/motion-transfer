import { digest } from '../component/build.mjs';

const SDK_HELP = 'source is an already-invoked async function body. Await SDK calls directly, or call a helper you define. Static methods are sdk.static.inspectWasm, sdk.static.listFunctions, sdk.static.inspectFunction and sdk.static.decompileFunction; sdk.inspectWasm does not exist. Core inspection and recovery tools can also be called directly. No program allowance is refunded.';

function branchActivity(trace, branch) {
  const samples = trace.map(point => ({ elapsedFrame: point.elapsedFrame, ...point[branch].normalized }));
  const active = samples.filter(point => point.ownsMotion);
  const events = samples.filter(point => point.events?.length).map(({ elapsedFrame, events }) => ({ elapsedFrame, events }));
  const timers = point => point ? { elapsedFrame: point.elapsedFrame, cooldown: point.cooldown, remaining: point.remaining } : null;
  return { observedUpdates: samples.length, activeUpdates: active.length,
    eventFrames: events.slice(0, 8), omittedEventFrames: Math.max(0, events.length - 8),
    firstActive: active[0] ? { ...timers(active[0]), dx: active[0].dx, dy: active[0].dy } : null,
    firstTimers: timers(samples[0]), lastTimers: timers(samples.at(-1)) };
}

/** Derive bounded feedback from immutable executed evidence, never expectations. */
export function experimentFeedback(name, result, session) {
  if (!['run_experiment', 'run_experiment_program'].includes(name)) return result;
  const trials = name === 'run_experiment' ? [result] : result.experiments ?? [];
  const activity = trials.flatMap(trial => {
    const artifact = session?.experimentWorkbench?.artifacts.find(item => item.id === trial.artifactRef?.id);
    if (!artifact) return [];
    if (digest(JSON.stringify(artifact.payload)) !== artifact.id) throw Error('Experiment summary evidence integrity mismatch');
    const payload = artifact.payload;
    if (payload.kind !== 'experiment' || !Array.isArray(payload.trace)) return [];
    return [{ experimentId: payload.experimentId, artifactId: artifact.id,
      comparisonKind: payload.edits?.length ? 'typed-intervention' : 'identical-input-reproducibility-control',
      control: branchActivity(payload.trace, 'control'), intervention: branchActivity(payload.trace, 'intervention'),
      scope: 'Observed normalized activity within these inputs. An inactive endpoint does not imply no earlier activity. Full traces remain in the artifact.' }];
  });
  const executionFeedback = name === 'run_experiment_program' && result.operations === 0
    ? { didExecuteCapabilities: false, message: 'No SDK host operations ran. ' + SDK_HELP } : undefined;
  const augmented = { ...result, ...(activity.length ? { activity } : {}), ...(executionFeedback ? { executionFeedback } : {}) };
  // Preserve the existing transport bound; full evidence remains in the session.
  return Buffer.byteLength(JSON.stringify(augmented)) <= 32768 ? augmented : result;
}

export function experimentErrorHelp(name) {
  return name === 'run_experiment_program' ? { sdkHelp: SDK_HELP } : {};
}
