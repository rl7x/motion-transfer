import { useState } from 'react';
import results from '../../../assets/evidence/auto-port.json';
import openResults from '../../../assets/evidence/open-port.json';
import { MetaChip } from './meta-chip';
import type { SavedGame } from './saved-game-player';

const NAMES: Record<string, string> = {
  'blink-scope': 'BLINK SCOPE',
  'draft-line': 'DRAFT LINE',
  'head-rush': 'HEAD RUSH',
  overturn: 'OVERTURN',
  pileup: 'PILEUP',
  skyhaul: 'SKYHAUL',
  'twin-vector': 'TWIN VECTOR',
  undertow: 'UNDERTOW',
  wreckfall: 'WRECKFALL',
  'zig-saber': 'ZIG SABER',
};
const ASPECT: Record<string, number> = {
  'blink-scope': 1,
  'draft-line': 320 / 224,
  'head-rush': 240 / 272,
  pileup: 504 / 464,
  skyhaul: 4 / 3,
  undertow: 4 / 3,
  wreckfall: 224 / 256,
  'zig-saber': 256 / 224,
};
const NOTES: Record<string, string> = {
  'blink-scope':
    'This game steps its simulation at 120 Hz in the browser, so the dash plays at double speed there.',
};

interface Attempt {
  attempt: number;
  message: string | null;
  summary: string | null;
  unitsPerSourcePixel: number | null;
  patches: { anchor: string; replacement: string }[];
  inputTokens: number;
  outputTokens: number | null;
  estimatedCostUsd: number;
  wallMs: number;
  checks: { name: string; passed: boolean; error?: string }[];
  measurements: { expected?: number; measured?: number };
}
interface Game {
  id: string;
  status: string;
  reason?: string;
  failure?: string | null;
  dashKey?: string;
  estimatedCostUsd?: number;
  wallMs?: number;
  attempts?: Attempt[];
}

const games = results.games as Game[];
const eligible = games.filter((game) => game.status !== 'excluded');
const passed = games.filter((game) => game.status === 'passed');
const name = (id: string) => NAMES[id] ?? id;
const keyName = (code = 'KeyC') => code.replace('Key', '');
const totalCost = eligible.reduce((sum, game) => sum + (game.estimatedCostUsd ?? 0), 0);
const openEligible = openResults.games.filter((game) => game.status !== 'excluded');
const openPassed = openEligible.filter((game) => game.status === 'passed');
const openCost = openEligible.reduce((sum, game) => sum + (game.estimatedCostUsd ?? 0), 0);

/** Before and after frames for a port, played sandboxed like every other generated page. */
export function portedPlayers(): SavedGame[] {
  return passed.map((game) => ({
    id: 'ported-' + game.id,
    name: name(game.id),
    credit: 'by Kenta Cho / ABA Games · ported by Muse Spark',
    aspect: ASPECT[game.id] ?? 4 / 3,
    frames: [
      {
        kind: 'before',
        title: name(game.id),
        src: `/ported/${game.id}/before/index.html`,
        sameOrigin: false,
        controls: [],
      },
      {
        kind: 'after',
        title: `${name(game.id)} + dash`,
        src: `/ported/${game.id}/after/index.html`,
        sameOrigin: false,
        controls: [{ action: 'dash', label: 'Hold to dash', kbd: keyName(game.dashKey) }],
      },
    ],
    keeps: 'Its own rules and scoring. With no dash, its bot replays identically.',
    carries: 'The recovered burst and recharge, connected by patches Muse Spark wrote.',
    help: `Click a game to focus it, then use its own controls. Hold ${keyName(game.dashKey)} to dash in the right-hand game. ${NOTES[game.id] ?? ''}`,
    idleLabel: 'START THE GAME · THEN DASH',
    readyLabel: `DASH READY · HOLD ${keyName(game.dashKey)}`,
  }));
}

export const portedCount = passed.length;
export const eligibleCount = eligible.length;

function Patches({ attempt }: { attempt: Attempt }) {
  return (
    <div className="ported__patches">
      {attempt.patches.map((patch, index) => (
        <figure className="code" key={index}>
          <figcaption>Patch {index + 1} · written by Muse Spark</figcaption>
          <pre>
            <code>{patch.replacement}</code>
          </pre>
        </figure>
      ))}
    </div>
  );
}

function Card({ game, onPlay }: { game: Game; onPlay(id: string): void }) {
  const [open, setOpen] = useState(false);
  const last = game.attempts?.[game.attempts.length - 1];
  const checks = last?.checks ?? [];
  const isPassed = game.status === 'passed';
  const label = isPassed ? 'PORTED' : game.status === 'excluded' ? 'NOT ELIGIBLE' : 'FAILED';
  return (
    <li className={'ported__card is-' + game.status}>
      <p className="ported__top">
        <strong>{name(game.id)}</strong>
        <span>{label}</span>
      </p>
      {game.status === 'excluded' ? <p className="ported__text">{game.reason}</p> : null}
      {last?.summary ? <p className="ported__text">{last.summary}</p> : null}
      {game.status === 'failed' ? (
        <p className="ported__failure">Rejected by: {game.failure}</p>
      ) : null}
      {last ? (
        <p className="ported__stats">
          {checks.filter((check) => check.passed).length}/{checks.length} checks
          {last.attempt > 1 ? ' · passed on repair' : ''} · {((game.wallMs ?? 0) / 1000).toFixed(0)}{' '}
          s · ${(game.estimatedCostUsd ?? 0).toFixed(3)}
        </p>
      ) : null}
      {last ? (
        <p className="ported__actions">
          {isPassed ? (
            <button
              className="btn btn--primary btn--small"
              aria-label={`Play ${name(game.id)}`}
              onClick={() => onPlay('ported-' + game.id)}
            >
              ▶ Play
            </button>
          ) : null}
          <button
            className="btn btn--ghost btn--small"
            aria-expanded={open}
            aria-label={`What Spark wrote for ${name(game.id)}`}
            onClick={() => setOpen((value) => !value)}
          >
            What Spark wrote
          </button>
        </p>
      ) : null}
      {open && last ? <Patches attempt={last} /> : null}
    </li>
  );
}

/** Every game in the frozen campaign, including failures and exclusions. */
export function PortedGames({ onPlay }: { onPlay(id: string): void }) {
  return (
    <section className="ported" id="ported" aria-labelledby="ported-title">
      <header className="ported__header">
        <p className="eyebrow">FROZEN CAMPAIGN · EVERY GAME REPORTED</p>
        <h2 id="ported-title">
          Muse Spark ported the dash into {passed.length} of {eligible.length} games it had never
          seen
        </h2>
        <MetaChip>{results.model}</MetaChip>
      </header>
      <p className="ported__intro">
        Spark received one game&apos;s source at a time and wrote the patches itself. Hand-written
        checks, frozen before the first request, then ran in an isolated worker: the game&apos;s own
        bot had to replay identically, its own tests had to pass, the dash had to measure correctly,
        and it had to fire in a real browser.
      </p>
      <ul className="ported__grid">
        {games.map((game) => (
          <Card key={game.id} game={game} onPlay={onPlay} />
        ))}
      </ul>
      <p className="ported__foot">
        ${totalCost.toFixed(2)} estimated across the campaign · games by Kenta Cho / ABA Games (MIT)
      </p>
      <p className="ported__foot">
        Same games, same frozen checks, open weights: <MetaChip model="open" /> passed{' '}
        {openPassed.length} of {openEligible.length} for ${openCost.toFixed(2)}, served on Baseten.
      </p>
    </section>
  );
}
