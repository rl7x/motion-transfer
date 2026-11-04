import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { distanceTolerance, gradeController } from '../src/footage/grade.mjs';
import { chooseLandmarks, findSprites, pointPrompt } from '../src/footage/landmarks.mjs';
import { checkClipPath, checkRights, recoverMove } from '../src/footage/recover.mjs';
import { parseTracks, samCostUsd, samRequest, textFromStream } from '../src/footage/sam.mjs';
import { cameraFollows, defaultDirection, detectBursts, motionSummary, shortestGap, splitBursts, staysOnScreen, worldSteps } from '../src/footage/trajectory.mjs';

// Real SAM 3.1 output for a 60-frame Dashy Dango clip at 4x, with masks removed to keep it small.
const fixture = await readFile(new URL('./fixtures/sam-tracks.txt', import.meta.url), 'utf8');
const truth = JSON.parse(await readFile(new URL('./fixtures/sam-tracks-truth.json', import.meta.url), 'utf8'));
const clip = { playerId: 1, width: 640, height: 640, pixelScale: 4 };

test('SAM text becomes one track per object, each with its frames', () => {
  const tracks = parseTracks(fixture);
  assert.equal(tracks.size, 11);
  assert.equal(tracks.get(1).size, 59);
  assert.deepEqual([...Object.keys(tracks.get(1).get(20))].slice(0, 4), ['x1', 'y1', 'x2', 'y2']);
});

test('the camera follows this player, so the player stays still on screen', () => {
  const player = parseTracks(fixture).get(1);
  const steady = [2, 20, 50].map(frame => player.get(frame).x1);
  assert.ok(Math.max(...steady) - Math.min(...steady) <= 1);
  assert.ok(player.get(28).x2 - player.get(28).x1 > player.get(2).x2 - player.get(2).x1, 'A dash stretches the box with its afterimage');
});

test('scenery motion recovers the true player motion, including through a dash', () => {
  const steps = worldSteps(parseTracks(fixture), clip);
  assert.ok(steps.length >= 50);
  const errors = steps.map(step => Math.hypot(step.x - (truth[step.frame].x - truth[step.frame - 1].x), step.y - (truth[step.frame].y - truth[step.frame - 1].y)));
  const walking = errors.filter((_, index) => Math.hypot(steps[index].x, steps[index].y) < 3);
  assert.ok(Math.max(...walking) <= 0.13, 'Walking stays within an eighth of a pixel');
  assert.ok(Math.max(...errors) <= 0.65, 'A dash stays within the rounding of a 7.5 pixel step');
});

test('a dash is found with its exact length and distance', () => {
  const { bursts, walkSpeed } = detectBursts(worldSteps(parseTracks(fixture), clip));
  assert.equal(walkSpeed, 2);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].startFrame, 23);
  assert.equal(bursts[0].frames, 8);
  assert.ok(Math.abs(bursts[0].distance - 60) < 0.5);
  assert.deepEqual(bursts[0].direction, [1, 0]);
  assert.equal(bursts[0].startedFrom, 'moving');
});

test('a fixed camera works the same way: the player moves and the scenery stays', () => {
  const tracks = new Map([[1, new Map()], [2, new Map()], [3, new Map()]]);
  const box = x => ({ x1: x, y1: 100, x2: x + 15, y2: 115 });
  for (let frame = 0; frame < 40; frame++) {
    const speed = frame >= 10 && frame < 14 ? 20 : 4;
    tracks.get(1).set(frame, box(100 + frame * 4 + (frame >= 10 ? Math.min(frame - 9, 4) * 16 : 0) - (speed && 0)));
    tracks.get(2).set(frame, box(40));
    tracks.get(3).set(frame, box(500));
  }
  const { bursts, walkSpeed } = detectBursts(worldSteps(tracks, { playerId: 1, width: 640, height: 480, pixelScale: 1 }));
  assert.equal(walkSpeed, 4);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].frames, 4);
  assert.equal(bursts[0].distance, 80);
});

