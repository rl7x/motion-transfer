# Muse Code workbench

Two different things are tested.

The typed host is a local stdio server. Its journal gates, image bound, and ungranted `tools/call` refusal are covered without Muse. A test can grant a turn in process. That is not a recovery.

The Muse command is an unpaid echo preflight. It is not an operational clean-room recovery. Echo does not call tools. `tools/call` stays refused until a trusted turn arrives on `MOTION_MCP_TURN_SOCKET`, and a normal Muse session does not open that socket. Listing tools during preflight does not mean the workbench ran.

The pinned build is Muse Code `1.3.0-R3057.1`, the build `muse-bin-1.3.0-R3057.1 --version` prints as `Muse Code 1.3.0 (1.3.0-R3057.1)`. The default executable is `~/.local/bin/muse-bin-1.3.0-R3057.1`, from `os.homedir()`, and the process does not assign `HOME`. `--muse-binary` selects another path. Preflight checks that the binary's version output contains that exact build token, so `1.3.0-R3057.10` does not pass. Set `MUSE_NO_AUTO_UPDATE=1`. The `muse` launcher can replace itself, so the default path is the versioned binary.

## Isolation

Keep the real `HOME`. Do not set or forward `CODEX_HOME`. Give the child its own `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME`, and set `MUSE_AUTH_PATH` to `muse/auth.json` under the isolated config directory. Do not read the default auth file. Preflight compares only the default auth file's modification time, before and after, and does not read or print its contents. Preflight runs the child under `sandbox-exec` and denies reads and writes of the default Muse config directory. If `sandbox-exec` or the pinned binary is missing, the requested preflight command fails with that reason. The npm suite skips only that real-binary test, records the reason, and still runs the typed-host tests.

The child environment is an allowlist: `PATH`, the four XDG variables, `MUSE_NO_AUTO_UPDATE`, `MUSE_AUTH_PATH`, the preserved `HOME`, and a few locale variables. Provider credentials are not forwarded.

## Settings and flags

Write only `mcpServers` (schema version 1) with `mode` `required`. On this binary, a file that also contains `mcp_servers` drops the MCP configuration and the run exits 0. A file that contains only `mcp_servers` still loads and can abort startup. The writer never emits `mcp_servers`.

Echo argv:

```text
exec --json --provider echo --prompt-file TASK.md --workspace <clean room>
  --disable-shell --disable-web-tools --no-foreign-personal-context --disable-approval
  --max-model-steps 1
```

Echo rejects `--reasoning-effort` and `--api-key-stdin`. The unexecuted paid argv would add `--provider meta`, `--model muse-spark-1.3-contributor`, `--reasoning-effort high`, and `--api-key-stdin`. `--max-model-steps` is not a dollar or token ceiling.

The clean room contains only `TASK.md`. The journal, including `report.json`, stays outside that directory.

## What the free preflight proves

`node scripts/recover-muse-code.mjs --preflight --out <directory> --phase-ledger <directory> [--muse-binary <path>]` checks the pinned binary version, then runs four echo executions: the typed server, a required server that exits immediately, a settings file with both MCP keys, and a file with only the legacy `mcp_servers` key. It does not call Meta, does not reserve spend, does not grant a Muse session a trusted turn, and does not claim acceptance. If `phase-budget.json` is absent, the command does not create one.

Recorded limits on this build:

- Echo can exit 0 while a model task fails with `provider does not support base instructions`.
- The echo stream has no token usage and does not call tools, so a live tools/call turn binding was not shown. Trusted turns are counted from `task.lifecycle.proposed` events whose `task_kind` matches `model.<provider>.response` or `model.response`. A turn integer inside the event or the tool arguments is ignored. Reminder tasks do not count.
- If Muse block-buffers JSONL until a tool returns, a grant that waits on that stream can deadlock. Paid admission stays closed for that reason.
- Bundled reminder tasks can still appear with `--no-foreign-personal-context`.
- No phase ledger is present in this checkout. Preflight does not create a replacement journal. If a caller supplies an existing ledger that is uncertain or overrun, preflight does not settle or reset it, and a later `reserve` would be refused while that state remains.

## Paid runs

`node scripts/recover-muse-code.mjs --paid --phase-ledger <directory>` throws before spawning Muse and before creating a phase ledger or calling `reserve`. The CLI does not inject an enforceable control. The default control refuses because the step cap is not a spend bound and this client cannot refuse the next billed request. There is no npm alias for this command. `package.json` is owned outside this path, and a one-step installer would advertise a Muse session that cannot call the workbench.

## Later publication

A future accepted run should keep using `saveInvestigationEvidence` and then `finishRecoveryIntegration`. The preflight does not call `finishRecoveryIntegration` and does not mark a component accepted. The stdio server journals through `createJournalToolExecutor`, so stage, attempt, freeze, and one-acceptance gates stay in front of the workbench.
