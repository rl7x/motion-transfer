import { createSim, stepSim, FRAME_MS } from '@/sim/sim.js';
import { INPUT } from '@/sim/input.js';
import { MODES } from '@/sim/constants.js';
import { draw as drawFrame, CANVAS_WIDTH, CANVAS_HEIGHT } from '@/render/canvas.js';
import { createFx, fxStep } from '@/render/fx.js';
import { createAudioBus } from '@/audio/bus.js';
import { createWebAudioAdapter } from '@/audio/webaudio.js';
import { bossTuneAt, cueFor, loopForMusic } from '@/audio/music.js';
import { createParallaxiaPort } from '../parallaxia/port.mjs';
import { createParallaxiaChallengeControls } from '../parallaxia/challenge-contract.mjs';
import { captureCheckpoint, NATIVE_INPUT_MASK, DASH_INPUT, MAX_CHECKPOINT_TICKS, validateCheckpoint, validateScenario, replayDigest, checkpointState } from '../parallaxia/replay.mjs';
import * as component from 'roadster-core';
import * as candidate from 'roadster-adapter';
import config from 'roadster-config';

globalThis.parallaxiaChallengeShield = config.collisionPolicy === 'practice-shield';

const testing = new URLSearchParams(location.search).get('test') === '1';
const presentationEnabled =
  config.transferred && new URLSearchParams(location.search).get('presentation') !== 'off';
const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let afterimages = [];
let holdActive = false;
let holdRemaining = 0;
let presentedPose = null;

function observeDashStep(sample) {
  if (!presentationEnabled || reducedMotion) return;
  if (sample.output?.ownsMotion) {
    if (sample.output.events?.includes('dash-start')) {
      holdRemaining = 3;
      holdActive = true;
      presentedPose = { x: sample.pose.x, y: sample.pose.y, pitch: 0, roll: 0 };
    } else if (holdRemaining > 0) {
      holdRemaining--;
      holdActive = holdRemaining > 0;
    }
    afterimages.push({ x: sample.pose.x, y: sample.pose.y, age: 0, bright: true });
    if (afterimages.length > 5) afterimages.shift();
  } else {
    holdRemaining = 0;
    holdActive = false;
  }
  globalThis.parallaxiaAfterimages = afterimages.map((item, idx) => ({
    x: item.x,
    y: item.y,
    bright: idx === afterimages.length - 1,
  }));
}

function resetPresentation() {
  afterimages = [];
  holdActive = false;
  holdRemaining = 0;
  presentedPose = null;
  globalThis.parallaxiaAfterimages = [];
}

function decayAfterimages() {
  if (!afterimages.length) return;
  for (const item of afterimages) item.age++;
  afterimages = afterimages.filter((item) => item.age < 5);
  globalThis.parallaxiaAfterimages = afterimages.map((item, idx) => ({
    x: item.x,
    y: item.y,
    bright: idx === afterimages.length - 1,
  }));
}

const port = createParallaxiaPort({
  component,
  adapter: config.transferred ? candidate : null,
  defaults: config.defaults,
  intent: config.intent,
  onStep: observeDashStep,
  onReset: resetPresentation,
});
globalThis.roadsterPort = port;

const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

let output = null;
const bus = createAudioBus({
  playProgram: (program, options) => output?.playProgram(program, options),
  playMusic: (id) => output?.playMusic(id),
  pumpMusic: () => output?.pumpMusic(),
  stopAll: () => output?.stopAll(),
  suspend: () => output?.suspend(),
  resume: () => output?.resume(),
});
if (testing) bus.setMuted(true);

function unlockAudio() {
  if (testing) return;
  if (output) {
    if (document.visibilityState === 'visible') output.resume();
    return;
  }
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    const context = new AudioContextClass();
    output = createWebAudioAdapter(context);
    if (document.visibilityState !== 'visible') output.suspend();
    if (bus.playing) output.playMusic(bus.playing);
  } catch {
    output = null;
  }
}

const KEY_BITS = {
  ArrowUp: INPUT.UP,
  ArrowDown: INPUT.DOWN,
  ArrowLeft: INPUT.LEFT,
  ArrowRight: INPUT.RIGHT,
  KeyW: INPUT.UP,
  KeyS: INPUT.DOWN,
  KeyA: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
  KeyZ: INPUT.SHOT,
  KeyJ: INPUT.SHOT,
  KeyK: INPUT.SHOT,
  Space: INPUT.SHOT,
  Enter: INPUT.SHOT,
};

