import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * Builds the committed cartridge. Run it only to reproduce or change the target: the checks read
 * the committed binary and need no compiler. Set CLANG and WASM_LD if yours are elsewhere.
 */
const root = new URL('../assets/targets/px4-arming/', import.meta.url).pathname;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const clang = process.env.CLANG ?? '/opt/homebrew/opt/llvm/bin/clang';
async function linker() {
  if (process.env.WASM_LD) return process.env.WASM_LD;
  const toolchains = join(homedir(), '.rustup/toolchains');
  const newest = (await readdir(toolchains)).sort().at(-1);
  return join(toolchains, newest, 'lib/rustlib/aarch64-apple-darwin/bin/rust-lld');
}

// Two of 36 cells differ from public PX4, so an answer recalled from memory fails.
export const ALTERED_CELLS = Object.freeze([
  { row: 'STANDBY', column: 'STANDBY_ERROR', from: 'true,  true,    true,  false,         false,    false },', to: 'true,  true,    true,  true,          false,    false },', marker: 'ARMING_STATE_STANDBY */' },
  { row: 'SHUTDOWN', column: 'ARMED', from: 'true,  true,    false, true,          true,     true },', to: 'true,  true,    true,  true,          true,     true },', marker: 'ARMING_STATE_SHUTDOWN */' },
]);

const work = await mkdtemp(join(tmpdir(), 'px4-arming-'));
try {
  const source = join(work, 'commander');
  await mkdir(join(source, 'Arming/ArmStateMachine'), { recursive: true });
  await mkdir(join(source, 'HealthAndArmingChecks'), { recursive: true });
  await cp(join(root, 'upstream/ArmStateMachine.cpp'), join(source, 'Arming/ArmStateMachine/ArmStateMachine.cpp'));
  await cp(join(root, 'shim/HealthAndArmingChecks.hpp'), join(source, 'HealthAndArmingChecks/HealthAndArmingChecks.hpp'));
  await cp(join(root, 'boundary.cpp'), join(source, 'boundary.cpp'));
  let header = await readFile(join(root, 'upstream/ArmStateMachine.hpp'), 'utf8');
  for (const cell of ALTERED_CELLS) {
    const line = header.split('\n').find(text => text.includes(cell.marker) && text.includes('{ /*'));
    if (!line?.includes(cell.from)) throw Error('Upstream table changed: ' + cell.row);
    header = header.replace(line, line.replace(cell.from, cell.to));
  }
  await writeFile(join(source, 'Arming/ArmStateMachine/ArmStateMachine.hpp'), header);
  const flags = ['--target=wasm32', '-std=c++17', '-O2', '-ffreestanding', '-fno-builtin', '-nostdlib', '-nostdinc++',
    '-fno-exceptions', '-fno-rtti', '-fno-threadsafe-statics', '-fvisibility=hidden', '-I', join(root, 'shim'), '-c'];
  const objects = [];
  for (const file of ['Arming/ArmStateMachine/ArmStateMachine.cpp', 'boundary.cpp']) {
    const object = join(work, file.replaceAll('/', '_') + '.o');
    execFileSync(clang, [...flags, join(source, file), '-o', object], { stdio: 'inherit' });
    objects.push(object);
  }
  const output = join(root, 'arming.wasm'), lld = await linker();
  execFileSync(lld, ['-flavor', 'wasm', '--no-entry', '--strip-all', '--stack-first', '-z', 'stack-size=8192',
    '--initial-memory=65536', '--max-memory=65536', '--export=boot', '--export=step', '--export=__stack_pointer',
    '--export=__heap_base', ...objects, '-o', output], { stdio: 'inherit' });
  const hashes = {};
  for (const file of ['upstream/ArmStateMachine.cpp', 'upstream/ArmStateMachine.hpp', 'upstream/LICENSE', 'boundary.cpp', 'arming.wasm',
    'shim/HealthAndArmingChecks.hpp', 'shim/drivers/drv_hrt.h', 'shim/px4_platform_common/events.h', 'shim/systemlib/mavlink_log.h',
    'shim/uORB/topics/actuator_armed.h', 'shim/uORB/topics/vehicle_control_mode.h', 'shim/uORB/topics/vehicle_status.h']) {
    hashes[file] = sha256(await readFile(join(root, file)));
  }
  await writeFile(join(root, 'target.lock.json'), JSON.stringify({ schemaVersion: 1, id: 'px4-arming',
    upstream: { repository: 'https://github.com/PX4/PX4-Autopilot', tag: 'v1.14.0', commit: 'b8c541dd7277ed735139d7d1bfb829d61fbe29fb',
      files: ['src/modules/commander/Arming/ArmStateMachine/ArmStateMachine.cpp', 'src/modules/commander/Arming/ArmStateMachine/ArmStateMachine.hpp'], license: 'BSD-3-Clause' },
    alteredCells: ALTERED_CELLS.map(({ row, column }) => ({ row, column, upstream: false, built: true })),
    compiler: execFileSync(clang, ['--version'], { encoding: 'utf8' }).split('\n')[0],
    sha256: hashes['arming.wasm'], bytes: (await readFile(output)).length, files: hashes }, null, 2) + '\n');
  console.log('Built', output);
} finally { await rm(work, { recursive: true, force: true }); }
