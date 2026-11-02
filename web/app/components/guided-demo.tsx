import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api';
import { useTransfer } from '../transfer-context';
import type { PlayerWindow, RoadsterSnapshot } from '../types';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function frame(id: string) {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLIFrameElement)) throw Error('Player is unavailable');
  return value;
}
function channel(frame: HTMLIFrameElement) {
  return new URLSearchParams(new URL(frame.src).hash.slice(1)).get('channel');
}
async function ready(value: HTMLIFrameElement) {
  for (let index = 0; index < 150; index++) {
    try {
      if ((value.contentWindow as PlayerWindow | null)?.roadsterReady) return;
    } catch {
      /* Opaque players report readiness by message. */
    }
    if (
      value.id === 'transfer-game' &&
      document.getElementById('transfer-status')?.textContent === 'VERIFIED TRANSFER'
    )
      return;
    await delay(50);
  }
  throw Error('Player did not load');
}
function ask(
  value: HTMLIFrameElement,
  type: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<RoadsterSnapshot> {
  const requestId = crypto.randomUUID(),
    token = channel(value);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', listener);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(Error('Demonstration cancelled'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(Error('The guided player did not respond'));
    }, 5000);
    const listener = (event: MessageEvent) => {
      if (
        event.source !== value.contentWindow ||
        event.data?.channel !== token ||
        event.data?.type !== 'roadster-guide-result' ||
        event.data.requestId !== requestId
      )
        return;
      cleanup();
      resolve(event.data.state);
    };
    window.addEventListener('message', listener);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    value.contentWindow?.postMessage({ type, channel: token, requestId, ...payload }, '*');
  });
}
export function GuidedDemo() {
  const { destination, artifact, savedRoadsterId, openRoadsterArtifact } = useTransfer();
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState('A recorded-input demonstration. No model call.');
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      window.guidedRunning = false;
    },
    [],
  );
  async function run() {
    if (running) return;
    const operation = new AbortController();
    controller.current = operation;
    setRunning(true);
    window.guidedRunning = true;
    window.guidedState = { phase: 'starting' };
    let before: HTMLIFrameElement | undefined, after: HTMLIFrameElement | undefined;
    try {
      if (!savedRoadsterId)
        throw Error(
          'The Roadster demonstration needs a verified transfer and WebGL2. The other destinations remain playable.',
        );
      if (destination?.id !== 'roadster' || artifact?.id !== savedRoadsterId)
        await openRoadsterArtifact(savedRoadsterId);
      await delay(50);
      before = frame('original-game');
      after = frame('transfer-game');
      await Promise.all([ready(before), ready(after)]);
      document.querySelector('.games')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const donor = frame('donor-game'),
        token = channel(donor);
      donor.setAttribute('src', donor.src);
      await delay(500);
      const input = (button: string, pressed: boolean) =>
        donor.contentWindow?.postMessage(
          { type: 'donor-control', button, pressed, channel: token },
          '*',
        );
      input('dash', true);
      await delay(35);
      input('dash', false);
      await delay(230);
      input('right', true);
      input('dash', true);
      await delay(140);
      input('dash', false);
      input('right', false);
      if (innerWidth < 900)
        after.closest('.game-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setProgress(
        'The compiled donor supplies the ability. Next: the same controller inside the Roadster, using matched recorded native inputs.',
      );
      const original = before.contentWindow as PlayerWindow;
      original.roadsterGuideStart();
      await ask(after, 'roadster-guide-start', {}, operation.signal);
      let state: RoadsterSnapshot | undefined;
      for (let chunk = 0; chunk < 150; chunk++) {
        if (window.currentDestination !== 'roadster' || operation.signal.aborted)
          throw Error('Demonstration stopped after changing destination.');
        const recorded = original.roadsterGuideRecord(6);
        state = await ask(
          after,
          'roadster-guide-step',
          { controls: recorded.controls, dash: false },
          operation.signal,
        );
        if (
          recorded.state.car.mode === 'airborne' &&
          recorded.state.car.airTime >= 1.1 &&
          recorded.state.car.heightAboveGround > 5
        )
          break;
        await delay(40);
      }
      if (state?.car.mode !== 'airborne')
        throw Error('The scripted stunt did not reach its airborne comparison.');
      const start = state.car.position.x;
      let activeUpdates = 0;
      const trace = [];
      setProgress(
        'Airborne: eight slowed updates. The recovered dash supplies horizontal movement; the car keeps its own vertical motion.',
      );
      window.guidedState = { phase: 'dashing' };
      for (let tick = 0; tick < 8; tick++) {
        const recorded = original.roadsterGuideRecord(1);
        state = await ask(
          after,
          'roadster-guide-step',
          { controls: recorded.controls, dash: true },
          operation.signal,
        );
        trace.push({
          before: recorded.state.car.position,
          after: state.car.position,
          mode: state.car.mode,
          events: state.motion.output.events,
        });
        if (state.motion.output.ownsMotion) activeUpdates++;
        await delay(120);
      }
      const measuredMeters = state.car.position.x - start;
      window.guidedState = { phase: 'finishing', activeUpdates, measuredMeters };
      for (let chunk = 0; chunk < 40; chunk++) {
        const recorded = original.roadsterGuideRecord(6);
        await ask(
          after,
          'roadster-guide-step',
          { controls: recorded.controls, dash: false },
          operation.signal,
        );
        await delay(40);
      }
      setProgress(
        `Actual transfer: ${measuredMeters.toFixed(2)} meters during ${activeUpdates} active updates. The component stayed frozen. Try X yourself, then investigate or adapt with Meta.`,
      );
      window.guidedState = { phase: 'complete', activeUpdates, measuredMeters, trace };
    } catch (error) {
      if (!operation.signal.aborted) {
        setProgress(errorMessage(error));
        window.guidedState = { phase: 'failed', error: errorMessage(error) };
      }
    } finally {
      try {
        after?.contentWindow?.postMessage(
          { type: 'roadster-guide-finish', channel: channel(after) },
          '*',
        );
        (before?.contentWindow as PlayerWindow | null)?.__game?.realtime(true);
      } catch {
        /* The destination may have changed. */
      }
      window.guidedRunning = false;
      if (!operation.signal.aborted) setRunning(false);
    }
  }
  return (
    <>
      <button
        id="watch-transfer"
        type="button"
        disabled={running}
        onClick={() => {
          void run();
        }}
      >
        Watch the ability move · ~25 seconds ↗
      </button>
      <p id="guided-progress" className="saved-note" role="status">
        {progress}
      </p>
    </>
  );
}