let keyboardBits = 0;
let dash = false;
let realtimeActive = !testing;
let assistedMode = false;
let guided = false;
let playbackEpoch = 0;
let recordedInputs = [];
let sim = createSim({ seed: 7, mode: 'normal', startSector: 1 });
let fx = createFx();
const hud = { hiScore: 12400, newRecord: false, label: MODES[sim.mode].name, notice: null };
const pilotControls = createParallaxiaChallengeControls();

let renderBatchDepth = 0;
function renderNow() {
  if (renderBatchDepth > 0) return;
  drawFrame(ctx, sim, fx, hud);
}
function renderBatch(run) {
  renderBatchDepth++;
  try {
    return run();
  } finally {
    renderBatchDepth--;
    if (!renderBatchDepth) renderNow();
  }
}

function shipCarState() {
  return {
    position: { x: sim.ship.x, y: sim.ship.y, z: 0 },
    velocity: { x: sim.vx ?? 0, y: sim.vy ?? 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    mode: 'airborne',
    gas: sim.lives,
    inAir: sim.phase === 'play',
  };
}

function stepWithInput(bits, { sound = !testing } = {}) {
  const prevOwns = port.snapshot(sim)?.output?.ownsMotion;
  if (recordedInputs.length <= MAX_CHECKPOINT_TICKS) recordedInputs.push((bits & NATIVE_INPUT_MASK) | (dash ? DASH_INPUT : 0));
  stepSim(sim, bits);
  fxStep(fx, sim);
  const nowOwns = port.snapshot(sim)?.output?.ownsMotion;
  if (!nowOwns && !prevOwns) decayAfterimages();
  if (sound) {
    bus.beginFrame(sim.frame);
    bus.emitSimEvents(sim.events);
    bus.endFrame();
  }
  renderNow();
}

const release = () => {
  dash = false;
  port.setDash(false);
};

window.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', (event) => {
  unlockAudio();
  if (event.code === 'KeyX') {
    event.preventDefault();
    dash = true;
    port.setDash(true);
    return;
  }
  const bit = KEY_BITS[event.code];
  if (bit !== undefined) {
    keyboardBits |= bit;
    event.preventDefault();
  }
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'KeyX') {
    event.preventDefault();
    release();
    return;
  }
  const bit = KEY_BITS[event.code];
  if (bit !== undefined) {
    keyboardBits &= ~bit;
    event.preventDefault();
  }
});
window.addEventListener('blur', () => {
  keyboardBits = 0;
  release();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) release();
});

function start(assisted = true) {
  playbackEpoch++;
  release();
  assistedMode = Boolean(assisted);
  recordedInputs = [];
  sim = createSim({ seed: 7, mode: 'normal', startSector: 1 });
  fx = createFx();
  hud.label = MODES[sim.mode].name;
  presentedPose = { x: sim.ship.x, y: sim.ship.y, pitch: 0, roll: 0 };
  if (!testing) realtimeActive = true;
  renderNow();
}

window.__game = {
  play() {
    start(false);
  },
  realtime(enabled) {
    realtimeActive = Boolean(enabled);
    if (!realtimeActive) output?.suspend();
  },
  car() {
    return shipCarState();
  },
  state() {
    return {
      frame: sim.frame,
      score: sim.score,
      lives: sim.lives,
      sector: sim.stage.section + 1,
      phase: sim.phase,
    };
  },
  advance(dt, controls) {
    let bits = keyboardBits;
    if ( typeof controls === 'number') {
      bits = controls;
    } else if (controls === 'autopilot' || (assistedMode && !controls)) {
      bits = pilotControls[sim.frame % pilotControls.length] ?? INPUT.SHOT;
    } else if (controls && typeof controls === 'object') {
      bits = INPUT.SHOT;
      if (controls.throttle > 0.5) bits |= INPUT.RIGHT;
      if (controls.brake > 0.5) bits |= INPUT.LEFT;
    }
    stepWithInput(bits);
  },
};

window.parallaxiaCaptureCheckpoint = async () => {
  if (config.collisionPolicy !== 'native') throw Error('Experiments require native collisions, not a practice shield');
  window.__game.realtime(false); release();
  return captureCheckpoint({sim,port,inputs:recordedInputs,identity:config.replayIdentity});
};

