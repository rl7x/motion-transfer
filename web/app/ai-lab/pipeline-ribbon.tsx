import { MetaChip } from './meta-chip';
import { PixelSprite } from './pixel-sprite';
import type { SpriteName } from './pixel-sprite';

const STATIONS: {
  step: string;
  title: string;
  sprites: SpriteName[];
  model?: 'spark' | 'wonder';
  body: string;
  proof: string;
}[] = [
  {
    step: '01',
    title: 'Recover',
    sprites: ['wonder'],
    model: 'wonder',
    body: 'Read Dashy Dango’s compiled WebAssembly and measured traces, then wrote a standalone dash controller that runs without the donor binary.',
    proof: '20/20 unseen checks · 2 of 3 sessions on the latest harness',
  },
  {
    step: '02',
    title: 'Adapt',
    sprites: ['spark'],
    model: 'spark',
    body: 'Turns your sentence into a TypeScript adapter for the destination game: distance, direction, activation, a dash-end combo or a solved moment.',
    proof: 'One tool call · repairs from verifier feedback',
  },
  {
    step: '03',
    title: 'Verify',
    sprites: ['sandbox', 'verifier'],
    body: 'An isolated worker with no credentials runs the native simulation, swept bullet collisions and the exact canvas frame before anything is published.',
    proof: '13 native + 3 browser checks',
  },
  {
    step: '04',
    title: 'Play & keep',
    sprites: ['librarian'],
    body: 'Every checked version lands in the library. Anyone can open it, play it and download it again without a new model request.',
    proof: 'Failures and repairs stay on record',
  },
];

export function PipelineRibbon({ onPlayDonor }: { onPlayDonor?(): void }) {
  return (
    <section className="ribbon" id="how" aria-labelledby="how-title">
      <div className="ribbon__intro">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2 id="how-title">One move, recovered from a compiled game and carried into new ones.</h2>
        <p>
          The feel you want often lives in a compiled build, not in code you can read. Motion
          Transfer recovers one behavior from a compiled cartridge and makes it playable in other
          games, without rebuilding it by hand.
        </p>
      </div>
      <ol className="ribbon__stations">
        {STATIONS.map((station) => (
          <li key={station.step} className="ribbon__station">
            <span className="ribbon__sprites">
              {station.sprites.map((sprite) => (
                <PixelSprite key={sprite} name={sprite} size={52} />
              ))}
            </span>
            <span className="ribbon__step">{station.step}</span>
            <h3>{station.title}</h3>
            {station.model ? <MetaChip model={station.model} /> : null}
            <p>{station.body}</p>
            <p className="ribbon__proof">{station.proof}</p>
            {station.step === '01' && onPlayDonor ? (
              <button type="button" className="btn btn--ghost btn--small" onClick={onPlayDonor}>
                ▶ Play the original game
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="ribbon__note">
        Hooks into each game are written by hand. Meta generates the recovered controller, the
        PARALLAXIA adapters and the bounded host rule; the destination keeps its own enemies, shots
        and collisions.
      </p>
      <div className="ribbon__purpose">
        <h3>What this is for</h3>
        <ul>
          <li>Use your own game, an openly licensed one, or one you have permission to work on.</li>
          <li>It recovers how a move travels. It doesn&apos;t copy art, sound or original code.</li>
          <li>Credit the source. Every game on this site keeps its upstream notice.</li>
        </ul>
      </div>
    </section>
  );
}
