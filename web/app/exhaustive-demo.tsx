import { useEffect, useState } from 'react';
import data from '../../assets/evidence/exhaustive-demo.json';

const SCAN_MS = 6000;
const TICK_MS = 320;
const DURATION = SCAN_MS + (data.frames.length - 1) * TICK_MS;
const failureState = data.frames[data.divergenceTick - 1].stateKey;
const format = (value: number) => value.toLocaleString('en-US');

const styles = `
  .exhaustive-demo { --ink: #edf4f0; --dim: #9dafaa; --green: #83e4af; --red: #ff8b86;
    color: var(--ink); background: #101b1a; min-height: 100vh; padding: 32px max(24px, calc((100vw - 1160px) / 2));
    font: 15px/1.5 system-ui, sans-serif; box-sizing: border-box; }
  .exhaustive-demo * { box-sizing: border-box; }
  .exhaustive-demo a { color: var(--green); }
  .exhaustive-demo h1 { font-size: clamp(30px, 4vw, 52px); line-height: 1.1; letter-spacing: -.04em; margin: 18px 0 14px; }
  .exhaustive-demo h2 { font-size: 18px; margin: 0; letter-spacing: -.01em; }
  .exhaustive-demo p { margin: 8px 0; }
  .exhaustive-demo .ex-kicker { color: var(--green); font: 12px/1.4 ui-monospace, monospace; letter-spacing: .14em; }
  .exhaustive-demo .ex-description { color: var(--dim); max-width: 800px; font-size: 17px; }
  .exhaustive-demo .ex-top { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
  .exhaustive-demo .ex-tag { border: 1px solid #3a5048; border-radius: 4px; color: var(--dim); font-size: 12px; padding: 5px 9px; }
  .exhaustive-demo .ex-controls { display: flex; align-items: center; gap: 10px; margin: 22px 0; flex-wrap: wrap; }
  .exhaustive-demo button { border-radius: 5px; padding: 10px 16px; font: inherit; cursor: pointer; border: 1px solid #425c50; background: #1d3029; color: var(--ink); }
  .exhaustive-demo button:first-child { background: var(--green); color: #0e261b; font-weight: 650; border-color: var(--green); }
  .exhaustive-demo button:focus-visible, .exhaustive-demo input:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
  .exhaustive-demo .ex-controls span { color: var(--dim); font-size: 13px; margin-left: auto; }
  .exhaustive-demo .ex-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .exhaustive-demo .ex-panel { background: #162321; border: 1px solid #30443e; border-radius: 10px; padding: 22px; }
  .exhaustive-demo .ex-panel-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .exhaustive-demo .ex-counter { color: var(--green); font: 14px ui-monospace, monospace; white-space: nowrap; }
  .exhaustive-demo .ex-grid { display: grid; grid-template-columns: repeat(25, 1fr); gap: 4px; margin: 24px 0 12px; }
  .exhaustive-demo .ex-cell { aspect-ratio: 1; border-radius: 2px; background: #263831; border: 1px solid #3c5148; }
  .exhaustive-demo .ex-cell.checked { background: var(--green); border-color: var(--green); }
  .exhaustive-demo .ex-cell.failed { background: var(--red); border-color: #ffd4cf; box-shadow: 0 0 0 2px #ff8b8633; }
  .exhaustive-demo .ex-legend { color: var(--dim); font-size: 12px; display: flex; gap: 16px; flex-wrap: wrap; }
  .exhaustive-demo .ex-dot { display: inline-block; width: 8px; height: 8px; background: var(--green); margin-right: 5px; }
  .exhaustive-demo .ex-dot.bad { background: var(--red); }
  .exhaustive-demo .ex-coverage { margin-top: 24px; padding-top: 18px; border-top: 1px solid #30443e; }
  .exhaustive-demo .ex-bar { height: 6px; background: #263831; border-radius: 5px; overflow: hidden; margin: 7px 0 14px; }
  .exhaustive-demo .ex-bar span { display: block; height: 100%; background: var(--green); }
  .exhaustive-demo .ex-label { display: flex; justify-content: space-between; font-size: 12px; color: var(--dim); }
  .exhaustive-demo .ex-replay { display: grid; grid-template-columns: 160px 1fr; gap: 18px; align-items: center; margin: 20px 0 14px; }
  .exhaustive-demo .ex-replay img { display: block; width: 160px; height: 160px; image-rendering: pixelated; border-radius: 4px; }
  .exhaustive-demo .ex-caption { font-size: 11px; color: var(--dim); margin-top: 6px; }
  .exhaustive-demo .ex-input { font: 24px ui-monospace, monospace; margin: 5px 0 15px; }
  .exhaustive-demo .ex-readout { font: 13px/1.8 ui-monospace, monospace; }
  .exhaustive-demo .ex-readout span { display: block; color: var(--green); }
  .exhaustive-demo .ex-readout span:last-child { color: var(--red); }
  .exhaustive-demo .ex-track { display: block; width: 100%; height: auto; background: #101b1a; border-radius: 4px; }
  .exhaustive-demo .ex-verdict { min-height: 52px; padding-top: 12px; color: var(--dim); font-size: 14px; }
  .exhaustive-demo .ex-verdict.diverged { color: var(--red); }
  .exhaustive-demo .ex-timeline { display: flex; align-items: center; gap: 14px; margin: 20px 0; color: var(--dim); font-size: 12px; }
  .exhaustive-demo input { flex: 1; accent-color: var(--green); }
  .exhaustive-demo .ex-limits { font-size: 12px; color: var(--dim); border-top: 1px solid #30443e; padding-top: 18px; }
  .exhaustive-demo .ex-limits ul { display: flex; flex-wrap: wrap; gap: 8px 30px; padding-left: 18px; margin: 10px 0 0; }
  @media (max-width: 800px) {
    .exhaustive-demo { padding: 24px 18px; }
    .exhaustive-demo .ex-columns { grid-template-columns: 1fr; }
    .exhaustive-demo .ex-panel { padding: 18px; }
    .exhaustive-demo .ex-controls span { width: 100%; margin: 0; }
    .exhaustive-demo .ex-top { align-items: flex-start; }
  }
  @media (max-width: 380px) { .exhaustive-demo .ex-replay { grid-template-columns: 140px 1fr; gap: 10px; } .exhaustive-demo .ex-replay img { width: 140px; height: 140px; } }
`;

