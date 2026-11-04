/** A PARALLAXIA dash mapping: distance scale, direction and activation. */
export interface DashIntent {
  unitScale: number;
  activation: string;
  direction: string;
}

/** The default mapping sends the donor's 60 source pixels to six world units. */
export const BASE_UNIT_SCALE = 0.1;
export const DONOR_PIXELS = 60;
export const DASH_ACTIVE_TICKS = 8;
export const DASH_RECHARGE_TICKS = 25;

export function worldUnits(intent: DashIntent): number {
  return Number((intent.unitScale * DONOR_PIXELS).toFixed(2));
}

export function distanceMultiplier(intent: DashIntent): string {
  const ratio = intent.unitScale / BASE_UNIT_SCALE;
  if (Math.abs(ratio - 0.5) < 1e-6) return '½×';
  if (Math.abs(ratio - 0.25) < 1e-6) return '¼×';
  return `${Number(ratio.toFixed(2))}×`;
}

export function directionLabel(direction: string): string {
  return direction === 'opposite' ? 'Backward' : 'Forward';
}

export function activationLabel(activation: string): string {
  return activation === 'press' ? 'Fresh press' : 'Held';
}

export interface IntentBadge {
  key: string;
  glyph: string;
  label: string;
}

export function intentBadges(intent: DashIntent | null): IntentBadge[] {
  if (!intent) return [];
  return [
    {
      key: 'direction',
      glyph: intent.direction === 'opposite' ? '←' : '→',
      label: directionLabel(intent.direction),
    },
    {
      key: 'distance',
      glyph: distanceMultiplier(intent),
      label: `${worldUnits(intent)} units`,
    },
    {
      key: 'activation',
      glyph: intent.activation === 'press' ? '⏎' : '▬',
      label: activationLabel(intent.activation),
    },
  ];
}

const SMALLEST_SCALE = 0.025;
const LARGEST_SCALE = 0.2;
const SAFETY_WORDS = /invulnerab|immun|shield|enemy|enemies|collision/;
const KEEPS_RULES = /keep|preserve|no added|without/;

/**
 * Reads a request the same way the server's own check does, so people see what will count before
 * they spend a request. It stays in step with requestedParallaxiaIntent in recipient-request.mjs.
 */
export function readRequest(prompt: string, parent: DashIntent): DashIntent | null {
  const text = prompt.toLowerCase();
  if (SAFETY_WORDS.test(text) && !KEEPS_RULES.test(text)) return null;
  const intent = { ...parent };
  let changed = false;
  if (/backward|opposite/.test(text)) {
    intent.direction = 'opposite';
    changed = true;
  } else if (/forward|facing/.test(text)) {
    intent.direction = 'facing';
    changed = true;
  }
  if (/fresh[ -]press|on a press/.test(text)) {
    intent.activation = 'press';
    changed = true;
  } else if (/held|hold/.test(text)) {
    intent.activation = 'held';
    changed = true;
  }
  const units = text.match(/(\d+(?:\.\d+)?)\s*(?:world[ -]units?|units?)/);
  if (/half/.test(text)) {
    intent.unitScale /= 2;
    changed = true;
  } else if (/double|twice/.test(text)) {
    intent.unitScale *= 2;
    changed = true;
  } else if (units) {
    intent.unitScale = Number(units[1]) / DONOR_PIXELS;
    changed = true;
  }
  return changed && intent.unitScale >= SMALLEST_SCALE && intent.unitScale <= LARGEST_SCALE
    ? intent
    : null;
}

export interface IntentChange {
  key: string;
  label: string;
  from: string;
  to: string;
  changed: boolean;
}

/** What a child changed relative to its parent. Unchanged properties were inherited. */
export function diffIntent(parent: DashIntent | null, child: DashIntent | null): IntentChange[] {
  if (!child) return [];
  const before = parent ?? child;
  return [
    {
      key: 'direction',
      label: 'Direction',
      from: directionLabel(before.direction),
      to: directionLabel(child.direction),
      changed: before.direction !== child.direction,
    },
    {
      key: 'distance',
      label: 'Distance',
      from: `${worldUnits(before)} units`,
      to: `${worldUnits(child)} units`,
      changed: Math.abs(before.unitScale - child.unitScale) > 1e-9,
    },
    {
      key: 'activation',
      label: 'Activation',
      from: activationLabel(before.activation),
      to: activationLabel(child.activation),
      changed: before.activation !== child.activation,
    },
  ];
}

/** A short card title from the request that created a version. */
export function shortTitle(text: string | null | undefined, fallback = 'Saved generation'): string {
  const value = (text ?? '').trim();
  if (!value) return fallback;
  const sentence = value.split(/(?<=[.!?])\s/)[0] ?? value;
  return sentence.length > 72 ? sentence.slice(0, 69).trimEnd() + '…' : sentence;
}
