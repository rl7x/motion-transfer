# Motion Transfer implementation checklist

The next phase turns the existing recovery and transfer work into a playable
experience: borrow a move, remix it, and share the result. This checklist follows
the November 2 revision of the Motion Transfer hackathon plan. It records the
implementation order and completion evidence; unchecked items are future work.

## Foundation supplied by the recovery handoff

- Investigations select inspected code and executed evidence, develop candidates,
  freeze them, and run separate acceptance.
- Stage-specific tools and a remaining-request reserve move recovery toward
  candidate development. Development feedback retains measured first divergences
  and preceding frames.
- A newly accepted component receives a JUJUMP delivery only after recipient and
  independent final-ZIP verification. Artifact identities bind the candidate,
  component, task, and archive.
- The UI shows development failures and exposes play/download links only for a
  checked project. Saved recordings remain viewable without inference.
- The measured campaign and later recovery attempts retain their actual failed
  outcomes. The best later candidate passed 10 of 13 development checks; neither
  later trial passed acceptance. The final scheduling fix has local validation,
  not a subsequent successful live recovery.

See [recovery delivery](recovery-handoff.md), [developer measurements](developer-benchmark.md),
and [the recorded campaign](../benchmark/recordings/README.md).

## Implementation order

### 1. Prepare the release inputs

- [ ] Verify and record the proposed ISC distribution basis for the exact donor
  artifact; include the applicable notices in published packages.
- [ ] Confirm the release contains the intended source, evidence, and notices.
- [ ] Make repository visibility and hosting changes as explicit release actions.

Start with [donor provenance](../targets/dashy-dango/README.md). The new plan's
licensing conclusion has not been applied to that record in this preparation PR.

### 2. Deliver the selected accepted component

- [ ] Pass an explicit validated component through Roadster compilation,
  conformance checks, browser builds, and export instead of loading only the
  saved default.
- [ ] Keep historical saved versions identifiable and usable.
- [ ] Check two component identities and reject mixed source, verification, or
  export identities.

Primary paths: `transfer/adapter.mjs`, `evaluator/roadster.mjs`,
`roadster/build.mjs`, `roadster/artifact.mjs`, and `integration/recovery.mjs`.
Until this is complete, a fresh JUJUMP recovery and a saved Roadster transfer are
separate demonstrations.

### 3. Build the playable challenge and publish playback

- [ ] Sweep the native kickflip challenge to find a measured launch that lands
  short without the dash and succeeds with matching inputs plus the dash.
- [ ] Build the play/borrow/remix/share flow in TypeScript and React under
  `web/app/`, with one active 3D player and a pixel-game alternative.
- [ ] Export the exact verified players and downloads to static hosting.
- [ ] Check a cold browser on another device and network.

Keep pinned engines and verified bundles separate from application source. The
existing frontend build depends on Node routes; a static release needs its own
complete asset set. Preserve keyboard/touch controls, focus, reduced motion,
and request cleanup.

### 4. Run the new recovery protocol and expose the workbench

- [ ] Define and test recorded model, reasoning, development-attempt, request,
  time, and spending limits for a new campaign.
- [ ] Add the proposed Contributor model configuration only with matching
  accounting and tool-protocol validation.
- [ ] Obtain an accepted development delivery before starting the frozen
  ten-trial measurement; retain every outcome.
- [ ] Expose the existing typed tools over MCP with the same server-side
  evidence, freeze, and acceptance gates.
- [ ] Verify the isolated Muse Code configuration and report its trials
  separately from the in-app campaign.

The existing campaign and spending journals remain historical records. A new
protocol does not rewrite their outcomes. Recovery scripts that call Meta are
paid experiments, not routine verification commands.

### 5. Enable hosted remix creation

- [ ] Configure public-origin admission, durable jobs, bounded creation, and
  isolated candidate verification.
- [ ] Publish a child only after checks pass; preserve its parent and inherited
  intent, and mirror the accepted player to static hosting.
- [ ] Verify reconnect, restart, parent/child links, and independent downloads.
- [ ] Reserve generation capacity for judges and record the public-data policy.

The initial creative scope remains distance, direction, activation, and
follow-up inheritance. The once-per-flight rule is stretch work in the revised
plan. A static playable gallery alone does not establish live creation.

### 6. Collect useful evidence and record the demo

- [ ] Provide integration instructions and a probe that detects broken adapter
  behavior.
- [ ] Observe developers integrating the component into their own games and
  creators making and sharing variants without coaching.
- [ ] Run the fidelity comparison with a fair baseline and report its limits.
- [ ] Record the native stunt outcome, actual Meta work, a remix, and independent
  use in a three-minute video with upstream attribution.

Keep actual counts and outcomes separate from targets. Prioritize public
playback, a usable remix, and external integration evidence when applying cuts.

## Validation

Follow [the frontend checks](../web/README.md), the relevant runtime and
integration checks, and the [benchmark protocol](developer-benchmark.md).
Run free checks before paid campaigns, and verify the exact deliverable after
changes to the host, component, adapter, or packaging.

This preparation establishes a reviewable starting point. It does not change
model budgets, run paid experiments, contact testers, make the repository
public, or deploy the new experience.
