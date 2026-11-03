export function init(motion: any, config: any) {
  const core = motion.init(config.motion);
  return { core: core, prevDash: false };
}
export function step(state: any, frame: any, motion: any, config: any) {
  const raw: boolean = !!frame.dash;
  const airborne: boolean = !!frame.airborne;
  const facing: number = frame.facing < 0 ? -1 : 1;
  // adapter literals matching intent: press activation, facing direction
  const ACT_HELD: boolean = false;
  const DIR_FACING: boolean = true;
  const mappedFacing: number = DIR_FACING ? facing : -facing;
  const dirBits: number = mappedFacing < 0 ? 16 : 32;
  const prevRaw: boolean = !!state.prevDash;
  const edge: boolean = raw && !prevRaw;
  let activate: boolean = false;
  if (ACT_HELD) {
    activate = airborne && raw;
  } else {
    activate = airborne && edge;
  }
  const buttons: number = dirBits | (activate ? 1 : 0);
  const next: any = motion.step(state.core, { buttons: buttons, sourceBodyWidth: 8 }, config.motion);
  const owns: boolean = !!next.output.ownsMotion;
  const events: string[] = next.output.events;
  let displacement: number;
  let sweep: number[];
  if (owns) {
    const dx: number = Number(next.output.displacement.x);
    displacement = dx * config.unitScale;
    const ad: number = displacement < 0 ? -displacement : displacement;
    if (ad === 0) {
      sweep = [];
    } else {
      const n: number = Math.ceil(ad / 1);
      sweep = [];
      for (let i = 1; i < n; i++) {
        sweep.push(displacement * i / n);
      }
    }
  } else {
    displacement = frame.normalDisplacement;
    sweep = [];
  }
  const newState: any = { core: next.state, prevDash: raw };
  return { state: newState, output: { displacement: displacement, ownsMotion: owns, events: events, sweep: sweep } };
}
