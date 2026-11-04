export const isBlindRecovery = protocol => protocol?.name === 'motion-recovery-v6';

export const BLIND_HUMAN_ASSISTANCE = Object.freeze([
  'Humans chose the mechanic and registered the compiled donor.',
  'Humans wrote the standalone motion ABI, experiment tools and evaluators.',
  'Humans mapped fields for a private grader the model never sees; the model is never told where state lives.',
  'Development failure feedback still includes expected positions and timers, but no memory locations.',
]);

// Strip both direct fields and derived private-map observations. Raw bytecode,
// model-requested memory watches and writer addresses remain available.
const hidden = new Set(['motion', 'motionNotice', 'fieldHints', 'normalized', 'normalizedTrace',
  'eventConvention', 'normalization', 'firstTimerDifference', 'firstBehaviorDivergence']);

/** The shared recovery request stays unchanged for older protocols. V6 offers no mapped fields. */
export function recoveryQuestion(question, protocol) {
  if (!isBlindRecovery(protocol)) return question;
  const clause = 'mapped fields, ABI, evaluators and recipient adapter are human assistance.';
  if (!question.includes(clause)) throw Error('The recovery request no longer has its assistance clause');
  return question.replace(clause, 'the ABI, evaluators and recipient adapter are human assistance.');
}

// Refusals and crashes name their real cause, because the advice to shrink state would not fix them.
export function inconclusiveFeedback(result) {
  const prefix = `Exhaustive verification is inconclusive (${result.reason}).`;
  if (['position-affects-behavior', 'search-cap', 'time-limit', 'counterexample-not-confirmed'].includes(result.reason)) {
    return `${prefix} Keep state to timers and direction so outputs and other state cannot depend on position.`;
  }
  return `${prefix} ${result.error ?? 'The candidate could not be checked.'} Fix this and resubmit.`;
}

export function blindOutput(value, protocol) {
  if (!isBlindRecovery(protocol)) return value;
  const clean = item => {
    if (Array.isArray(item)) return item.filter(entry => entry?.origin !== 'human-mapped-assistance').map(clean);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => !hidden.has(key)).map(([key, child]) => [key, clean(child)]));
  };
  return clean(value);
}

export function blindToolDefinition(tool, protocol) {
  if (!isBlindRecovery(protocol)) return tool;
  const descriptions = {
    session_observe: 'Observe the persistent branch without advancing. Returns rendering, text, hashes and bounded typed memory watches you request.',
    read_memory: 'Read bounded typed memory watches you request from the persistent branch without advancing. Watch names and addresses are your hypotheses.',
    run_original: 'Run chosen inputs from a fresh compiled cartridge. Returns checkpoint hashes, text, grouped sprites and requested raw memory watches. Watch names are your hypotheses. X=1 starts/dashes; Z=2; left=16, right=32, up=64, down=128; 0 releases. Fixed 60 Hz. At most 12 checkpoints, 1800 frames and 64 watched values. Use [] for unused watches. The camera may follow the player; inspect scenery motion too.',
    prepare_checkpoint: 'Advance chosen inputs on main and save a replay-verified checkpoint. Returns rendering and raw watches. With watches:[] the targets list is empty. Targets are created only for raw watches YOU request and bind to that exact checkpoint. Repeating requestId reconnects without advancing again.',
    read_checkpoint: 'Read an existing checkpoint without advancing main. Returns rendering and raw watches. Only requested raw watches create typed target handles. Handles bind address, type, previous bytes and checkpoint identity; watch names are hypotheses.',
    run_experiment: 'Restore two instances from one checkpoint, apply your chosen raw-watch target interventions, and execute identical inputs. Returns rendering and memory differences with a durable artifact reference. No intervention is a reproducibility control. Use only current checkpoint-bound target IDs. Request IDs are idempotent.',
    compare_branches: 'Advance two branches forked from one checkpoint with identical inputs. The control must have no additional writes. Prior inputs and elapsed frames must match. Compare raw memory, rendering and requested watches; mutations alone do not establish field meanings. At most 600 frames.',
  };
  let description = descriptions[tool.name] ?? tool.description;
  if (tool.name === 'run_experiment_program') description += ' In this protocol targets exist only for raw watches you request; watches:[] returns targets:[]. Only rendering and memory observations are available during investigation.';
  if (tool.name === 'submit_component_candidate') description += ' Passing 32 development cases triggers an exhaustive search. A confirmed counterexample is development feedback and consumes this attempt. Inconclusive searches require revision; keep state to timers and direction. Module scope supports functions, literal constants and Math aliases. Only a proved candidate advances to host freeze and separate acceptance.';
  const result = { ...tool, description };
  if (tool.name === 'run_experiment') {
    result.parameters = structuredClone(tool.parameters);
    result.parameters.properties.observations.properties.channels.items.enum = ['memory', 'rendering'];
  }
  return result;
}
