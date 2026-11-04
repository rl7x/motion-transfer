import footage from '../../../assets/evidence/footage-summary.json';
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Afterimage, useDashPulse } from './afterimage';
import { MetaChip } from './meta-chip';
import { PixelSprite } from './pixel-sprite';
import { eligibleCount, portedCount } from './ported-games';
import { Starfield } from './starfield';

export const REPO_URL = 'https://github.com/rl7x/meta-ai-developer-hackathon';
/** Set to an embeddable video address to show the demo button. */
export const DEMO_VIDEO_URL = '';

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TopBar({ playback }: { playback: boolean }) {
  return (
    <nav className="topbar" aria-label="Sections">
      <a className="topbar__mark" href="#top">
        motion<span>/</span>transfer
      </a>
      <span className="topbar__links">
        <a href="#stage">Play</a>
        <a href="#motion-creation">{playback ? 'Create' : 'Remix'}</a>
        <a href="#library">Library</a>
        <a href="#how">How it works</a>
      </span>
      <a className="btn btn--small btn--ghost" href={REPO_URL} target="_blank" rel="noreferrer">
        GitHub ↗
      </a>
    </nav>
  );
}

/** The dango courier dashes between the hero's edges; clicking it dashes now. */
function Courier() {
  const [state, setState] = useState({ side: 'left', facing: 'right' });
  const dash = useCallback(
    () =>
      setState((value) =>
        value.side === 'left'
          ? { side: 'right', facing: 'right' }
          : { side: 'left', facing: 'left' },
      ),
    [],
  );
  useEffect(() => {
    if (reducedMotion()) return;
    const timer = setInterval(dash, 3400);
    return () => clearInterval(timer);
  }, [dash]);
  const tints = ['#36e2ff', '#ff3dbe', '#36e2ff', '#ff3dbe'];
  return (
    <div
      className={`courier-track courier-track--${state.side} courier-track--face-${state.facing}`}
    >
      {tints.map((tint, index) => (
        <span
          key={index}
          className="courier courier--ghost"
          aria-hidden="true"
          style={{ '--i': index + 1 } as CSSProperties}
        >
          <PixelSprite name="courier" size={96} tint={tint} still />
        </span>
      ))}
      <button className="courier courier--body" type="button" onClick={dash}>
        <PixelSprite name="courier" size={96} title="The dango courier. Click to dash." />
      </button>
    </div>
  );
}

export function Hero({ playback, savedCount }: { playback: boolean; savedCount: number | null }) {
  const [pulse, trigger] = useDashPulse();
  useEffect(() => {
    const timer = setTimeout(trigger, 450);
    return () => clearTimeout(timer);
  }, [trigger]);
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <Starfield />
      <div className="hero__inner">
        <p className="eyebrow">BUILT ON META’S MUSE MODELS · META MODEL API</p>
        <h1 id="hero-title" className="hero__wordmark" onClick={trigger}>
          <span className="hero__word">motion</span>{' '}
          <Afterimage pulse={pulse} trail className="hero__word hero__word--dash">
            transfer
          </Afterimage>
        </h1>
        <p className="hero__tagline">
          <strong>Love how a move feels in one game? Put it in yours.</strong> Meta&apos;s models
          recover a move from a compiled game or a gameplay clip and port it into new games, and
          every result is checked. Every game here is openly licensed and credited.
        </p>
        <div className="hero__actions">
          <a className="btn btn--primary btn--large" href="#stage">
            ▶ Play the transfer
          </a>
          <a
            className="btn btn--light btn--large"
            href={playback ? '#library' : '#motion-creation'}
          >
            {playback ? 'Browse the library' : '⚡ Remix with Muse Spark'}
          </a>
          {DEMO_VIDEO_URL ? (
            <a
              className="btn btn--ghost btn--large"
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noreferrer"
            >
              Watch the demo
            </a>
          ) : null}
        </div>
        <ul className="hero__models" aria-label="Meta models in this project">
          <li>
            <MetaChip model="wonder">recovered the dash from compiled WebAssembly</MetaChip>
          </li>
          <li>
            <MetaChip>writes and repairs each PARALLAXIA adapter, live</MetaChip>
          </li>
          <li>
            <MetaChip model="sam">tracked the move through gameplay footage</MetaChip>
          </li>
          <li>
            <MetaChip model="open">rebuilt it from that footage, with no binary</MetaChip>
          </li>
        </ul>
        <dl className="hero__stats">
          <div>
            <dt>perfect footage runs</dt>
            <dd>
              {footage.finalChecks.length} of {footage.sessions}
            </dd>
          </div>
          <div>
            <dt>unseen games ported</dt>
            <dd>
              {portedCount} of {eligibleCount}
            </dd>
          </div>
          <div>
            <dt>prompt → playable</dt>
            <dd>~27 s</dd>
          </div>
          <div>
            <dt>per remix</dt>
            <dd>$0.0076</dd>
          </div>
          <div>
            <dt>named checks per version</dt>
            <dd>16</dd>
          </div>
          <div>
            <dt>saved in the library</dt>
            <dd>{savedCount === null ? '—' : savedCount + 1}</dd>
          </div>
        </dl>
        <p className="hero__footnote">
          The time is one timed run on this site. The cost is from the measured task campaign. Both
          use Standard Muse Spark on the Meta Model API.
        </p>
      </div>
      <Courier />
    </section>
  );
}
