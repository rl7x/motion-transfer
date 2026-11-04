import summary from '../../../assets/evidence/footage-summary.json';
import contract from '../../../assets/components/dashy-dango-dash/contract.json';
import { linkHref } from '../links';
import { MetaChip } from './meta-chip';

const truth = contract.defaults;

const scores = [
  { label: 'Pictures, plus four timing numbers we gave it', score: '0/40' },
  { label: 'Footage, loose checks', score: `${summary.looseChecks}/40` },
  { label: 'Footage, exact timing: 6 sessions', score: summary.exactChecks.join(', ') },
  {
    label: `Footage, final checks: ${summary.sessions} sessions`,
    score: `${summary.finalChecks.join(', ')}, ${summary.refused} refused`,
    isNew: true,
  },
  { label: 'The compiled game itself', score: '40/40' },
];

const measured = [
  { label: 'Walking speed', footage: summary.measured.walkingSpeed, real: truth.walkingSpeed },
  { label: 'Dash length, ticks', footage: summary.measured.dashTicks, real: summary.realDashTicks },
  {
    label: 'Dash distance, pixels',
    footage: summary.measured.dashDistance,
    real: truth.dashDistance,
  },
  {
    label: 'Shortest repeat, ticks',
    footage: summary.measured.repeatGap,
    real: truth.cooldownTicks + summary.realDashTicks,
  },
  {
    label: 'First dash, ticks after play starts',
    footage: summary.measured.firstDash,
    real: truth.initialCooldownTicks,
  },
];

/** Recovery from a clip, with no binary. A saved run, shown beside the same exam the binary passed. */
export function FootagePanel({ playback }: { playback: boolean }) {
  return (
    <section className="footage" id="footage" aria-labelledby="footage-title">
      <header className="footage__header">
        <p className="eyebrow">RECORDED RUN · NO MODEL REQUEST</p>
        <h2 id="footage-title">Recover a move from footage alone</h2>
        <MetaChip model="sam" />
        <MetaChip model="open">open weights, on Baseten</MetaChip>
      </header>
      <p className="footage__intro">
        No source, no binary and no record of the buttons. The camera follows the player, so the
        player barely moves on screen. SAM 3.1 tracks the scenery instead, and the player&apos;s
        motion is the opposite of how the world moves. Muse Spark Open then writes a controller from
        those numbers alone.
      </p>
      <div className="footage__body">
        {playback ? null : (
          <figure className="footage__clip">
            <video
              src={linkHref('/media/footage-tracking.mp4')}
              aria-label="Dashy Dango gameplay with SAM 3.1 tracking boxes on the scenery and player"
              autoPlay
              muted
              loop
              playsInline
            />
            <figcaption>SAM 3.1&apos;s real tracking boxes, from a calibration clip.</figcaption>
          </figure>
        )}
        <div>
          <h3 className="footage__subhead">The same 40-trace exam the binary passed</h3>
          <table className="footage__table">
            <thead>
              <tr>
                <th scope="col">What the model had</th>
                <th scope="col">Exam</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((row) => (
                <tr key={row.label} className={row.isNew ? 'is-new' : undefined}>
                  <td>{row.label}</td>
                  <td className="footage__score">{row.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="footage__subhead">What the footage showed</h3>
          <table className="footage__table">
            <thead>
              <tr>
                <th scope="col">Measured</th>
                <th scope="col">From footage</th>
                <th scope="col">Real game</th>
              </tr>
            </thead>
            <tbody>
              {measured.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="footage__score">{row.footage}</td>
                  <td className="footage__score">{row.real}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="footage__note">
        With the final checks, every controller the tool accepted scored 40/40, and it refused the
        other {summary.refused} sessions instead of guessing. That matters because a real clip has
        no exam to catch a wrong answer. Six sessions is a small sample, and the rules changed
        between rows, so each row stands alone.
      </p>
      <p className="footage__note">
        Tracking worst case: {summary.worstError} pixels across {summary.framesCompared} frames, and
        it kept only the bursts it saw whole, {summary.burstsFound} of {summary.burstsReal}. One
        clip of one game, chosen to show the timing, and the first run failed outright:{' '}
        {summary.firstRun} This is a footage match. It shows how a move travels, not everything a
        game does, and it only works on games you have the right to use.
      </p>
    </section>
  );
}