test('every other burst is held back, and the summary only carries practice bursts', () => {
  const bursts = [10, 50, 90, 130].map(startFrame => ({ startFrame, frames: 8, distance: 60, direction: [1, 0], perFrame: [], startedFrom: 'moving' }));
  const { practice, heldOut } = splitBursts(bursts);
  assert.deepEqual(practice.map(burst => burst.startFrame), [10, 90]);
  assert.deepEqual(heldOut.map(burst => burst.startFrame), [50, 130]);
  assert.equal(shortestGap(bursts), 40);
  const summary = motionSummary({ steps: [], bursts, walkSpeed: 2, practice });
  assert.equal(summary.burstsSeen, 4);
  assert.equal(summary.practiceBursts.length, 2);
  assert.ok(!JSON.stringify(summary).includes('130'), 'Held-out bursts must not reach the model');
});

test('sprites are found on the game grid and the player and HUD are left out', () => {
  const width = 160, height = 160, gray = new Uint8Array(width * height).fill(240);
  const blob = (left, top, w, h) => { for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) gray[y * width + x] = 80; };
  blob(0, 0, 160, 8);
  blob(76, 76, 8, 7);
  blob(100, 40, 7, 7);
  blob(30, 120, 7, 7);
  const sprites = findSprites(gray, width, height);
  assert.equal(sprites.length, 4);
  const landmarks = chooseLandmarks(sprites, { width, height, player: { x: 80, y: 80 } });
  assert.equal(landmarks.length, 2);
  assert.equal(pointPrompt([{ id: 2, frame: 5, x: 10, y: 20 }], { width: 640, height: 480 }), '<5f>2<|point;x=10;y=20;w=640;h=480|>');
});

test('a video request is billed per frame with a minimum, and a failed stream is an error', () => {
  assert.ok(Math.abs(samCostUsd(10) - 0.01) < 1e-9);
  assert.ok(Math.abs(samCostUsd(1000) - 0.2) < 1e-9);
  assert.match(samRequest({ video: Buffer.from('mp4'), prompt: 'x' }).input[0].content[1].video_url, /^data:video\/mp4;base64,/);
  assert.equal(textFromStream('data: {"type":"response.output_text.delta","delta":"<0f>"}\n\ndata: [DONE]\n'), '<0f>');
  assert.throws(() => textFromStream('data: {"type":"response.failed","response":{"error":{"message":"no"}}}\n'), /no/);
});

test('recovery refuses to start without a stated right to use the game', async () => {
  assert.throws(() => checkRights({ source: 'A game' }), /--rights must be one of/);
  assert.throws(() => checkRights({ rights: 'stolen', source: 'A game' }), /--rights must be one of/);
  assert.throws(() => checkRights({ rights: 'own' }), /--source/);
  assert.throws(() => checkRights({ rights: 'own', source: ' ' }), /--source/);
  assert.doesNotThrow(() => checkRights({ rights: 'open-license', source: 'A game by someone (MIT)' }));
  const sam = async () => { throw Error('SAM must not be called'); };
  await assert.rejects(() => recoverMove({ clip: 'x.mp4', out: 'nowhere', source: 'A game', sam }), /--rights/);
});

test('recovery takes local files only', () => {
  assert.throws(() => checkClipPath('https://example.com/clip.mp4'), /local file/);
  assert.throws(() => checkClipPath('file:///tmp/clip.mp4'), /local file/);
  assert.throws(() => checkClipPath('./does-not-exist.mp4'), /does not exist/);
});

