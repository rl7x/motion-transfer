export const PATCH_LIMITS = Object.freeze({ patches: 8, anchor: 2000, replacement: 8000, total: 20000 });
const FORBIDDEN = /\b(require|import|eval|Function|fetch|XMLHttpRequest|WebSocket|process|globalThis|window|document|setTimeout|setInterval|Math\.random|Date\.now|performance)\b/;

/** Shape and capability checks on Spark's patches. The isolated worker is the real boundary. */
export function gatePatches(patches) {
  if (!Array.isArray(patches) || patches.length === 0 || patches.length > PATCH_LIMITS.patches) throw Error(`Submit 1 to ${PATCH_LIMITS.patches} patches`);
  let total = 0;
  for (const patch of patches) {
    if (!patch || typeof patch.anchor !== 'string' || typeof patch.replacement !== 'string') throw Error('Each patch needs an anchor and a replacement');
    if (!patch.anchor || patch.anchor.length > PATCH_LIMITS.anchor || patch.replacement.length > PATCH_LIMITS.replacement) throw Error('A patch exceeds the size limit');
    total += patch.replacement.length;
    const added = patch.replacement.replace(patch.anchor, () => '');
    const banned = added.match(FORBIDDEN);
    if (banned) throw Error(`A patch adds the forbidden capability "${banned[0]}"`);
  }
  if (total > PATCH_LIMITS.total) throw Error('Patches exceed the total size limit');
}

/** Apply literal anchored replacements in order. Every anchor must match exactly once. */
export function applyPatches(source, patches) {
  gatePatches(patches);
  return patches.reduce((text, patch, index) => {
    const matches = text.split(patch.anchor).length - 1;
    if (matches !== 1) throw Error(`Patch ${index + 1} anchor matched ${matches} times; it must match exactly once`);
    return text.replace(patch.anchor, () => patch.replacement);
  }, source);
}
