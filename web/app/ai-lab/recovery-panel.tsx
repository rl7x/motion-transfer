import story from '../../../assets/evidence/recovery.json';
import repeats from '../../../assets/evidence/wonder-repeat.json';
import { MetaChip } from './meta-chip';
import { PixelSprite } from './pixel-sprite';

const seconds = (Date.parse(story.finishedAt) - Date.parse(story.startedAt)) / 1000;
const duration = `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
const pair = (position: { x: number; y: number }) =>
  `(${position.x.toFixed(2)}, ${position.y.toFixed(2)})`;

const SESSION_RESULT = { accepted: 'ACCEPTED', rejected: 'REJECTED', 'not-run': 'NOT RUN' };

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
        attempts from the session that succeeded, including the failures.
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
      <div className="recovery__repeats">
        <h3>Then we ran it again</h3>
        <p className="recovery__intro">
          With the rules committed first, Wonder got the same test in fresh sessions. So far{' '}
          {repeats.acceptedSessions} of {repeats.fullSessions} full sessions has produced an
          accepted dash, so recovery works but isn&apos;t reliable yet. The exam did its job: one
          candidate matched every development trace, then failed most of the unseen checks and was
          rejected.
        </p>
        <ul className="recovery__sessions">
          {repeats.sessions.map((session) => (
            <li key={session.label} className={'recovery__session is-' + session.status}>
              <p className="recovery__top">
                <strong>{session.label}</strong>
                <span>{SESSION_RESULT[session.status as keyof typeof SESSION_RESULT]}</span>
              </p>
              {session.bestDevelopment ? (
                <p className="recovery__stats">
                  Development {session.bestDevelopment.passed}/{session.bestDevelopment.total} ·
                  Unseen exam{' '}
                  {session.acceptance
                    ? `${session.acceptance.passed}/${session.acceptance.total}`
                    : 'not reached'}{' '}
                  · ${session.estimatedCostUsd?.toFixed(2)}
                </p>
              ) : (
                <p className="recovery__stats">
                  Not run: ${repeats.remainingUsd.toFixed(2)} left, below the $6 each trial reserves
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
