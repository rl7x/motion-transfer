(() => {
  const step = 1000 / 60;
  let callback, time = 0, accumulator = 0, last, running = false;
  const clock = {
    seed: 9,
    schedule(next) { callback = next; },
    get time() { return time; },
    advance(count = 1) {
      if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) throw Error('Invalid simulation frame count');
      for (let index = 0; index < count; index++) {
        if (!callback) throw Error('Game has not scheduled its next update');
        time += step;
        const next = callback;
        callback = undefined;
        next();
      }
    },
    elapse(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 250) throw Error('Invalid display-frame duration');
      accumulator += milliseconds;
      while (accumulator + 1e-7 >= step) { clock.advance(); accumulator -= step; }
    },
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      const display = now => {
        clock.elapse(Math.min(250, Math.max(0, now - last)));
        last = now;
        requestAnimationFrame(display);
      };
      requestAnimationFrame(display);
    },
  };
  window.gameClock = clock;
})();