const CONTROLLER = `export function init(config){return{remaining:0,cooldown:0,dx:0,dy:0}}
export function step(state,input,config){
  const s={...state},b=input.buttons,events=[];
  if(s.remaining>0){s.remaining--;if(s.remaining===0)events.push('dash-end');return{state:s,output:{ownsMotion:true,displacement:{x:s.dx,y:s.dy},events}}}
  if((b&1)&&s.cooldown===0){const x=(b&32?1:0)-(b&16?1:0),y=(b&128?1:0)-(b&64?1:0),l=Math.hypot(x,y)||1;s.dx=(l===1&&x===0&&y===0?1:x/l)*config.dashDistance/8;s.dy=y/l*config.dashDistance/8;s.remaining=7;s.cooldown=config.cooldownTicks;events.push('dash-start');return{state:s,output:{ownsMotion:true,displacement:{x:s.dx,y:s.dy},events}}}
  if(s.cooldown>0)s.cooldown--;
  return{state:s,output:{ownsMotion:false,displacement:{x:0,y:0},events}};
}`;
const config = { walkingSpeed: 2, dashDistance: 60, cooldownTicks: 25, initialCooldownTicks: 0 };
const burst = { startFrame: 100, frames: 8, distance: 60.1, direction: [1, 0], perFrame: [] };

test('a controller that matches the held-out bursts passes', async () => {
  const grade = await gradeController({ source: CONTROLLER, config, heldOut: [burst, { ...burst, direction: [0, -1] }], gap: 33 });
  assert.deepEqual(grade.failures, []);
  assert.equal(grade.recharge.measured, 33);
});

test('a controller with the wrong length, distance, direction or recharge fails with the reason', async () => {
  const short = await gradeController({ source: CONTROLLER, config, heldOut: [{ ...burst, frames: 12 }] });
  assert.match(short.failures[0], /lasted 8 ticks; the footage shows 12/);
  const far = await gradeController({ source: CONTROLLER, config: { ...config, dashDistance: 90 }, heldOut: [burst] });
  assert.match(far.failures[0], /moved 90/);
  const wrongWay = await gradeController({ source: CONTROLLER.replace('s.dx=(', 's.dy=0;s.dx=-('), config, heldOut: [burst] });
  assert.match(wrongWay.failures[0], /degrees off/);
  const slow = await gradeController({ source: CONTROLLER, config, heldOut: [burst], gap: 50 });
  assert.match(slow.failures[0], /repeated every 33 ticks/);
  assert.equal(distanceTolerance(60), 2.4);
});

test('the recharge check is exact, because a one tick error fails almost every real trace', async () => {
  const early = await gradeController({ source: CONTROLLER, config: { ...config, cooldownTicks: 24 }, heldOut: [burst], gap: 33 });
  assert.match(early.failures[0], /repeated every 32 ticks; the shortest gap in the footage is 33/);
});

test('a clip that shows the start of play also checks how soon the ability is available', async () => {
  const delayed = CONTROLLER.replace('cooldown:0', 'cooldown:config.initialCooldownTicks');
  const right = await gradeController({ source: delayed, config: { ...config, initialCooldownTicks: 10 }, heldOut: [burst], gap: 33, firstBurst: 10 });
  assert.deepEqual(right.failures, []);
  assert.equal(right.start.measured, 10);
  const wrong = await gradeController({ source: delayed, config: { ...config, initialCooldownTicks: 25 }, heldOut: [burst], gap: 33, firstBurst: 10 });
  assert.match(wrong.failures.at(-1), /first burst on step 25, counting from 0; the footage shows step 10/);
  const summary = motionSummary({ steps: [], bursts: [burst], walkSpeed: 2, practice: [], firstBurst: 10 });
  assert.equal(summary.framesOfPlayBeforeFirstBurst, 10);
  assert.equal(motionSummary({ steps: [], bursts: [burst], walkSpeed: 2, practice: [] }).framesOfPlayBeforeFirstBurst, undefined);
});

test('diagonal speed is true distance per frame, not a rounded single frame', () => {
  // A speed of 2 along a diagonal is 1.41 per axis, which a whole-pixel screen shows as 1s and 2s.
  const axis = [1, 2, 1, 2, 1, 1, 2, 1, 2, 1, 2, 1, 1, 2];
  const steps = axis.map((value, index) => ({ frame: index + 1, x: value, y: axis[(index + 1) % axis.length] }));
  steps.push(...Array.from({ length: 30 }, (_, index) => ({ frame: 100 + index, x: 2, y: 0 })));
  const summary = motionSummary({ steps, bursts: [], walkSpeed: 2, practice: [] });
  assert.ok(Math.abs(summary.diagonalMovingSpeed - 2) < 0.2, `Got ${summary.diagonalMovingSpeed}`);
});