window.parallaxiaReplayExperiment = async (receipt, branch = 'original') => {
  if (!['original', 'candidate'].includes(branch)) throw Error('Unknown replay branch');
  const expectedSource = branch === 'original' ? receipt.parentAdapterSha256 : receipt.candidateAdapterSha256;
  if (config.replayIdentity.adapterSha256 !== expectedSource) throw Error('Replay adapter differs from the verified branch');
  const inputs = validateCheckpoint(receipt.checkpoint, {...config.replayIdentity, adapterSha256:receipt.checkpoint.adapterSha256});
  const future = validateScenario(receipt.scenario);
  globalThis.parallaxiaChallengeTarget={...receipt.scenario.target,phase:receipt[branch].succeeded?'landed':'missed'};
  start(false); window.__game.realtime(false); const epoch = playbackEpoch;
  renderBatch(() => { for(const bits of inputs) { dash=Boolean(bits & DASH_INPUT);port.setDash(dash);stepWithInput(bits & NATIVE_INPUT_MASK,{sound:false}); } });
  release();
  if (await replayDigest(checkpointState(sim,port)) !== receipt.checkpoint.stateDigest) throw Error('Displayed checkpoint digest differs');
  const begin=performance.now();
  for(let tick=0;tick<future.length;tick++) {
    const due=begin+tick*FRAME_MS;
    while(performance.now()<due) await new Promise(requestAnimationFrame);
    if(playbackEpoch!==epoch) throw Error('Replay stopped by reset');
    dash=branch==='candidate' && tick===receipt.interventionTick;port.setDash(dash);stepWithInput(future[tick]);
  }
  const endDigest=await replayDigest(checkpointState(sim,port));
  if(endDigest!==receipt[branch].endDigest) throw Error('Displayed replay outcome differs from worker');
  release(); return {branch,endDigest,succeeded:receipt[branch].succeeded};
};

window.roadsterPresentation = () => ({
  enabled: presentationEnabled,
  hold: holdActive,
  visibleAfterimages: afterimages.length,
  presentedPose: presentedPose ?? { x: sim.ship.x, y: sim.ship.y, pitch: 0, roll: 0 },
});
window.roadsterStart = start;
window.roadsterSnapshot = () => ({
  status: sim.phase === 'play' ? 'playing' : sim.phase,
  car: shipCarState(),
  game: window.__game.state(),
  motion: port.snapshot(sim),
  componentId: config.transferred ? config.componentId : null,
});
window.roadsterAdvance = (frames = 1, options = {}) =>
  renderBatch(() => {
    if (options.dash !== undefined) {
      dash = Boolean(options.dash);
      port.setDash(dash);
    }
    for (let i = 0; i < frames; i++) {
      window.__game.advance(1 / 60, options.driver ?? 'autopilot');
    }
    return window.roadsterSnapshot();
  });
window.roadsterGuideStart = () => {
  start(false);
  guided = true;
  window.__game.realtime(false);
  return window.roadsterSnapshot();
};
window.roadsterGuideRecord = (frames) =>
  renderBatch(() => {
    const controls = [];
    for (let i = 0; i < frames; i++) {
      const bits = pilotControls[sim.frame % pilotControls.length] ?? INPUT.SHOT;
      const input = {
        throttle: bits & INPUT.RIGHT ? 1 : 0,
        brake: bits & INPUT.LEFT ? 1 : 0,
        thrust: Boolean(bits & INPUT.SHOT),
        spin: 0,
      };
      controls.push(input);
      stepWithInput(bits);
    }
    return { controls, state: window.roadsterSnapshot() };
  });

if (testing) {
  window.roadsterFixture = (values) => {
    if (Number.isFinite(values.x)) sim.ship.x = values.x;
    if (Number.isFinite(values.y)) sim.ship.y = values.y;
    sim.px = sim.ship.x;
    sim.py = sim.ship.y;
    presentedPose = { x: sim.ship.x, y: sim.ship.y, pitch: 0, roll: 0 };
    renderNow();
  };
}

