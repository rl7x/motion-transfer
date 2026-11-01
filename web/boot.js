if (new URL(location.href).searchParams.get('mode') === 'transfer') {
  const [adapter, recovered, { createMotionPort }, response] = await Promise.all([
    import('/assets/adapter.js'), import('/assets/component.js'), import('/assets/port.js'), fetch('/api/transfer-config'),
  ]);
  window.motionPort = createMotionPort(adapter, recovered, await response.json());
}
window.onLoad();
window.pakuReady = true;
if (new URL(location.href).searchParams.get('test') !== '1') window.gameClock.start();
