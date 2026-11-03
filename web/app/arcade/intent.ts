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
