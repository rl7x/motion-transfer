export function parseArgs(argv) {
  const args = { mode: 'all', out: 'reports/demo', fresh: null, headed: false, accepted: false };
  let outSet = false;
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('--')) args.mode = rest.shift();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--out') {
      args.out = rest[index + 1];
      if (!args.out || args.out.startsWith('--')) throw Error('--out needs a directory');
      outSet = true;
      index += 1;
    } else if (token === '--fresh-acceptance') {
      args.fresh = rest[index + 1];
      if (!args.fresh || args.fresh.startsWith('--')) throw Error('--fresh-acceptance needs a file');
      index += 1;
    } else if (token === '--headed') args.headed = true;
    else if (token === '--accepted-roadster') args.accepted = true;
    else throw Error('Unknown argument ' + token);
  }
  if (!['all', 'capture', 'render'].includes(args.mode)) throw Error('Mode must be capture, render, or all');
  if (args.accepted && args.fresh) throw Error('--accepted-roadster does not use --fresh-acceptance');
  if (args.accepted && !outSet) args.out = 'reports/demo-accepted';
  if (args.accepted && args.out === 'reports/demo') throw Error('--accepted-roadster cannot overwrite reports/demo');
  return args;
}