const channel = location.hash.match(/(?:#|&)channel=([a-zA-Z0-9-]+)/)?.[1];
window.addEventListener('message', (event) => {
  if (event.source !== parent || !channel || event.data?.channel !== channel) return;
  const { type, pressed } = event.data;
  if (type === 'parallaxia-replay') {
    window.parallaxiaReplayExperiment(event.data.receipt,event.data.branch).then(result=>parent.postMessage({type:'parallaxia-replay-result',channel,result},'*'),error=>parent.postMessage({type:'parallaxia-replay-result',channel,error:error.message},'*'));
  }
  if (type === 'parallaxia-curated-checkpoint') {
    start(false);window.__game.realtime(false);renderBatch(()=>{for(let tick=0;tick<40;tick++)stepWithInput(0,{sound:false});});
    window.parallaxiaCaptureCheckpoint().then(checkpoint=>parent.postMessage({type:'parallaxia-checkpoint-result',channel,checkpoint,curated:true},'*'));
  }
  if (type === 'parallaxia-checkpoint') {
    window.parallaxiaCaptureCheckpoint().then(checkpoint => parent.postMessage({type:'parallaxia-checkpoint-result',channel,requestId:event.data.requestId,checkpoint},'*'), error => parent.postMessage({type:'parallaxia-checkpoint-result',channel,requestId:event.data.requestId,error:error.message},'*'));
  }
  if (type === 'parallaxia-resume') window.__game.realtime(true);
  if (type === 'parallaxia-input') {
    const bit = { left: INPUT.LEFT, right: INPUT.RIGHT, up: INPUT.UP, down: INPUT.DOWN, shot: INPUT.SHOT }[event.data.control];
    if (bit !== undefined) keyboardBits = pressed ? keyboardBits | bit : keyboardBits & ~bit;
  }
  if (type === 'dash') {
    dash = Boolean(pressed);
    port.setDash(dash);
  }
  if (type === 'turn' && pressed) start(true);
  if (type === 'roadster-restart') start(false);
  if (type === 'roadster-visibility' && !testing && !guided) {
    window.__game.realtime(Boolean(pressed));
    if (!pressed) release();
  }
  if (type === 'roadster-guide-start') {
    window.roadsterGuideStart();
    parent.postMessage(
      {
        type: 'roadster-guide-result',
        channel,
        requestId: event.data.requestId,
        state: window.roadsterSnapshot(),
      },
      '*',
    );
  }
  if (type === 'roadster-guide-step') {
    const inputs = event.data.controls;
    if (!Array.isArray(inputs) || inputs.length > 12) return;
    renderBatch(() => {
      for (const input of inputs) {
        window.roadsterAdvance(1, { driver: input, dash: Boolean(event.data.dash) });
      }
    });
    parent.postMessage(
      {
        type: 'roadster-guide-result',
        channel,
        requestId: event.data.requestId,
        state: window.roadsterSnapshot(),
      },
      '*',
    );
  }
  if (type === 'roadster-guide-finish') {
    guided = false;
    release();
    if (!testing) window.__game.realtime(true);
  }
});

let lastLoopTime = null;
let loopAccumulator = 0;
function realtimeLoop(now) {
  if (lastLoopTime === null) lastLoopTime = now;
  const elapsed = Math.min(now - lastLoopTime, 100);
  lastLoopTime = now;
  if (realtimeActive && !config.challenge) {
    loopAccumulator += elapsed;
    let steps = 0;
    while (loopAccumulator >= FRAME_MS && steps < 5) {
      const bits =
        keyboardBits || (assistedMode ? (pilotControls[sim.frame % pilotControls.length] ?? INPUT.SHOT) : INPUT.SHOT);
      stepWithInput(bits);
      loopAccumulator -= FRAME_MS;
      steps++;
    }
    bus.setMusic(
      cueFor({
        title: false,
        playing: sim.phase === 'play',
        boss: bossTuneAt(sim.stage.section, sim.stage.boss !== 0),
        loop: loopForMusic(sim.stage.section, sim.stage.boss !== 0),
      }),
    );
    bus.pump();
  }
  requestAnimationFrame(realtimeLoop);
}

start(false);
if (testing) window.__game.realtime(false);
else requestAnimationFrame(realtimeLoop);
window.roadsterReady = true;

const app = {
  get physics() {
    return sim;
  },
  onPhysicsEvent() {},
};
const getSim = () => sim;

export { app, port, release, start, renderBatch, getSim, stepWithInput };

setInterval(() => {
  const state = window.roadsterSnapshot();
  const motion = state.motion;
  const meter = document.querySelector('#transfer-meter');
  if (meter) {
    meter.textContent = config.transferred
      ? motion?.output?.ownsMotion
        ? 'RECOVERED DASH ACTIVE'
        : motion?.state?.core?.cooldown > 0
          ? 'DASH RECHARGING'
          : 'X · PHASE DASH'
      : 'ORIGINAL SIMULATION · NO DASH';
  }
  if (channel) parent.postMessage({ type: 'motion-status', channel, ...state }, '*');
}, 80);
