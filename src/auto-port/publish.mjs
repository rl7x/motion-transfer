import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryUrl } from '../paths.mjs';
import { DRIVERS } from './drivers.mjs';
import { applyPatches } from './patches.mjs';
import { buildRuntime } from './runtime.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const escapeScript = text => text.replace(/<\/script/gi, '<\\/script');

// Sandboxed frames have no storage, so high scores fall back to memory for that session.
const STORAGE = `(function () {
  try { window.localStorage.getItem("x"); return; } catch (error) { /* opaque origin */ }
  var memory = {};
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: function (key) { return key in memory ? memory[key] : null; },
    setItem: function (key, value) { memory[key] = String(value); },
    removeItem: function (key) { delete memory[key]; },
  } });
})();`;

// The page's only link to the site: the dash button in, and a dash reading out.
const BRIDGE = `(function () {
  var channel = (location.hash.match(/channel=([a-zA-Z0-9-]+)/) || [])[1], last = null, update = MotionDash.update;
  MotionDash.update = function (game, direction) {
    var result = update(game, direction);
    last = { output: { ownsMotion: result.owns, events: result.events }, state: { core: game.motionDash.core } };
    return result;
  };
  addEventListener("message", function (event) {
    if (event.source === parent && event.data && event.data.channel === channel && event.data.type === "dash") MotionDash.held = Boolean(event.data.pressed);
  });
  // A reading is cleared once sent, so the meter stops claiming "ready" when the run ends.
  setInterval(function () { if (channel) parent.postMessage({ type: "motion-status", channel: channel, motion: last }, "*"); last = null; }, 80);
})();`;

function inject(html, script) {
  const tag = `<script>${escapeScript(script)}</script>`, at = html.indexOf('<script');
  return at === -1 ? html.replace('</head>', `${tag}</head>`) : html.slice(0, at) + tag + html.slice(at);
}

function walk(directory, root = directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'tests' || name === 'test' ? [] : walk(path, root);
    return [relative(root, path)];
  });
}

/** Rebuild every passing port from its saved patches and pinned source. No model is involved. */
export async function portedSite({ component }) {
  const evidence = repositoryUrl('assets/evidence/auto-port.json');
  if (!existsSync(evidence)) return {};
  const site = {};
  for (const game of JSON.parse(await readFile(evidence, 'utf8')).games) {
    if (game.status !== 'passed') continue;
    const driver = DRIVERS[game.id], root = fileURLToPath(repositoryUrl(`assets/auto-port/games/${game.id}`));
    const patches = game.attempts[game.attempts.length - 1].patches;
    const runtime = await buildRuntime({ component, dashKey: driver.dashKey });
    for (const file of walk(root)) {
      const bytes = await readFile(join(root, file)), type = TYPES[extname(file)] ?? 'application/octet-stream';
      let before = bytes, after = bytes;
      if (file === 'index.html') {
        const html = bytes.toString('utf8');
        before = inject(html, STORAGE);
        after = inject(driver.page ? html.replace(driver.page[0], driver.page[1]) : html, `${STORAGE}\n${runtime}\n${BRIDGE}`);
      } else if (file === driver.core) after = applyPatches(bytes.toString('utf8'), patches);
      site[`ported/${game.id}/before/${file}`] = { type, bytes: before };
      site[`ported/${game.id}/after/${file}`] = { type, bytes: after };
    }
  }
  return site;
}
