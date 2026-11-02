import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import config from 'roadster-config';
import { app, port, release, start, renderBatch } from './roadster-entry.js';
import { landingInTarget } from '../roadster/challenge-contract.mjs';

const challenge = config.challenge;
const testing = new URLSearchParams(location.search).get('test') === '1';
const channel = location.hash.match(/(?:#|&)channel=([a-zA-Z0-9-]+)/)?.[1];
const target = challenge.target;
const marker = new Mesh(new BoxGeometry(target.maxX - target.minX, 0.06, 7),
  new MeshBasicMaterial({ color: 0xc6ed89, transparent: true, opacity: 0.8 }));
marker.position.set((target.minX + target.maxX) / 2, 0.03, 0);
app.renderer.scene.add(marker);
let borrowed = false, rawDash = false, automatic = false, visible = true;
let state = { phase: 'ready', tick: 0, landing: null, activeUpdates: 0, dashMeters: 0 };
let accumulator = 0, previousTime = null, animation;
let standaloneStatus;
const setDash = port.setDash;
port.setDash = value => { rawDash = Boolean(value); setDash(borrowed && rawDash); };
const originalEvent = app.onPhysicsEvent.bind(app);
app.onPhysicsEvent = event => {
  originalEvent(event);
  if (state.phase === 'running' && ['land', 'crash'].includes(event.type)) {
    state.landing = structuredClone(event);
    state.phase = landingInTarget(event, target) ? 'landed' : 'missed';
    release();
  }
};
function snapshot() {
  return { ...structuredClone(state), borrowed, dashHeld: rawDash, target, challengeId: challenge.id,
    componentId: config.componentId, controlsSha256: challenge.controlsSha256,
    durationSeconds: state.tick / 60, motion: port.snapshot(app.physics) };
}
function post() {
  if (standaloneStatus) standaloneStatus.textContent = state.phase === 'landed' ? 'Landed in the zone!' : state.phase === 'missed'
    ? 'Landed outside the zone. Try the dash.' : borrowed ? 'Dash borrowed. Run, then press X in the air.' : 'Run the original, then borrow the dash.';
  if (channel) parent.postMessage({ type: 'challenge-status', channel, state: snapshot() }, '*');
}
function reset({ borrow = borrowed, run = false, demo = false } = {}) {
  borrowed = borrow;
  state = { phase: 'ready', tick: 0, landing: null, activeUpdates: 0, dashMeters: 0 };
  start(false);
  window.__game.realtime(false);
  automatic = demo;
  accumulator = 0; previousTime = null;
  if (run) state.phase = 'running';
  post();
  return snapshot();
}
function advance(frames = 1) {
  if (!Number.isSafeInteger(frames) || frames < 0 || frames > challenge.maxTicks) throw Error('Invalid challenge frame count');
  renderBatch(() => {
    for (let index = 0; index < frames && state.phase === 'running'; index++) {
      const controls = challenge.controls[state.tick] ?? { throttle: 0, brake: 0, thrust: false, spin: 0 };
      setDash(borrowed && (automatic ? state.tick === challenge.dashTick : rawDash));
      state.tick++;
      window.__game.advance(1 / 60, controls);
      const output = port.snapshot(app.physics)?.output;
      if (output?.ownsMotion) { state.activeUpdates++; state.dashMeters += output.displacement; }
      if (state.tick >= challenge.maxTicks && state.phase === 'running') { state.phase = 'missed'; release(); }
    }
  });
  return snapshot();
}
function frame(time) {
  if (previousTime !== null && visible && state.phase === 'running') {
    accumulator += Math.min((time - previousTime) / 1000, 0.1);
    const frames = Math.min(6, Math.floor((accumulator + 1e-9) * 60));
    if (frames) { advance(frames); accumulator -= frames / 60; }
  }
  previousTime = time;
  animation = requestAnimationFrame(frame);
}
const listener = event => {
  if (event.source !== parent || !channel || event.data?.channel !== channel) return;
  const { type, action } = event.data;
  if (type === 'roadster-visibility') {
    const nextVisible = Boolean(event.data.pressed);
    if (visible !== nextVisible) previousTime = null;
    visible = nextVisible;
    window.__game.realtime(false);
    if (!visible) release();
  }
  if (type !== 'challenge-command') return;
  if (action === 'start') reset({ run: true });
  if (action === 'reset') reset();
  if (action === 'borrow') reset({ borrow: true });
  if (action === 'original') reset({ borrow: false, run: true, demo: true });
  if (action === 'demonstrate') reset({ borrow: true, run: true, demo: true });
};
window.addEventListener('message', listener);
window.roadsterChallengeSnapshot = snapshot;
if (window === parent) {
  const controls = document.createElement('div');
  controls.style.cssText = 'position:fixed;z-index:100;top:10px;left:10px;right:10px;background:#101b16ed;color:#e3f3dd;padding:12px;font:14px system-ui;border:1px solid #799765;display:flex;gap:8px;flex-wrap:wrap;align-items:center';
  controls.innerHTML = '<strong>LAND IN THE GREEN ZONE</strong><button data-action="run">Run</button><button data-action="borrow">Borrow dash</button><button data-action="dash">Hold to dash · X</button><button data-action="reset">Restart</button><span role="status"></span><small>For adults 18 and older. RDSTR Stunts by sebayaki; recovered dash and challenge added by Motion Transfer.</small>';
  controls.querySelector('[data-action="run"]').addEventListener('click', () => reset({ run: true }));
  controls.querySelector('[data-action="borrow"]').addEventListener('click', () => reset({ borrow: true }));
  controls.querySelector('[data-action="reset"]').addEventListener('click', () => reset());
  const button = controls.querySelector('[data-action="dash"]');
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); port.setDash(true); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => port.setDash(false));
  standaloneStatus = controls.querySelector('[role="status"]');
  document.body.append(controls);
}
if (testing) {
  window.roadsterChallengeAdvance = advance;
  window.roadsterChallengeStart = options => reset({ run: true, ...options });
}
reset();
const statusTimer = setInterval(post, 80);
if (!testing) animation = requestAnimationFrame(frame);
window.addEventListener('pagehide', () => {
  clearInterval(statusTimer); cancelAnimationFrame(animation); window.removeEventListener('message', listener); release();
}, { once: true });
