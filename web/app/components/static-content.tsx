import { readGenerationMode, readJujumpComparison, readRecovery } from '../data-source';
import { useResource } from '../hooks/use-resource';
import { linkHref } from '../links';
import { useTransfer } from '../transfer-context';
interface Measurements {
  measurements: { traceCount: number; updates: number; maxPositionError: number };
}
function LiveRecoveryVerdict() {
  const { data, error } = useResource<Measurements>('/api/developer-task');
  const m = data?.measurements;
  return (
    <p id="recovery-verdict">
      {m
        ? `Saved verification: ${m.traceCount} motion traces, ${m.updates.toLocaleString()} logical updates, maximum measured position error ${m.maxPositionError} source pixels. These finite checks used the default configuration and body width 8.`
        : (error ?? 'Loading saved recovery results…')}
    </p>
  );
}
function RecoveryVerdict() {
  if (readGenerationMode() === 'playback-only') {
    return (
      <p id="recovery-verdict">
        Playback uses the bundled source, report, and notices for this component.
      </p>
    );
  }
  return <LiveRecoveryVerdict />;
}
export function Header() {
  return (
    <header>
      <a className="wordmark" href={linkHref('/')}>
        MOTION <span>/</span> TRANSFER
      </a>
      <span className="edition">COMPILED → RECOVERED → REUSED</span>
    </header>
  );
}
export function Intro() {
  const playback = readGenerationMode() === 'playback-only';
  const accepted = readRecovery() === 'accepted';
  const comparison = readJujumpComparison();
  return (
    <section className="intro">
      <div>
        <p className="eyebrow">BORROW A MOVE. MAKE A GAME.</p>
        <h1>
          One game&apos;s move.
          <br />
          <em>Your next barrage dodge.</em>
        </h1>
        <p>
          Fly a 60 Hz Japanese arcade bullet-hell shooter. Borrow a dash from another game. Make a
          version you can play and keep.
        </p>
      </div>
      <aside className="ability-card compact-ability" aria-label="Recovered ability">
        <div className="ability-heading">
          <span className="ability-icon" aria-hidden="true">
            ↠
          </span>
          <span className="pill">{accepted ? 'ACCEPTED RECOVERY' : 'SAVED RECOVERY'}</span>
        </div>
        <p className="eyebrow">EXTRACTED FROM DASHY DANGO</p>
        <h2>Borrow the dash ↠</h2>
        <p>
          {accepted
            ? 'One accepted recovery, with its own burst and recharge. Try it in PARALLAXIA below.'
            : 'One saved recovery, with its own burst and recharge. Try it in PARALLAXIA below.'}
        </p>
        <div className="ability-links">
          <a href={linkHref('/donor/play')} target="_blank" rel="noreferrer">
            Play Dashy Dango ↗
          </a>
          <a
            href={linkHref(playback ? '/evidence/component.ts' : '/component/export')}
            download={playback ? 'component.ts' : 'recovered-dash.json'}
          >
            Component source ↗
          </a>
          <a href="#evidence-details">Recovery evidence ↓</a>
          {comparison ? (
            <a id="jujump-comparison" href={linkHref(comparison)} target="_blank" rel="noreferrer">
              JUJUMP comparison ↗
            </a>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
export function RecoveryDetails() {
  const playback = readGenerationMode() === 'playback-only';
  const { artifact, destination } = useTransfer();
  const version = artifact?.id;
  return (
    <details className="recovery-details" id="recovery-details">
      <summary>
        <span>How was this dash recovered?</span>
        <span className="detail-label">SAVED EVIDENCE + SUPPORTED RULES</span>
      </summary>
      <div className="recovery-grid">
        <div>
          <h3>From compiled instructions to reusable source</h3>
          <p>
            Meta models received selected WebAssembly instructions and measured donor traces. They
            reconstructed a standalone controller, which was checked against the actual cartridge.
            The component runs without the donor's binary, renderer, or assets.
          </p>
          <RecoveryVerdict />
          <p>
            <a href={linkHref('/evidence/recovery-history.json')}>Generation and repair history</a>{' '}
            · <a href={linkHref('/evidence/evidence.json')}>Binary and numeric evidence</a> ·{' '}
            <a href={linkHref('/evidence/evaluation-acceptance.json')}>Acceptance results</a>
          </p>
        </div>
        <div>
          <h3>What is supported?</h3>
          <ul>
            <li>An eight-tick dash covering 60 donor pixels.</li>
            <li>Direction stays fixed during the dash.</li>
            <li>Recharge lasts 25 inactive ticks; holding dash can retrigger it.</li>
            <li>Initial readiness takes 10 ticks. Timing runs at 60 updates per second.</li>
          </ul>
          <p>
            Verified for the default donor configuration and source body width 8. Combat, scoring,
            visuals, and full-game equivalence are outside this recovery's claim.
          </p>
        </div>
      </div>
      <details>
        <summary>Human assistance and adapter policies</summary>
        <p>
          A human selected the motion boundary, bytecode functions, memory watches, and development
          experiments, and authored the checks. Meta Wonder generated the controller; Meta Spark
          repaired a failed case before fresh acceptance inputs were used. The frozen controller has
          no manual source repairs. Live investigations choose their own experiments, with
          world-position and timer readings supplied by a disclosed human-mapped, read-only donor
          registry.
        </p>
        <p>
          PAKU PAKU&apos;s and PARALLAXIA&apos;s adapters were generated by Meta; their host hooks
          were written by hand. JUJUMP&apos;s separate adapter and host hooks were written by hand.
          All call the exact same frozen component on every logical update. No new recovery runs
          when you choose a destination. PARALLAXIA&apos;s simulation, sprites, effects and Web
          Audio synth are upstream work by Kenta Cho (ABA Games); our transfer is an added feature.
        </p>
        <p>
          PAKU PAKU preserves its dot-then-ghost collision order, with swept player hitboxes and no
          collision segment across wraparound. JUJUMP keeps gravity active and sweeps dash movement
          through the original upward platform-overlap resolution. PARALLAXIA steps the 60 Hz
          component in lockstep with the 60 Hz space-shooter simulation and phase-dashes across
          enemy bullet curtains while preserving grazing and vertical movement. Contact never resets
          the recovered timers.
        </p>
        <p>
          {playback ? (
            <>
              {destination?.source ? (
                <a href={linkHref(destination.source)}>PARALLAXIA adapter</a>
              ) : null}
              {version ? (
                <>
                  {' '}
                  · <a href={linkHref('/versions/' + version + '/notices.txt')}>Notices</a>
                </>
              ) : null}{' '}
              · <a href={linkHref('/evidence/contract.json')}>Recovered contract</a> ·{' '}
              <a href={linkHref('/evidence/provenance.json')}>Component identity</a> ·{' '}
              <a href={linkHref('/evidence/component.ts')}>Component source</a>
            </>
          ) : (
            <>
              <a href={linkHref('/artifact/adapter.ts')}>PAKU PAKU adapter</a> ·{' '}
              <a href={linkHref('/jujump/adapter.ts')}>JUJUMP adapter</a> ·{' '}
              <a href={linkHref('/roadster/adapter.ts')}>PARALLAXIA adapter</a> ·{' '}
              <a href={linkHref('/evidence/contract.json')}>Recovered contract</a> ·{' '}
              <a href={linkHref('/evidence/provenance.json')}>Component identity</a>
            </>
          )}
        </p>
      </details>
    </details>
  );
}
export function Footer() {
  const playback = readGenerationMode() === 'playback-only';
  const { artifact } = useTransfer();
  return (
    <footer>
      <span>
        Dashy Dango by willGuimont · PARALLAXIA, PAKU PAKU &amp; JUJUMP by Kenta Cho / ABA Games ·{' '}
        {playback ? (
          <>
            <a href={linkHref('/NOTICE.txt')}>Donor notice</a> ·{' '}
            {artifact ? (
              <a href={linkHref('/versions/' + artifact.id + '/notices.txt')}>PARALLAXIA notices</a>
            ) : (
              'PARALLAXIA notices'
            )}{' '}
            ·{' '}
          </>
        ) : (
          <>
            <a href={linkHref('/licenses')}>PAKU notices</a> ·{' '}
            <a href={linkHref('/jujump/licenses')}>JUJUMP notices</a> ·{' '}
            <a href={linkHref('/roadster/notices')}>PARALLAXIA notices</a> ·{' '}
          </>
        )}
        <a href="#privacy-note">Privacy</a>
      </span>
      <span>Local preview · adults 18 and older · one saved dash, different worlds</span>
    </footer>
  );
}
