const status = document.querySelector('#transfer-status');
const transferFrame = document.querySelector('#transfer-game');
const placeholder = document.querySelector('#transfer-placeholder');

try {
  const response = await fetch('/api/transfer');
  if (!response.ok) throw Error('Transfer metadata is unavailable');
  const transfer = await response.json();
  if (transfer.status !== 'verified') throw Error('No verified transfer has been saved yet');
  status.textContent = 'VERIFIED TRANSFER';
  transferFrame.src = transferFrame.dataset.src;
  transferFrame.hidden = false;
  placeholder.hidden = true;
  document.querySelectorAll('[data-transfer-control]').forEach(button => { button.disabled = false; });
  document.querySelector('#check-count').textContent = `${transfer.conformanceChecks + transfer.browserChecks} checks passed`;
  document.querySelector('#model').textContent = transfer.model;
  document.querySelector('#artifact-id').textContent = transfer.id.slice(0, 12);
  document.querySelector('#artifact-id').title = transfer.id;
  document.querySelector('#generation-cost').textContent = `$${transfer.estimatedGenerationCostUsd.toFixed(3)}`;
} catch (error) {
  status.textContent = 'TRANSFER UNAVAILABLE';
  placeholder.textContent = error.message;
}

function dash(pressed) {
  transferFrame.contentWindow?.postMessage({ type: 'dash', pressed }, location.origin);
  document.querySelector('[data-dash]').classList.toggle('pressed', pressed);
}

for (const button of document.querySelectorAll('[data-turn]')) {
  const frame = document.getElementById(button.dataset.turn);
  const turn = pressed => {
    if (!frame.contentWindow?.pakuReady) return;
    frame.contentDocument.dispatchEvent(new frame.contentWindow.KeyboardEvent(pressed ? 'keydown' : 'keyup', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
  };
  button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); turn(true); });
  button.addEventListener('pointerup', () => turn(false));
  button.addEventListener('pointercancel', () => turn(false));
  button.addEventListener('lostpointercapture', () => turn(false));
  button.addEventListener('keydown', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); if (!event.repeat) turn(true); } });
  button.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); turn(false); } });
  button.addEventListener('blur', () => turn(false));
}

const dashButton = document.querySelector('[data-dash]');
dashButton.addEventListener('pointerdown', event => { dashButton.setPointerCapture(event.pointerId); dash(true); });
dashButton.addEventListener('pointerup', () => dash(false));
dashButton.addEventListener('pointercancel', () => dash(false));
dashButton.addEventListener('lostpointercapture', () => dash(false));
dashButton.addEventListener('keydown', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); dash(true); } });
dashButton.addEventListener('keyup', event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); dash(false); } });
dashButton.addEventListener('blur', () => dash(false));
window.addEventListener('blur', () => dash(false));

for (const button of document.querySelectorAll('[data-reset]')) button.addEventListener('click', () => {
  const frame = document.getElementById(button.dataset.reset);
  if (frame === transferFrame) dash(false);
  if (frame.getAttribute('src')) frame.src = frame.getAttribute('src');
});

setInterval(() => {
  try {
    const game = transferFrame.contentWindow?.pakuSnapshot?.();
    const motion = game?.motion;
    const label = document.querySelector('#dash-state');
    if (!motion || game.status !== 'playing' || game.isReplaying) label.textContent = game?.isReplaying ? 'REPLAY' : 'READY TO PLAY';
    else if (motion.output?.ownsMotion) label.textContent = 'DASH ACTIVE';
    else if (motion.core.cooldown > 0) label.textContent = `RECHARGING · ${motion.core.cooldown} TICKS`;
    else label.textContent = 'DASH READY';
  } catch { /* The frame may be between documents during reset. */ }
}, 80);
