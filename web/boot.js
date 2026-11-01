window.onLoad();
window.pakuReady = true;
if (new URL(location.href).searchParams.get('test') !== '1') window.gameClock.start();
