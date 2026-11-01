if (new URL(location.href).searchParams.get('mode') === 'transfer') {
  const [adapter, recovered, { createMotionPort }, response] = await Promise.all([
    import('/assets/adapter.js'), import('/assets/component.js'), import('/assets/port.js'), fetch('/api/transfer-config'),
  ]);
  const config = await response.json();
  const params = new URL(location.href).searchParams;
  if (params.get('test') === '1' && params.has('scale')) {
    const scale = Number(params.get('scale'));
    if (!Number.isFinite(scale) || scale <= 0 || scale > 2) throw Error('Invalid fixture scale');
    config.unitScale = scale;
  }
  window.motionPort = createMotionPort(adapter, recovered, config);
}
window.onLoad();
window.pakuReady = true;
if (new URL(location.href).searchParams.get('test') !== '1') window.gameClock.start();
