# Firmware recovery

This applies the exhaustive check to code outside games: the logic that decides whether a PX4 flight controller may arm its motors. **No model has recovered it yet.** The first paid session failed, and the verifier below stands without one.

## The target

[`assets/targets/px4-arming/`](../assets/targets/px4-arming/) compiles PX4 v1.14.0's `ArmStateMachine.cpp` into a 1,089-byte WebAssembly binary with no imports. The upstream files are byte-exact. Their dependencies are small stubs, and `boundary.cpp` passes inputs in and packs the results into one integer.

Two of the 36 transition table cells differ from public PX4, so an answer recalled from memory fails. The binary is therefore not PX4's exact behavior.

Humans chose this component, the input domain and the boundary. The model is told nothing about what the binary is, and the inputs and outputs are unnamed.

## The check

The state is the module's whole live memory, so no human names a state field. That only holds because the module has no imports and its one mutable global is the stack pointer, so the check refuses anything else.

From all 6 boot values, a breadth-first search tries all 720 inputs in every state it reaches:

| Measure | Result |
| --- | ---: |
| Reachable states | 2,254 |
| Transitions | 1,622,880 |
| Transitions rechecked with garbage in the dead stack | 1,622,880, no change |
| Hand-written reference controller | Matches on every transition |
| Wrong controllers, including the public PX4 table | 9 of 9 rejected, each with a confirmed shortest failing sequence |

The reference is a test fixture written by hand from the upstream source, not model output. It shows the check can pass, and that the binary behaves like the code it came from.

A cap, a refusal or an unconfirmed trace returns `inconclusive`, which is never a pass.

## Paid sessions

| Session | Protocol | Result | Cost |
| --- | --- | --- | ---: |
| 1 | `firmware-recovery-v1` | Failed. No tool call and no submission | $0.25494 |

Session 1 got the whole disassembly at high effort. Wonder used its full 12,000 token output limit reasoning, and the harness ended the session on the incomplete response. Its [plan](../assets/benchmark/firmware-recovery/plan.json), [result](../assets/benchmark/firmware-recovery/results.json) and exact report stay on the record. It ran from commit `233661e`.

`firmware-recovery-v2` is built and has not run. The model reads the disassembly through a tool at medium effort with a 6,000 token limit, and a truncated response no longer ends the session. A started session is never repeated, so a change of control gets a new name.

## What this does not show

- That a model can recover this logic.
- Anything about flight. This is one component with stubbed dependencies, and nothing here has flown.
- Safety. Don't use this in place of PX4's own checks or testing.
- Behavior outside the declared inputs, or at any time but the one fixed clock value.

## Run it

```sh
npm run verify:firmware
```

This makes no model request. `scripts/build-px4-arming.mjs` rebuilds the binary if you have clang and a WebAssembly linker. The checks use the committed binary and need neither.
