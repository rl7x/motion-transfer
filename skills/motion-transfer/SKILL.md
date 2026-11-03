---
name: motion-transfer
description: Records limits of the repo-local motion-transfer host, the unpaid Muse echo preflight, and the refused paid Muse path. Use when changing this repo's MCP server or Muse Code preflight. Do not use it to inspect a donor, recover motion, or run a paid Muse session.
---

# Motion transfer

This skill documents limits. It does not install a Muse Code workbench, and a Muse session cannot call the donor tools through it.

## Typed host

`tests/mcp-server.test.mjs` exercises the stdio server without Muse. A test may grant a turn inside the test process. An ungranted `tools/call` is refused, including a client-supplied turn. Those passes are not a recovery and are not a paid Muse run.

## Echo preflight

The unpaid command is:

```text
node scripts/recover-muse-code.mjs --preflight --out <directory> --phase-ledger <directory> [--muse-binary <path>]
```

The default binary is the pinned `1.3.0-R3057.1` executable from `os.homedir()`: `~/.local/bin/muse-bin-1.3.0-R3057.1`. The process does not assign `HOME`. Do not use the `muse` launcher as the default; it can replace itself. The command fails clearly when that binary or macOS `sandbox-exec` is missing. `npm test` skips only that real-binary preflight and reports the reason.

Echo does not call tools. `tools/call` stays refused unless a trusted turn arrives on `MOTION_MCP_TURN_SOCKET`. A normal Muse session does not open that socket. Listing tools is not a workbench run. Echo is not acceptance and is not a recovery rate. A missing phase ledger is left missing.

## Paid Muse

`node scripts/recover-muse-code.mjs --paid --phase-ledger <directory>` refuses before a Muse process and before creating or reserving a ledger. Paid admission stays closed until a trusted model generation is observed before the tool returns and a token and dollar ceiling can refuse the next request. `--max-model-steps` is not that ceiling.

Settings and isolation are in `docs/muse-code.md`. Registering a cartridge still needs the documented human-mapped boundary.
