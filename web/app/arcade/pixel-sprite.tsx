/*
 * Pixel sprites drawn as SVG rects, so they stay crisp at any size.
 * Each row is a string; a letter maps to a palette colour and "." is empty.
 * Original art for this project: the dango courier, pipeline workers and cartridge motifs.
 */

const SHARED: Record<string, string> = {
  k: '#0b0b14',
  w: '#f4f1ff',
  b: '#3b82ff',
  B: '#1d4fd8',
  y: '#ffd23f',
  c: '#36e2ff',
  C: '#1597b8',
  l: '#c6f432',
  L: '#7fa312',
  m: '#ff3dbe',
  M: '#a31f7a',
  a: '#ffc53d',
  A: '#c98a1a',
  p: '#ff8fb8',
  g: '#7ad67a',
  G: '#4a4f72',
  s: '#9aa0c3',
  n: '#b07a45',
  r: '#ff5d6c',
  v: '#8b6cff',
};

interface Sprite {
  rows: string[];
  /** Rects [x, y, w, h] hidden by a blink, painted with `lid`. */
  eyes?: [number, number, number, number][];
  lid?: string;
}

export const SPRITES = {
  courier: {
    rows: [
      '.....kkkk....kkkk....kkkk..',
      '....kggggk..kwwwwk..kppppk.',
      '...kggggggkkwwwwwwkkppppppk',
      'nnnkggggggkkwkwwkwkkppppppk',
      'nnnkggggggkkwkwwkwkkppppppk',
      '...kggggggkkwrwwrwkkppppppk',
      '....kggggk..kwwwwk..kppppk.',
      '.....kkkk....kkkk....kkkk..',
    ],
    eyes: [
      [13, 3, 1, 2],
      [16, 3, 1, 2],
    ],
    lid: '#f4f1ff',
  },
  spark: {
    rows: [
      '.......y........',
      '......yy........',
      '.......yy.......',
      '.......k........',
      '....kkkkkkkk....',
      '...kbbbbbbbbk...',
      '...kbwwbbwwbk...',
      '...kbwkbbwkbk...',
      '...kbbbbbbbbk...',
      '...kbbyyyybbk...',
      '....kkkkkkkk....',
      '..kkBBBBBBBBkk..',
      '.kbkBBbyyBBBkbk.',
      '.kbkBBBBBBBBkbk.',
      '...kBBkkkkBBk...',
      '...kkk....kkk...',
    ],
    eyes: [
      [5, 6, 2, 2],
      [9, 6, 2, 2],
    ],
    lid: '#3b82ff',
  },
  wonder: {
    rows: [
      '.......kk.......',
      '......kvvk......',
      '.....kvvyvk.....',
      '....kvvvvvvk....',
      '..kkkkkkkkkkkk..',
      '...kbbbbbbbbk...',
      '...kbwwbbwwbk...',
      '...kbwkbbwkbk...',
      '...kbbbbbbbbk...',
      '...kbbbwwbbbk...',
      '....kkkkkkkk....',
      '...kvvvvvvvvk.y.',
      '..kvvvvyvvvvkky.',
      '..kvvvvvvvvvk.k.',
      '...kvvvvvvvk..k.',
      '...kkkkkkkkk....',
    ],
    eyes: [
      [5, 6, 2, 2],
      [9, 6, 2, 2],
    ],
    lid: '#3b82ff',
  },
  sandbox: {
    rows: [
      '................',
      '...kkkkkkkkkk...',
      '..kaaaaaaaaaak..',
      '..kaAAAAAAAAak..',
      '..kaAwwAAwwAak..',
      '..kaAwkAAwkAak..',
      '..kaAAAAAAAAak..',
      '..kaAAkkkkAAak..',
      '..kaaaaaaaaaak..',
      '..kkkkkkkkkkkk..',
      '..kAkcccccckAk..',
      '..kAkcwwwwckAk..',
      '..kAkccwwcckAk..',
      '..kAkkcccckkAk..',
      '..kkk.kcck.kkk..',
      '.......kk.......',
    ],
    eyes: [
      [5, 4, 2, 2],
      [9, 4, 2, 2],
    ],
    lid: '#c98a1a',
  },
  verifier: {
    rows: [
      '................',
      '....kkkkkkkk....',
      '...kllllllllk...',
      '...klwwllwwlk...',
      '...klwkllwklk...',
      '...kllllllllk...',
      '...kllLLLLllk...',
      '....kkkkkkkk.kk.',
      '...kLLLLLLLLkcck',
      '..kLLLLLLLLLkcck',
      '..kLkLLLLLLkLkk.',
      '..kLkLLLLLLkk...',
      '...kLLLLLLLk....',
      '...kLLkkkLLk....',
      '...kkk...kkk....',
      '................',
    ],
    eyes: [
      [5, 3, 2, 2],
      [9, 3, 2, 2],
    ],
    lid: '#c6f432',
  },
  librarian: {
    rows: [
      '................',
      '....kkkkkkkk....',
      '...kmmmmmmmmk...',
      '...kmwwmmwwmk...',
      '...kmwkmmwkmk...',
      '...kmmmmmmmmk...',
      '...kmmmkkmmmk...',
      '....kkkkkkkk....',
      '..kkkkkkkkkkkk..',
      '..kGGGGGGGGGGk..',
      '..kGkllllllkGk..',
      '..kGkllllllkGk..',
      '..kGkkkkkkkkGk..',
      '..kGGGGGGGGGGk..',
      '..kkkkkkkkkkkk..',
      '................',
    ],
    eyes: [
      [5, 3, 2, 2],
      [9, 3, 2, 2],
    ],
    lid: '#ff3dbe',
  },
  ship: {
    rows: [
      '......kk......',
      '.....kcck.....',
      '.....kcck.....',
      '....kcwwck....',
      '....kcwwck....',
      '...kcccccck...',
      '..kccCccCcck..',
      '.kcccCccCccck.',
      'kcckCCccCCkcck',
      'kck.kcccck.kck',
      'kk...kmmk...kk',
      '......mm......',
    ],
  },
  jumper: {
    rows: [
      '..............',
      '.....kkkk.....',
      '.....kggk.....',
      '.....kggk.....',
      '.....kkkk.....',
      '..............',
      '..............',
      '...kkkkkkkk...',
      '...kbbbbbbk...',
      '...kkkkkkkk...',
    ],
  },
  car: {
    rows: [
      '....kkkkkk......',
      '...kmmmmmmk.....',
      '..kmcckmcckkkk..',
      '.kmmmmmmmmmmmmk.',
      'kmmmmmmmmmmmmmmk',
      'kkkkkkkkkkkkkkkk',
      '..kGGk....kGGk..',
      '..kkkk....kkkk..',
    ],
  },
  dots: {
    rows: [
      '..............',
      '..............',
      '..aa..aa..aa..',
      '..aa..aa..aa..',
      '..............',
      '.kkkk.........',
      '.kyyk..aa..aa.',
      '.kyyk..aa..aa.',
      '.kkkk.........',
      '..............',
    ],
  },
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPRITES;
/** One-off or held reactions. */
export type SpriteMood = 'hop' | 'party' | 'shake' | 'slump';

const cache = new Map<SpriteName, { x: number; y: number; w: number; fill: string }[]>();

/** Merge horizontal runs of one colour into single rects. */
function rects(name: SpriteName) {
  const hit = cache.get(name);
  if (hit) return hit;
  const out: { x: number; y: number; w: number; fill: string }[] = [];
  SPRITES[name].rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (row[x + w] === ch) w++;
      const fill = SHARED[ch];
      if (ch !== '.' && fill) out.push({ x, y, w, fill });
      x += w;
    }
  });
  cache.set(name, out);
  return out;
}

