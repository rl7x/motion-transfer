# Recover a mechanic and keep building

The developer task is to carry a movement mechanic from a compiled game into a new project while retaining the mechanic's supported timing and the recipient's native physics. Dashy Dango → JUJUMP is the working case. Roadster remains the gallery's visual introduction to the same reusable component.

There is a documented developer problem behind this case: [RigelEngine's author](https://lethalguitar.wordpress.com/2017/04/02/introducing-the-rigel-engine-dev-blog/) describes reverse engineering Duke Nukem II to match its original feel and behavior on modern systems when the original source was apparently lost. That supports the use case, not adoption of this project. Our demonstration is a narrow WASM-4 recovery, with Dashy Dango's source withheld from the process. Its source was not actually lost.

## Demonstrate the outcome

1. Play the compiled donor and feel its dash. Open recovery evidence to inspect its rules, code slices and recorded traces.
2. Choose JUJUMP. Play before and after: the ability adds horizontal displacement while native jumping, gravity, platform overlap rules and scrolling continue.
3. Open **Use it in your project**. The case shows the saved Meta recovery, human assistance, failed candidate and repair history, measured behavior and recorded cost.
4. Open the standalone example and run its matched comparison. Actual browser execution measures 8 ordinary horizontal pixels versus 30 dash pixels across eight updates, with vertical difference below `1e-9`. It uses a declared open-air fixture; landing is checked separately. Save that trace if needed.
5. Download the ZIP, extract it, then run `npm test` and `npm start`. The project runs independently on port 4174. Inspect or edit `adapter/adapter.js`; original file hashes and checks make it explicit when an edit invalidates the saved evidence.

## What the developer receives

The ZIP contains the unchanged recovered component source/build, contract and provenance; a separate human-authored adapter; the recipient's unchanged source and generated before/after games; inspectable host hooks; bundled runtime/audio; a local static server; Node verification; recovery/development/acceptance and recipient reports; notices and a content manifest. It needs Node 22+ but no installation, external requests, API credentials, donor cartridge or investigation service. The component itself has no engine dependency.

The configuration remains frozen: 60 Hz, body width 8, eight active ticks, 25 inactive recharge ticks and 10 initial cooldown ticks. A 0.5 horizontal unit conversion gives a 30-pixel JUJUMP dash. The recipient retains its vertical physics and ordinary horizontal movement. Active collision sweeps use the existing JUJUMP policy, including upward side-overlap resolution. Visual trails and presentation effects are outside the recovered component.

## What was measured

`/api/developer-task` is derived from identity-checked saved artifacts, not hand-entered outcome numbers. It includes the 53 saved donor/component traces over 6,744 updates, recorded recovery cost, actual airborne comparison, adapter source length and recovery failure history. The three historical generation/repair requests cost an estimated $0.28511425. Building, downloading and verifying this handoff makes no model request.

`npm run verify:integration` system-unzips the delivered archive into a temporary folder outside the repository. It runs three Node checks and reuses all seven JUJUMP browser scenarios against the standalone server, with outside browser requests blocked. The machine timings cover building, extracting and checking this package only. They are not estimates of developer time, original recovery duration or time saved.

The checked-in recording is `integration/recordings/jujump-validation.json`. It binds the package and ZIP hashes to the observed result, environment and traces. The UI only displays that saved result for a matching export. The downloaded project's own Node checks reproduce 100 saved controller observations and verify all file hashes; they are regression checks, not a new unseen donor acceptance suite.

Human setup, field mapping, boundary selection, evaluator construction, adapter and host work remain disclosed. Human elapsed time, time saved and a comparable baseline are explicitly unmeasured. There is no claim of independent user validation or arbitrary-binary support.

## Recovery and acceptance boundaries

This case reuses the previously accepted Meta component. The incomplete first response and later failed acceptance remain in the package history. Failed acceptance inputs became development evidence before a focused Meta patch; fresh acceptance inputs followed the repaired candidate's freeze. Later workbench investigations are separate and did not produce a new accepted component. Exporting this result does not relabel those explorations as successful recovery.

Existing recipient players, saved children, lineage, remixes, spending controls and investigation endpoints are preserved. A changed server host was rechecked through all PAKU conformance/browser checks and saved as a new artifact; historical artifacts were not overwritten.
