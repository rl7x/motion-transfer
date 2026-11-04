const CONTRAST = 24;
const MAXIMUM_LANDMARKS = 15;
const SIDE_MARGIN = 0.07;

const backgroundLevel = gray => {
  const counts = new Uint32Array(256);
  for (const value of gray) counts[value] += 1;
  return counts.indexOf(Math.max(...counts));
};

/**
 * Finds separate objects in one grayscale frame, working on the game's own pixel grid. A point on
 * each one seeds SAM, which then doesn't need to know what the object is.
 */
export function findSprites(gray, width, height, { pixelScale = 1 } = {}) {
  const columns = Math.floor(width / pixelScale), rows = Math.floor(height / pixelScale);
  const background = backgroundLevel(gray);
  const marked = new Uint8Array(columns * rows);
  const middle = pixelScale >> 1;
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    marked[y * columns + x] = Math.abs(gray[(y * pixelScale + middle) * width + x * pixelScale + middle] - background) > CONTRAST ? 1 : 0;
  }
  const sprites = [], seen = new Uint8Array(columns * rows);
  for (let start = 0; start < marked.length; start++) {
    if (!marked[start] || seen[start]) continue;
    const stack = [start], members = [];
    seen[start] = 1;
    while (stack.length) {
      const at = stack.pop(), x = at % columns, y = (at - x) / columns;
      members.push([x, y]);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        const next = ny * columns + nx;
        if (marked[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    const xs = members.map(point => point[0]), ys = members.map(point => point[1]);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    // The point sits on the sprite itself, since the center of an open shape can be background.
    const [px, py] = members.reduce((best, point) => (Math.hypot(point[0] - cx, point[1] - cy) < Math.hypot(best[0] - cx, best[1] - cy) ? point : best));
    sprites.push({ x: px * pixelScale + middle, y: py * pixelScale + middle, width: right - left + 1, height: bottom - top + 1 });
  }
  return sprites;
}

/** Keeps sprites that make good landmarks: small, away from the HUD, and not the player. */
export function chooseLandmarks(sprites, { width, height, pixelScale = 1, player }) {
  const small = Math.max(columnsOf(width, pixelScale), columnsOf(height, pixelScale)) / 6;
  const clear = (player ? 3 : 0) * 8 * pixelScale;
  return sprites
    .filter(sprite => sprite.width <= small && sprite.height <= small)
    .filter(sprite => sprite.y > height * SIDE_MARGIN && sprite.y < height * (1 - SIDE_MARGIN))
    .filter(sprite => !player || Math.hypot(sprite.x - player.x, sprite.y - player.y) > clear)
    .sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2))
    .slice(0, MAXIMUM_LANDMARKS);
}

const columnsOf = (size, pixelScale) => Math.floor(size / pixelScale);

/** SAM's point prompt. Each object gets its own id, and the frame marker says where to find it. */
export function pointPrompt(points, { width, height }) {
  return points.map(({ id, frame, x, y }) => `<${frame}f>${id}<|point;x=${x};y=${y};w=${width};h=${height}|>`).join('');
}