export function ExhaustiveDemo() {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const complete = elapsed >= DURATION;
  const checked = Math.min(
    data.states.length,
    Math.floor((elapsed / SCAN_MS) * data.states.length),
  );
  const tick = Math.min(
    data.frames.length - 1,
    Math.max(0, Math.floor((elapsed - SCAN_MS) / TICK_MS)),
  );
  const frame = data.frames[tick];
  const diverged = tick >= data.divergenceTick;

  useEffect(() => {
    if (!playing || complete) return;
    let previous = performance.now();
    let handle: number;
    const advance = (now: number) => {
      const delta = now - previous;
      previous = now;
      setElapsed((current) => Math.min(DURATION, current + delta));
      handle = requestAnimationFrame(advance);
    };
    handle = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(handle);
  }, [playing, complete]);

  const x = (position: number) => 240 + position * 3;
  return (
    <main className="exhaustive-demo">
      <style>{styles}</style>
      <div className="ex-top">
        <a className="ex-kicker" href="/">
          MOTION TRANSFER / VERIFICATION
        </a>
        <span className="ex-tag">RECORDED EVIDENCE · $0 MODEL COST</span>
      </div>
      <h1>Every reachable dash transition.</h1>
      <p className="ex-description">
        Four accepted controllers match the compiled binary on every reachable dash state and button
        combination: 275 states, 17,600 transitions.
      </p>
      <p className="ex-caption">
        Human-chosen fields, checked empirically. Default configuration and body width 8 only.
        Combat excluded. Float behavior beyond tested positions is unverified.
      </p>
      <div className="ex-controls">
        <button
          type="button"
          onClick={() => {
            if (complete) setElapsed(0);
            setPlaying(!playing || complete);
          }}
        >
          {playing && !complete ? 'Pause replay' : 'Play evidence replay'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setElapsed(DURATION);
          }}
        >
          Show result
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setElapsed(0);
          }}
        >
          Reset
        </button>
        <span>Animation replays saved measurements; no model call.</span>
      </div>
      <div className="ex-columns">
        <section className="ex-panel" aria-labelledby="ex-state-title">
          <div className="ex-panel-header">
            <h2 id="ex-state-title">Reachable state space</h2>
            <span className="ex-counter" data-testid="state-count">
              {checked} / {data.states.length}
            </span>
          </div>
          <div
            className="ex-grid"
            role="img"
            aria-label={`${checked} of 275 states checked; 64 button combinations per state`}
          >
            {data.states.map((state, index) => (
              <span
                key={state.key}
                className={
                  'ex-cell' +
                  (index < checked ? ' checked' : '') +
                  (diverged && state.key === failureState ? ' failed' : '')
                }
                title={`remaining ${state.remaining}, cooldown ${state.cooldown}, direction ${state.direction.x}, ${state.direction.y}`}
              />
            ))}
          </div>
          <div className="ex-legend">
            <span>
              <i className="ex-dot" />
              64 transitions match
            </span>
            <span>
              <i className="ex-dot bad" />
              Historical candidate fails here
            </span>
          </div>
          <div className="ex-coverage">
            <div className="ex-label">
              <span>52 sampled cases</span>
              <span>1,878 / 17,600 · 10.7%</span>
            </div>
            <div className="ex-bar">
              <span style={{ width: '10.7%', background: '#8a9eaa' }} />
            </div>
            <div className="ex-label">
              <span>Exhaustive search</span>
              <span>
                {format(checked * 64)} / {format(data.transitions)}
              </span>
            </div>
            <div className="ex-bar">
              <span style={{ width: `${(checked / data.states.length) * 100}%` }} />
            </div>
            <p className="ex-caption">
              548 alternate states · 6 gameplay contexts · 0 abstraction conflicts
            </p>
          </div>
        </section>
        <section className="ex-panel" aria-labelledby="ex-counterexample-title">
          <div className="ex-panel-header">
            <h2 id="ex-counterexample-title">One wrong assumption. Eleven ticks.</h2>
            <span className="ex-counter">TICK {String(tick).padStart(2, '0')}</span>
          </div>
          <div className="ex-replay">
            <div>
              <img
                src={frame.png}
                alt={`Actual Dashy Dango framebuffer at gameplay tick ${tick}`}
                width="160"
                height="160"
              />
              <div className="ex-caption">Compiled cartridge · recorded frame</div>
            </div>
            <div>
              <div className="ex-kicker">INPUT</div>
              <div className="ex-input">
                {frame.buttons === 16 ? '← LEFT' : frame.buttons === 1 ? 'X DASH' : '— IDLE'}
              </div>
              <div className="ex-readout">
                <span>Binary x {frame.donor.x.toFixed(1)}</span>
                <span>Candidate x {frame.candidate.x.toFixed(1)}</span>
              </div>
            </div>
          </div>
          <svg
            className="ex-track"
            viewBox="0 0 480 85"
            role="img"
            aria-label="Measured world positions of the binary and historical candidate"
          >
            <line x1="25" x2="455" y1="42" y2="42" stroke="#30443e" />
            <line x1="240" x2="240" y1="12" y2="70" stroke="#50645b" strokeDasharray="3 4" />
            <text x="240" y="80" fill="#9dafaa" fontSize="10" textAnchor="middle">
              start
            </text>
            <circle cx={x(frame.donor.x)} cy="29" r="7" fill="#83e4af" />
            <circle cx={x(frame.candidate.x)} cy="56" r="7" fill="#ff8b86" />
            <text x="12" y="18" fill="#83e4af" fontSize="10">
              BINARY
            </text>
            <text x="12" y="76" fill="#ff8b86" fontSize="10">
              CANDIDATE
            </text>
          </svg>
          <div
            className={'ex-verdict' + (diverged ? ' diverged' : '')}
            data-testid="counterexample-verdict"
          >
            {diverged
              ? 'Tick 11: the binary dashes right. The candidate incorrectly reuses the last walking direction and dashes left.'
              : 'Nine idle ticks, one tick walking left, then a dash with no direction. Both receive exactly the same inputs.'}
          </div>
        </section>
      </div>
      <label className="ex-timeline">
        Scrub replay
        <input
          type="range"
          min="0"
          max={DURATION}
          step="40"
          value={elapsed}
          onChange={(event) => {
            setPlaying(false);
            setElapsed(Number(event.target.value));
          }}
        />
        {Math.round((elapsed / DURATION) * 100)}%
      </label>
      <footer className="ex-limits">
        <strong>Scope of the measured claim</strong>
        <ul>
          {data.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </footer>
    </main>
  );
}
