import { useEffect, useRef, useState } from 'react';
import { linkHref } from './links';

export interface Checkpoint {
  tick: number;
  stateDigest: string;
  [key: string]: unknown;
}
interface Branch {
  succeeded: boolean;
  lostLife: boolean;
  reachedTick: number | null;
  endDigest: string;
  frames: { tick: number; x: number; y: number }[];
}
export interface ExperimentReceipt {
  checkpoint: Checkpoint;
  scenario: {
    target: { minX: number; maxX: number; minY: number; maxY: number };
    horizonTicks: number;
  };
  original: Branch;
  candidate: Branch;
  satisfied: boolean;
  interventionTick: number;
  firstDifferenceTick: number | null;
}

export function CheckpointGoals({
  checkpoint,
  capture,
  resume,
  onFreeze,
}: {
  checkpoint: Checkpoint | null;
  capture(curated: boolean): void;
  resume(): void;
  onFreeze(experiment: unknown): void;
}) {
  const [goal, setGoal] = useState('right');
  const [frozen, setFrozen] = useState(false);
  return (
    <section className="destination-section" aria-label="Checkpoint experiment">
      <h2>Pause and compare alternatives</h2>
      <p>
        Use your current native flight, or a curated seed-7 checkpoint at tick 40. Experiments
        replay at 60 Hz for two seconds with the same native controls: hold Shoot, no directional
        input. The original makes no dash; Meta may propose one dash tick and a supported mapping.
      </p>
      <div className="toolbar">
        <button
          id="motion-capture"
          onClick={() => {
            setFrozen(false);
            onFreeze(null);
            capture(false);
          }}
        >
          Pause and experiment
        </button>
        <button
          id="motion-curated"
          onClick={() => {
            setFrozen(false);
            onFreeze(null);
            capture(true);
          }}
        >
          Use curated checkpoint · tick 40
        </button>
        <button onClick={resume}>Resume original</button>
      </div>
      {checkpoint && (
        <>
          <p id="checkpoint-status">
            Checkpoint tick {checkpoint.tick} · replay reconstruction required before any model
            request.
          </p>
          <label>
            Fixed target{' '}
            <select
              id="motion-goal"
              value={goal}
              disabled={frozen}
              onChange={(event) => setGoal(event.target.value)}
            >
              <option value="right">Right region · X 5.5 to 6.5, Y −11 to −7</option>
              <option value="left">Left region · X −6.5 to −5.5, Y −11 to −7</option>
              <option value="infeasible">
                Infeasible test · X 100 to 101, outside the playfield
              </option>
            </select>
          </label>
          <p>
            Require the ship to enter the target, stay alive, and lose no life. Preserve native
            movement and enemy rules; add no invulnerability. A failed goal keeps the original.
          </p>
          <button
            id="motion-freeze"
            onClick={() => {
              if (frozen) {
                setFrozen(false);
                onFreeze(null);
                return;
              }
              const target = {
                minX: goal === 'right' ? 5.5 : goal === 'left' ? -6.5 : 100,
                maxX: goal === 'right' ? 6.5 : goal === 'left' ? -5.5 : 101,
                minY: -11,
                maxY: -7,
              };
              onFreeze({
                checkpoint,
                scenario: {
                  target,
                  horizonTicks: 120,
                  nativeControls: [[16, 120]],
                  collisionPolicy: 'native',
                  noAddedInvulnerability: true,
                  preserveEnemyRules: true,
                  preserveNativeMovement: true,
                  allowedChanges: ['unitScale', 'activation', 'direction', 'dashTick'],
                },
              });
              setFrozen(true);
            }}
          >
            {frozen
              ? 'Edit goal before a new request'
              : 'Freeze this checkpoint, target and constraints'}
          </button>
          {frozen && (
            <p role="status">
              Goal frozen. Use the request panel below to generate an alternative for this
              experiment.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ReplayFrame({
  play,
  branch,
  receipt,
}: {
  play: string;
  branch: 'original' | 'candidate';
  receipt: ExperimentReceipt;
}) {
  const [channel] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState('Reconstructing the checkpoint…');
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel ||
        event.data.type !== 'parallaxia-replay-result'
      )
        return;
      setStatus(
        event.data.error
          ? 'Replay rejected: ' + String(event.data.error)
          : 'Reproduced worker end-state digest',
      );
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);
  return (
    <article>
      <h4>{branch === 'original' ? 'Original · no dash' : 'Candidate · changed dash input'}</h4>
      <iframe
        ref={frame}
        title={'Experiment ' + branch}
        src={linkHref(play + '#channel=' + channel)}
        sandbox="allow-scripts"
        onLoad={() => {
          setStatus('Replaying at 60 Hz…');
          frame.current?.contentWindow?.postMessage(
            { type: 'parallaxia-replay', channel, receipt, branch },
            '*',
          );
        }}
      />
      <p role="status">{status}</p>
    </article>
  );
}

export function ExperimentResults({
  receipt,
  parentPlay,
  candidatePlay,
  download,
}: {
  receipt: ExperimentReceipt;
  parentPlay: string;
  candidatePlay: string;
  download: string;
}) {
  const [replay, setReplay] = useState(0);
  return (
    <section className="experiment-result" aria-label="Verified experiment comparison">
      <h3>
        {receipt.satisfied
          ? 'Candidate reached the fixed goal'
          : 'Goal unsatisfied · original retained'}
      </h3>
      <p>
        Same reconstructed starting state and native controls. Candidate dash intervention: tick{' '}
        {receipt.interventionTick}. First movement/life difference:{' '}
        {receipt.firstDifferenceTick ?? 'none'}. Target and constraints stayed fixed.
      </p>
      <table>
        <thead>
          <tr>
            <th>Branch</th>
            <th>Entered target</th>
            <th>Lost a life</th>
            <th>Goal</th>
          </tr>
        </thead>
        <tbody>
          {(['original', 'candidate'] as const).map((branch) => (
            <tr key={branch}>
              <td>{branch}</td>
              <td>{receipt[branch].reachedTick ?? 'never'}</td>
              <td>{receipt[branch].lostLife ? 'yes' : 'no'}</td>
              <td>{receipt[branch].succeeded ? 'satisfied' : 'unsatisfied'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button id="motion-compare" onClick={() => setReplay((value) => value + 1)}>
        Replay both branches at normal speed
      </button>
      <p>
        <a href={linkHref(download)} download>
          Download the exact checkpoint, inputs and observed outcomes
        </a>
      </p>
      {replay > 0 && (
        <div className="experiment-comparison" key={replay}>
          <ReplayFrame play={parentPlay} branch="original" receipt={receipt} />
          <ReplayFrame play={candidatePlay} branch="candidate" receipt={receipt} />
        </div>
      )}
    </section>
  );
}
