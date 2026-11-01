if (new URL(location.href).searchParams.get('mode') === 'transfer') {
  const [adapter, component, { createMotionPort }, response] = await Promise.all([
    import('/assets/jujump-adapter.js'), import('/assets/component.js'), import('/assets/port.js'), fetch('/api/transfer-config'),
  ]);
  window.motionPort = createMotionPort(adapter, component, await response.json());
}
window.onLoad();
window.jujumpReady = true;
if (new URL(location.href).searchParams.get('test') !== '1') window.gameClock.start();
