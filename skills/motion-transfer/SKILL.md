---
name: motion-transfer
description: Records the limits of the repo-local motion-transfer host and the unpaid Muse echo preflight. Do not use this skill to inspect a donor or recover motion inside Muse Code. A tools/call is refused without the preflight grant socket, and paid Muse runs stay refused.
---

# Motion transfer

This skill does not make a Muse Code session able to investigate the donor.

Local tests cover the typed host: journal gates, bounded images, and the stdio server. Those tests grant a turn in process, or they prove that an ungranted tools/call is refused. That is not a Muse recovery.

The free command is an unpaid echo preflight. It checks the pinned binary, required MCP startup, and the settings key. Echo does not call tools. tools/call stays refused until a trusted turn arrives on MOTION_MCP_TURN_SOCKET, and a normal Muse session does not open that socket. Listing tools is not a workbench run. Do not treat the preflight as a usable recovery.

Acceptance would be the workbench accept_component result. This preflight does not run one. A process exit code is not acceptance and is not a recovery rate. Do not claim a j/3 recovery rate.

The package script recover:muse-code will be registered as `node scripts/recover-muse-code.mjs`. The caller supplies the flags:

    npm run recover:muse-code -- --preflight --out /tmp/muse-preflight --phase-ledger /tmp/muse-phase-ledger

Optional --muse-binary selects the executable. The default is the pinned 1.3.0-R3401.1 binary under the OS home directory. The command fails if that binary or macOS sandbox-exec is missing. It is not installed globally.

Muse settings use the mcpServers key with mode required. Do not also write mcp_servers; this build drops every server when both keys are present. Contributor mode must not receive personal data. Paid Muse runs are refused until trusted provider turn ids and actual token and dollar ceilings are enforceable. A CLI step cap is not that ceiling.

See docs/muse-code.md.
