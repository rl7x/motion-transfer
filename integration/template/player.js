const $ = selector => document.querySelector(selector);
const frames = [$('#before'), $('#after')];
let comparing = false, paused = false, measurementUrl;
function send(frame, code, pressed) {
  const win = frame.contentWindow;
  if (!win?.jujumpReady) return;
  frame.contentDocument.dispatchEvent(new win.KeyboardEvent(pressed ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : 'd', bubbles: true, cancelable: true }));
}
for (const button of document.querySelectorAll('[data-key]')) {
  const change = pressed => send($('#' + button.dataset.frame), button.dataset.key, pressed);
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); change(true); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) button.addEventListener(name, () => change(false));
  button.addEventListener('keydown', event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); if (!event.repeat) change(true); } });
  button.addEventListener('keyup', event => { if (['Space', 'Enter'].includes(event.code)) { event.preventDefault(); change(false); } });
}
window.addEventListener('blur', () => { for (const frame of frames) for (const key of ['Space', 'KeyD']) send(frame, key, false); });
setInterval(() => {
  for (const button of document.querySelectorAll('[data-key]')) button.disabled = comparing || paused || !$('#' + button.dataset.frame).contentWindow?.jujumpReady;
}, 80);
async function load(frame, url) {
  const deadline = Date.now() + 8000;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Player did not load')), 8000);
    frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    frame.src = url;
  });
  // Module imports and the configuration fetch may outlive the iframe load event.
  while (!frame.contentWindow.jujumpReady && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (!frame.contentWindow.jujumpReady) throw Error('Player initialization failed');
}
$('#resume').addEventListener('click', () => {
  if (comparing) return;
  paused = false;
  frames[0].src = 'original.html?mode=original'; frames[1].src = 'transferred.html?mode=transfer';
  $('#comparison-status').textContent = 'Free play. Click a game for keyboard controls, or use its touch buttons.';
});
$('#compare').addEventListener('click', async () => {
  if (comparing) return;
  comparing = true; paused = true; $('#compare').disabled = $('#resume').disabled = true;
  $('#measurements').hidden = true; $('#measurements-summary').textContent = '';
  $('#comparison-status').textContent = 'Running the same open-air starting conditions in both games…';
  try {
    await Promise.all([load(frames[0], 'original.html?mode=original&test=1'), load(frames[1], 'transferred.html?mode=transfer&test=1')]);
    for (const frame of frames) {
      const win = frame.contentWindow;
      send(frame, 'Space', true); win.gameClock.advance(); send(frame, 'Space', false); win.gameClock.advance(10);
      win.jujumpFixture({ p: { x: 30, y: 20 }, v: { x: 1, y: 0.5 }, floors: [], jumpWay: 1, floorAppDist: 99999 });
    }
    const captures = frames.map(frame => [frame.contentWindow.jujumpSnapshot()]);
    send(frames[1], 'KeyD', true);
    for (let tick = 0; tick < 8; tick++) {
      for (const [index, frame] of frames.entries()) { frame.contentWindow.gameClock.advance(); captures[index].push(frame.contentWindow.jujumpSnapshot()); }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    send(frames[1], 'KeyD', false);
    const [before, after] = captures;
    const distance = path => path.at(-1).p.x - path[0].p.x;
    const verticalError = Math.max(...before.map((value, i) => Math.abs(value.p.y - after[i].p.y)));
    const velocityError = Math.max(...before.map((value, i) => Math.abs(value.v.y - after[i].v.y)));
    const passed = Math.abs(distance(after) - 30) < 1e-9 && distance(before) === 8 && verticalError < 1e-9 && velocityError === 0 && after.at(-1).motion.core.cooldown === 25 && after.at(-1).motion.output.events.includes('dash-end');
    const response = await fetch('manifest.json'); if (!response.ok) throw Error('Package identity unavailable');
    const manifest = await response.json();
    const report = { schemaVersion: 1, kind: 'local-scripted-integration-check', metaCalled: false, componentId: manifest.componentId, packageId: manifest.id, passed, fixture: 'Open air, x30/y20, velocity x1/y0.5, no platforms; recipient rendering and scrolling active. This is not fresh donor acceptance.', metrics: { updates: 8, ordinaryDistance: distance(before), dashDistance: distance(after), maxVerticalDifference: verticalError, maxVerticalVelocityDifference: velocityError }, before, after };
    if (measurementUrl) URL.revokeObjectURL(measurementUrl);
    measurementUrl = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    $('#measurements').href = measurementUrl; $('#measurements').hidden = false;
    $('#measurements-summary').textContent = `${passed ? 'PASS' : 'FAIL'} · ${distance(before)} → ${distance(after)} horizontal pixels over 8 updates. Maximum vertical difference: ${verticalError.toExponential(1)} pixels. Recharge after the burst: ${after.at(-1).motion.core.cooldown} ticks.`;
    $('#comparison-status').textContent = 'Actual local execution, no model call. Controlled open-air fixture; platform collisions have separate saved checks. Reset both to play freely.';
  } catch (error) { $('#comparison-status').textContent = error.message + '. Reset both to return to free play.'; }
  finally { comparing = false; $('#compare').disabled = $('#resume').disabled = false; }
});
