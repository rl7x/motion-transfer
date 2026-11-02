import { useResource } from '../hooks/use-resource';
import { GuidedDemo } from './guided-demo';
interface Measurements {
  measurements: { traceCount: number; updates: number; maxPositionError: number };
}
function RecoveryVerdict() {
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
export function Header() {
  return (
    <header>
      <a className="wordmark" href="/">
        MOTION <span>/</span> TRANSFER
      </a>
      <span className="edition">COMPILED → RECOVERED → REUSED</span>
    </header>
  );
}
export function Intro() {
  return (
    <section className="intro">
      <div>
        <p className="eyebrow">SOFTWARE HAS ABILITIES WORTH KEEPING.</p>
        <h1>
          Extract an ability from
          <br />
          compiled software.
          <br />
          <em>Give it a new home.</em>
        </h1>
        <p>
          What if a Roadster could dash in mid-air?
          <br />
          Give it the same ability recovered from a compiled game.
        </p>
        <GuidedDemo />
      </div>
      <aside className="ability-card" aria-label="Recovered ability">
        <div className="ability-heading">
          <span className="ability-icon" aria-hidden="true">
            ↠
          </span>
          <span className="pill">SAVED RECOVERY</span>
        </div>
        <p className="eyebrow">EXTRACTED FROM DASHY DANGO</p>
        <h2>Dash</h2>
        <p>
          A burst of movement with its own direction,
          <br />
          duration, and recharge.
        </p>
        <div className="ability-rules">
          <span>
            <strong>~0.13s</strong> burst of movement
          </span>
          <span>
            <strong>~0.42s</strong> to recharge
          </span>
        </div>
        <p className="ability-origin">
          Recovered by Meta models. Reused as a standalone component.
        </p>
        <div className="ability-links">
          <a href="#developer-task">Use it in your project ↓</a>
          <a href="/component/export" download="recovered-dash.json">
            Component source ↗
          </a>
          <a href="#recovery-details">Recovery evidence ↓</a>
        </div>
        <p className="saved-note">
          This is a saved recovery. Choosing a destination makes no model request.
        </p>
      </aside>
    </section>
  );
}
export function RecoveryDetails() {
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
            <a href="/evidence/recovery-history.json">Generation and repair history</a> ·{' '}
            <a href="/evidence/evidence.json">Binary and numeric evidence</a> ·{' '}
            <a href="/evidence/evaluation-acceptance.json">Acceptance results</a>
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
          PAKU PAKU's and Roadster's adapters were generated by Meta; their host hooks were written
          by hand. JUJUMP's separate adapter and host hooks were written by hand. All call the exact
          same frozen component on every logical update. No new recovery runs when you choose a
          destination. RDSTR Stunts' simulation, models, effects and audio are upstream work by
          sebayaki; our transfer is an added feature.
        </p>
        <p>
          PAKU PAKU preserves its dot-then-ghost collision order, with swept player hitboxes and no
          collision segment across wraparound. JUJUMP keeps gravity active and sweeps dash movement
          through the original upward platform-overlap resolution. Roadster bridges 60 Hz component
          updates to four native 240 Hz substeps and sweeps flight motion through the recipient's
          collision rules. Contact never resets the recovered timers.
        </p>
        <p>
          <a href="/artifact/adapter.ts">PAKU PAKU adapter</a> ·{' '}
          <a href="/jujump/adapter.ts">JUJUMP adapter</a> ·{' '}
          <a href="/roadster/adapter.ts">Roadster adapter</a> ·{' '}
          <a href="/evidence/contract.json">Recovered contract</a> ·{' '}
          <a href="/evidence/provenance.json">Component identity</a>
        </p>
      </details>
    </details>
  );
}
export function Footer() {
  return (
    <footer>
      <span>
        Dashy Dango by willGuimont · PAKU PAKU &amp; JUJUMP by Kenta Cho / ABA Games · RDSTR Stunts
        by sebayaki · <a href="/licenses">PAKU notices</a> ·{' '}
        <a href="/jujump/licenses">JUJUMP notices</a> ·{' '}
        <a href="/roadster/notices">Roadster notices</a>
      </span>
      <span>Local preview · one recovered dash, different worlds</span>
    </footer>
  );
}