test('a standing burst records where the player last moved, and only agreeing ones set a default', () => {
  const steps = [];
  for (let frame = 1; frame <= 20; frame++) steps.push({ frame, x: 1.41, y: 1.41 });
  for (let frame = 21; frame <= 40; frame++) steps.push({ frame, x: 0, y: 0 });
  for (let frame = 41; frame <= 48; frame++) steps.push({ frame, x: 7.5, y: 0 });
  for (let frame = 49; frame <= 60; frame++) steps.push({ frame, x: 0, y: 0 });
  const { bursts } = detectBursts(steps);
  assert.equal(bursts[0].startedFrom, 'standing still');
  assert.deepEqual(bursts[0].lastMovedDirection, [0.707, 0.707]);
  assert.equal(bursts[0].thenStopped, true);
  assert.equal(defaultDirection(bursts).length, 1);
  const other = { ...bursts[0], direction: [-1, 0] };
  assert.equal(defaultDirection([...bursts, other]), null);
  assert.equal(defaultDirection([{ ...bursts[0], startedFrom: 'moving' }]), null);
  // Aimed from a stop: the player keeps walking afterwards, so it says nothing about a default.
  assert.equal(defaultDirection([...bursts, { ...other, thenStopped: false }]).length, 1);
});

const WALKER = CONTROLLER.replace('return{state:s,output:{ownsMotion:false,displacement:{x:0,y:0},events}}', 'const x=(b&32?1:0)-(b&16?1:0),y=(b&128?1:0)-(b&64?1:0),l=Math.hypot(x,y)||1;return{state:s,output:{ownsMotion:false,displacement:{x:x/l*config.walkingSpeed,y:y/l*config.walkingSpeed},events}}');

test('walking is checked in a straight line and on a diagonal', async () => {
  const right = await gradeController({ source: WALKER, config, heldOut: [burst], walking: { straight: 2, diagonal: 2 } });
  assert.deepEqual(right.failures, []);
  const unnormalized = WALKER.replace('x/l*config.walkingSpeed', 'x*config.walkingSpeed').replace('y/l*config.walkingSpeed', 'y*config.walkingSpeed');
  const fast = await gradeController({ source: unnormalized, config, heldOut: [burst], walking: { straight: 2, diagonal: 2 } });
  assert.match(fast.failures[0], /Diagonal movement went 2\.83 pixels per tick; the footage shows 2/);
  const slow = await gradeController({ source: WALKER, config: { ...config, walkingSpeed: 1 }, heldOut: [burst], walking: { straight: 2 } });
  assert.match(slow.failures[0], /Straight movement went 1\.00 pixels per tick/);
});

test('a standing burst has to go the way the footage shows, not the way the player last moved', async () => {
  const standing = { ...burst, startedFrom: 'standing still', lastMovedDirection: [0.707, 0.707] };
  const right = await gradeController({ source: WALKER, config, heldOut: [burst], standing: [standing] });
  assert.deepEqual(right.failures, []);
  const remembers = WALKER
    .replace('return{remaining:0,cooldown:0,dx:0,dy:0}', 'return{remaining:0,cooldown:0,dx:0,dy:0,lx:1,ly:0}')
    .replace('const s={...state},b=input.buttons,events=[];', 'const s={...state},b=input.buttons,events=[];const hx=(b&32?1:0)-(b&16?1:0),hy=(b&128?1:0)-(b&64?1:0);if(hx||hy){const h=Math.hypot(hx,hy);s.lx=hx/h;s.ly=hy/h}')
    .replace('s.dx=(l===1&&x===0&&y===0?1:x/l)*config.dashDistance/8;s.dy=y/l*config.dashDistance/8', 's.dx=s.lx*config.dashDistance/8;s.dy=s.ly*config.dashDistance/8');
  const wrong = await gradeController({ source: remembers, config, heldOut: [burst], standing: [standing] });
  assert.match(wrong.failures[0], /With no direction held after moving, the burst went 45\.0 degrees off/);
  const nowhere = WALKER.replace('l===1&&x===0&&y===0?1:x/l', 'x/l');
  const still = await gradeController({ source: nowhere, config, heldOut: [burst], standing: [standing] });
  assert.match(still.failures.join(' '), /With no direction held after moving/);
});