export function PixelSprite({
  name,
  size = 48,
  working = false,
  still = false,
  mood,
  className,
  title,
  tint,
}: {
  name: SpriteName;
  /** Rendered width in CSS pixels. */
  size?: number;
  working?: boolean;
  still?: boolean;
  mood?: SpriteMood;
  className?: string;
  title?: string;
  /** Paint every pixel one colour, for afterimage silhouettes. */
  tint?: string;
}) {
  const sprite: Sprite = SPRITES[name];
  const width = Math.max(...sprite.rows.map((row) => row.length));
  const height = sprite.rows.length;
  return (
    <svg
      viewBox={`0 -1 ${width} ${height + 1}`}
      width={size}
      height={(size * (height + 1)) / width}
      shapeRendering="crispEdges"
      className={'pixel-sprite' + (className ? ' ' + className : '')}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g className={mood ? 'px-mood-' + mood : undefined}>
        <g className={still ? undefined : working ? 'px-bob-fast' : 'px-bob'}>
          {rects(name).map((r, index) => (
            <rect key={index} x={r.x} y={r.y} width={r.w} height={1} fill={tint ?? r.fill} />
          ))}
          {!still && !tint && sprite.eyes && sprite.lid ? (
            <g className="px-blink">
              {sprite.eyes.map(([x, y, w, h]) => (
                <rect key={`${x}:${y}`} x={x} y={y} width={w} height={h} fill={sprite.lid} />
              ))}
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  );
}
