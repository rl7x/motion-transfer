export const FOOTAGE_TOOL = {
  type: 'function', name: 'submit_motion_controller', strict: true,
  description: 'Submit a standalone TypeScript controller for the measured move. The host checks it against bursts you were not shown.',
  parameters: {
    type: 'object', additionalProperties: false, required: ['source', 'summary', 'config'],
    properties: {
      source: { type: 'string', maxLength: 16384 },
      summary: { type: 'string', maxLength: 1000 },
      config: {
        type: 'object', additionalProperties: false, required: ['walkingSpeed', 'dashDistance', 'cooldownTicks', 'initialCooldownTicks'],
        properties: { walkingSpeed: { type: 'number' }, dashDistance: { type: 'number' }, cooldownTicks: { type: 'number' }, initialCooldownTicks: { type: 'number' } },
      },
    },
  },
};

const INSTRUCTIONS = `Rebuild one movement ability from measurements of gameplay footage. You have numbers from a tracker and nothing else: no source, no binary, no record of the buttons pressed.

Write a standalone TypeScript controller. No imports, randomness, clocks, DOM or network.
export function init(config)
export function step(state, input, config)
init returns a JSON object state. step runs once per 60 Hz tick and returns {state, output}.
input is exactly {buttons: number, sourceBodyWidth: number}. Ignore sourceBodyWidth unless you need it.
output is exactly {ownsMotion: boolean, displacement: {x: number, y: number}, events: string[]}.
displacement is the change this tick, in source pixels. +x is right and +y is down.
ownsMotion is true on ticks where the ability controls movement, and false on ordinary movement ticks.
events may contain only dash-start and dash-end, at most one of each, on the first and last ticks of the ability.
Button bits: ability = 1, left = 16, right = 32, up = 64, down = 128.

Choose config yourself from the measurements: walkingSpeed, dashDistance, cooldownTicks and initialCooldownTicks. Pass config through and read it in step.

How to read the numbers:
- The tracker measures on-screen positions, and games often round those to whole pixels. Values that alternate, such as 8, 7, 8, 7, mean one constant fractional speed. Use total distance divided by frames.
- The ability's first moving tick is the tick its button is pressed.
- A gap between two burst starts covers the burst and its recharge, so the shortest gap is the closest thing you have to the true timing. That gap may be longer than the true minimum if the player never pressed as soon as possible.
- A burst that starts from standing still with thenStopped true most likely had no direction held, because someone holding a direction keeps walking afterwards. It shows where the ability goes by default. Its lastMovedDirection is where the player was last moving, so compare the two to see whether the burst follows that direction or a fixed default.
- framesOfPlayBeforeFirstBurst, when present, comes from a clip that shows the very start of play, so treat it like the shortest gap: if the ability is held from the first step, the first burst begins on that step, counting from 0.
- Bursts are straight lines, so assume the direction is fixed when the ability starts.
- diagonalMovingSpeed is the distance moved per frame along a diagonal. If it matches usualMovingSpeed, diagonal movement is normalized, so each axis moves usualMovingSpeed divided by the square root of 2.

Submit exactly one submit_motion_controller call.`;

export function footageRequest({ model, measurements, feedback = null }) {
  return {
    model, instructions: INSTRUCTIONS,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ measurements, ...(feedback ? { verifierFeedback: feedback } : {}) }) }] }],
    tools: [FOOTAGE_TOOL], store: false, reasoning: { effort: 'medium' }, max_output_tokens: 8000, parallel_tool_calls: false,
  };
}

export function readController(response) {
  const calls = (response?.output ?? []).filter(item => item.type === 'function_call');
  if (calls.length !== 1 || calls[0].name !== FOOTAGE_TOOL.name) throw Error('The model did not submit one controller');
  const value = JSON.parse(calls[0].arguments);
  if (typeof value.source !== 'string' || !value.config) throw Error('The submitted controller is incomplete');
  return value;
}