test('one lost frame mid-burst is filled, but a lost frame at its edge drops the burst', () => {
  const clip = holes => {
    const steps = [];
    for (let frame = 1; frame <= 30; frame++) {
      if (holes.includes(frame)) continue;
      steps.push({ frame, x: frame >= 10 && frame < 18 ? 7.5 : 2, y: 0 });
    }
    return detectBursts(steps).bursts;
  };
  assert.equal(clip([])[0].frames, 8);
  const filled = clip([13]);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].frames, 8);
  assert.equal(filled[0].distance, 60);
  assert.equal(clip([18]).length, 0, 'The burst might have lasted one more frame');
  assert.equal(clip([9]).length, 0, 'The burst might have started one frame sooner');
  assert.equal(clip([12, 13]).length, 0, 'Two lost frames are too many to fill');
});

test('the camera is judged from normal-size boxes, even in a clip that is mostly dashes', () => {
  const size = { width: 640, height: 640, pixelScale: 4 };
  const dashing = new Map();
  for (let frame = 0; frame < 100; frame++) {
    const trail = frame % 10 < 7 ? 20 + (frame % 10) * 20 : 0;
    dashing.set(frame, { x1: 304 - trail, y1: 308, x2: 335, y2: 336 });
  }
  assert.equal(staysOnScreen([dashing], size), true, 'Afterimages stretch the box, but the player stays put');
  const wandering = new Map();
  for (let frame = 0; frame < 100; frame++) wandering.set(frame, { x1: 100 + frame * 4, y1: 308, x2: 131 + frame * 4, y2: 336 });
  assert.equal(staysOnScreen([wandering], size), false, 'A fixed camera shows the player moving at normal size');
});

test('the scenery decides the camera, even when the player track goes astray', () => {
  const size = { width: 640, height: 640, pixelScale: 4 };
  const box = (x, y = 300) => ({ x1: x, y1: y, x2: x + 27, y2: y + 27 });
  const clip = (playerAt, sceneryAt) => {
    const tracks = new Map([[1, new Map()], [2, new Map()], [3, new Map()]]);
    for (let frame = 0; frame < 60; frame++) {
      tracks.get(1).set(frame, box(playerAt(frame)));
      tracks.get(2).set(frame, box(sceneryAt(frame), 120));
      tracks.get(3).set(frame, box(sceneryAt(frame), 480));
    }
    return [tracks];
  };
  // SAM drifted off the player for a third of the clip, as it does in real footage.
  const drifting = frame => (frame % 30 < 10 ? 304 + frame * 6 : 304);
  assert.equal(cameraFollows(clip(drifting, frame => 500 - frame * 2), { playerId: 1, ...size }), true);
  assert.equal(cameraFollows(clip(drifting, () => 500), { playerId: 1, ...size }), false, 'Still scenery means a fixed camera');
  assert.equal(cameraFollows(clip(frame => 100 + frame * 8, frame => 500 - frame), { playerId: 1, ...size }), false, 'A loose camera has to use both motions');
  const steps = worldSteps(clip(frame => 304, frame => 500 - frame * 2)[0], { playerId: 1, ...size });
  assert.ok(steps.every(step => Math.abs(step.x - 0.5) < 1e-9), 'A followed player moves opposite to the scenery');
});
