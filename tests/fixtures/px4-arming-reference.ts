// Hand-written from PX4 v1.14.0 ArmStateMachine.cpp, with the two altered table cells. Test fixture only.
const TABLE = [[1, 1, 0, 1, 0, 0], [1, 1, 1, 1, 0, 0], [0, 1, 1, 0, 0, 1], [1, 1, 1, 1, 0, 0], [1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]];
const ARMED = 2, STANDBY = 1, STANDBY_ERROR = 3, IN_AIR_RESTORE = 5;
type S = { arm: number; armingReason: number; disarmingReason: number; lockdown: number; armedTime: number };
function pack(s: S, result: number, checksRan: number, denied: number) {
  return ((result + 1) | s.arm << 2 | s.lockdown << 5 | s.armedTime << 6 | checksRan << 7 | denied << 8 | s.armingReason << 9 | s.disarmingReason << 13) >>> 0;
}
export function init(boot: number): S { return { arm: boot, armingReason: 0, disarmingReason: 0, lockdown: 0, armedTime: 0 }; }
export function step(state: S, [requested, hil, runChecks, canArm, reason]: number[]) {
  const s = { ...state };
  let result = -1, feedback = false, checksRan = 0, denied = 0;
  if (requested === s.arm) result = 0;
  else {
    let valid = TABLE[requested][s.arm] === 1;
    if (valid && requested === ARMED && runChecks && !hil && s.arm !== IN_AIR_RESTORE) {
      checksRan = 1;
      if (!canArm) { feedback = true; valid = false; }
    }
    if (hil) {
      s.lockdown = 1;
      if (s.arm === STANDBY_ERROR) s.arm = STANDBY;
      if (requested === STANDBY) valid = true;
    }
    if (valid) {
      result = 1;
      if (s.arm === ARMED && requested !== ARMED) s.disarmingReason = reason;
      else if (s.arm !== ARMED && requested === ARMED) s.armingReason = reason;
      s.arm = requested;
      s.armedTime = s.arm === ARMED ? 1 : 0;
    }
  }
  if (result === -1 && !feedback) denied = 1;
  return { state: s, output: pack(s, result, checksRan, denied) };
}
