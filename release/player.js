const root = document.querySelector('[data-release-player]');
if (root) {
  const frame = root.querySelector('iframe');
  const channel = crypto.randomUUID();
  const src = new URL(frame.dataset.src, document.baseURI);
  src.searchParams.set('quality', 'low');
  src.hash = 'channel=' + channel;
  frame.src = src.pathname + src.search + src.hash;
  const send = (type, extra = {}) => frame.contentWindow?.postMessage({ type, channel, ...extra }, '*');
  const command = action => send('challenge-command', { action });
  root.addEventListener('click', event => {
    const action = event.target?.closest?.('[data-action]')?.dataset.action;
    if (action) command(action);
  });
  const dash = root.querySelector('[data-dash]');
  const hold = pressed => send('dash', { pressed });
  dash?.addEventListener('pointerdown', event => {
    event.preventDefault();
    dash.setPointerCapture(event.pointerId);
    hold(true);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) dash?.addEventListener(name, () => hold(false));
  const onKey = event => {
    if (event.repeat) return;
    if (event.code === 'KeyX') { event.preventDefault(); hold(event.type === 'keydown'); }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.data?.channel !== channel || event.data.type !== 'challenge-status') return;
    const state = event.data.state;
    const result = root.querySelector('[data-result]');
    result.dataset.phase = state.phase;
    result.textContent = state.phase === 'landed' ? 'Landed in the zone!'
      : state.phase === 'missed' ? 'Outside the zone. Try a different dash timing.'
        : state.phase === 'running' ? 'Press X while airborne. Aim for the green zone.'
          : state.borrowed ? 'Dash borrowed. Launch, then choose when to dash.'
            : 'Try the original. Then borrow a move from Dashy Dango.';
  });
  window.addEventListener('pagehide', () => hold(false), { once: true });
}
