import story from '../../../assets/evidence/recovery.json';
import { MetaChip } from './meta-chip';
import { PixelSprite } from './pixel-sprite';

const seconds = (Date.parse(story.finishedAt) - Date.parse(story.startedAt)) / 1000;
const duration = `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
const pair = (position: { x: number; y: number }) =>
  `(${position.x.toFixed(2)}, ${position.y.toFixed(2)})`;

type Attempt = (typeof story.attempts)[number];

/** What the grader found, stated from the recorded frame where each candidate first went wrong. */
function difference({ firstFailure: failure }: Attempt) {
  if (!failure) return null;
  const timers = 'timers' in failure.expected && 'timers' in failure.actual;
  if (timers && failure.expected.timers?.cooldown !== failure.actual.timers?.cooldown)
    return {
      label: 'Cooldown timer',
      cartridge: String(failure.expected.timers?.cooldown),
      candidate: String(failure.actual.timers?.cooldown),
      lesson: 'It assumed the dash starts ready. The real game makes you wait.',
    };
  return {
    label: 'Position',
    cartridge: pair(failure.expected.position),
    candidate: pair(failure.actual.position),
    lesson: 'It moved diagonals at full speed. The real game normalizes them.',
  };
}

/** Muse Wonder's real attempts at recovering the dash, replayed from the saved run. */
export function RecoveryPanel() {
  return (
    <section className="recovery" id="recovery" aria-labelledby="recovery-title">
      <header className="recovery__header">
        <p className="eyebrow">RECORDED RUN · NO MODEL REQUEST</p>
        <h2 id="recovery-title">Watch Wonder earn the dash</h2>
        <MetaChip model="wonder">{story.model}</MetaChip>
      </header>
      <p className="recovery__intro">
        Muse Wonder got a compiled cartridge and no source. It wrote a controller, and a grader
        replayed the real game frame by frame to show it where it was wrong. These are the actual
        attempts, including the failures.
      </p>
      <ol className="recovery__attempts">
        {story.attempts.map((attempt) => {
          const passed = attempt.passed === attempt.total;
          const failure = difference(attempt);
          return (
            <li
              key={attempt.candidateId}
              className={'recovery__attempt ' + (passed ? 'is-passed' : 'is-failed')}
            >
              <p className="recovery__label">
                <PixelSprite
                  name="wonder"
                  size={36}
                  mood={passed ? 'victory' : 'droop'}
                  still={!passed}
                />
                Attempt {attempt.attempt}
              </p>
              <p className="recovery__score">
                {attempt.passed}/{attempt.total}
              </p>
              {failure && attempt.firstFailure ? (
                <>
                  <p className="recovery__where">
                    Diverged on <code>{attempt.firstFailure.trace}</code> at frame{' '}
                    {attempt.firstFailure.tick}
                  </p>
                  <dl className="recovery__compare">
                    <div>
                      <dt>{failure.label} · real cartridge</dt>
                      <dd>{failure.cartridge}</dd>
                    </div>
                    <div className="is-wrong">
                      <dt>{failure.label} · candidate</dt>
                      <dd>{failure.candidate}</dd>
                    </div>
                  </dl>
                  <p className="recovery__lesson">{failure.lesson}</p>
                </>
              ) : (
                <>
                  <p className="recovery__where">Every development trace matched</p>
                  <dl className="recovery__compare">
                    <div>
                      <dt>Unseen exam after freezing</dt>
                      <dd>
                        {attempt.acceptance?.passed}/{attempt.acceptance?.total}
                      </dd>
                    </div>
                  </dl>
                  <p className="recovery__lesson">Frozen. This is the dash in every game here.</p>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <p className="recovery__foot">
        {story.requests} Meta requests · {duration} · ${story.estimatedCostUsd.toFixed(2)} estimated
        · failures kept on record
      </p>
    </section>
  );
}
