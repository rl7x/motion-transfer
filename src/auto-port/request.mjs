import { PATCH_LIMITS } from './patches.mjs';

export const AUTO_PORT = Object.freeze({
  model: 'muse-spark-1.3', effort: 'low', maxOutputTokens: 10_000, maxAttempts: 2, maxAttemptCostUsd: 0.25,
});

export const AUTO_PORT_TOOL = {
  type: 'function', name: 'submit_auto_port', strict: true,
  description: 'Submit literal anchored patches that connect MotionDash to this game, or an explicit unsupported explanation. The host verifies them independently.',
  parameters: {
    type: 'object', additionalProperties: false,
    required: ['status', 'summary', 'unitsPerSourcePixel', 'patches'],
    properties: {
      status: { type: 'string', enum: ['supported', 'unsupported'] },
      summary: { type: 'string', maxLength: 1000 },
      unitsPerSourcePixel: { type: 'number' },
      patches: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['anchor', 'replacement'],
          properties: { anchor: { type: 'string', maxLength: PATCH_LIMITS.anchor }, replacement: { type: 'string', maxLength: PATCH_LIMITS.replacement } },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Connect one recovered dash to a game you have never seen, using small literal patches to its simulation file.

The host page and tests provide a global, deterministic object. Do not define it:
  MotionDash.update(state, { left, right, up, down }) -> { owns, dx, dy, events }
It runs a controller recovered from another game: a dash lasts 8 ticks, moves 60 source pixels in total, then recharges for 25 ticks. dx and dy are source pixels for this tick, with positive y meaning down. The host decides when the dash button is held. Your patch never reads input for it.

Rules:
1. Call MotionDash.update exactly once per simulation tick, in the code that moves the player's avatar, only while the avatar is under player control in normal play. Pass the object that holds the whole game state, so a restart or a clone resets the dash. It stores its data in state.motionDash; never touch that field.
2. Pass the direction the avatar is steering. If the game has no steering input, pass the direction the avatar faces or travels.
3. While owns is true, add dx * S and dy * S to the avatar's position, where S is one constant you choose. Go through the game's own clamps, walls and wraparound. If the avatar moves along a single axis or path, apply the burst to that position, mapping direction so that the burst is not lost. Do not skip collisions, add invulnerability, or change enemies, scoring or timing.
4. When no dash is active the game must behave exactly as before, tick for tick. Draw nothing from the game's random stream, and do not reorder existing logic.
5. Choose S so that 60 * S is between 5% and 30% of the extent the avatar moves through, in this file's own position units. Report S as unitsPerSourcePixel.
6. Each anchor is a literal substring of the file that occurs exactly once, including its exact whitespace. A replacement keeps the anchor's code unless you mean to change it. Patches apply in order. Use at most ${PATCH_LIMITS.patches}.
7. Added code may not use require, import, eval, Function, fetch, process, globalThis, window, document, timers, Math.random, Date.now or performance.
8. If the game has no avatar the player can move, set status to unsupported with no patches.

Example from a different game, where vx and vy are this tick's movement:
  anchor: ship.x = Math.max(-limitX, Math.min(limitX, ship.x + vx));
  replacement:
    const dash = MotionDash.update(sim, { left: vx < 0, right: vx > 0, up: vy > 0, down: vy < 0 });
    ship.x = Math.max(-limitX, Math.min(limitX, ship.x + vx + (dash.owns ? dash.dx * 0.1 : 0)));

An isolated verifier then checks all of the following, and a failure rejects the port:
- every anchor matches exactly once, and the patched game loads
- the game's own bot plays three seeds for 1,200 ticks with a state identical to the original on every tick
- the game's own tests still pass
- one dash moves the avatar 60 * unitsPerSourcePixel further than a run without the dash
- holding the dash cannot start a second one before the recovered recharge ends
- the patched game runs in a real browser and the dash fires from its key

Submit exactly one submit_auto_port call.`;

export function autoPortRequest({ file, source, feedback = null }) {
  return {
    model: AUTO_PORT.model, instructions: INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ file, source, ...(feedback ? { verifierFeedback: feedback } : {}) }) }] }],
    tools: [AUTO_PORT_TOOL], store: false, reasoning: { effort: AUTO_PORT.effort },
    max_output_tokens: AUTO_PORT.maxOutputTokens, parallel_tool_calls: false,
  };
}

/** The model's one tool call, its words and its usage, or a reason there is no submission. */
export function readSubmission(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const calls = output.filter(item => item.type === 'function_call');
  if (calls.length !== 1 || calls[0].name !== AUTO_PORT_TOOL.name) throw Error('Meta did not submit one auto-port call');
  const value = JSON.parse(calls[0].arguments);
  if (!['supported', 'unsupported'].includes(value.status) || !Array.isArray(value.patches)) throw Error('Invalid auto-port submission');
  return value;
}

export function repairFeedback(submission, report) {
  return {
    instruction: 'Repair only what failed. Your previous patches are below, and they were applied to the original file, which is unchanged.',
    previous: { unitsPerSourcePixel: submission.unitsPerSourcePixel, patches: submission.patches },
    failed: report.checks.filter(check => !check.passed).map(({ name, error }) => ({ name, error })),
    measurements: report.measurements ?? {},
  };
}
