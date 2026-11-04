# Bounded recovery campaigns

`npm run recover:campaign -- --development --out <new-directory> --phase-ledger <existing-ledger-directory>` starts one paid development trial. It freezes the protocol and executable inputs before inference. Use a detached, committed worktree while other implementation work continues. Pass `--env-file <path>` to load credentials without copying them into that worktree.

The default model is Contributor Spark. `--model muse-wonder-1.0` selects the separate comparison allocation and a $6 trial ceiling. Contributor trials reserve $0.50. A started trial is never automatically repeated; restart only reconciles its durable report. Use a new output directory for a deliberate new development attempt.

New runs use [the v3 recovery harness](wonder-harness.md), with 32 development cases and bounded transition feedback. `--protocol motion-recovery-v2` selects the earlier 13-case suite. `--max-cost-usd <amount>` can lower the model's trial ceiling. These choices are frozen before generation and cannot change on resume.

Only a checked development delivery under the identical protocol can open the ten-trial Contributor campaign. Omit `--development` and supply `--development-report <accepted-development-directory>`. The report retains every result, cost, elapsed time and failure category; the Wilson interval is calculated only after all ten trials finish.

## Allowance and interrupted billing

Opening a ledger preserves its recorded allowance. New ledgers retain the original $45 definition. The explicitly authorized $50 increase must be recorded with `createPhaseBudget(directory).approveAllowanceIncrease({ maxCostUsd: 50, reason })`. Only the reserve allocation increases, from $5 to $10. The migration retains the previous definition, a hash of the preceding journal, the reason and timestamp; every reservation remains intact.

Unknown billing blocks new work by default. If the operator explicitly acknowledges a stopped job's unknown charge, `reconcileBoundedUnknown({ id, reason })` retains its **entire original job ceiling** against the allowance and lets other jobs proceed. It does not guess the charge, free the reserved remainder, or permit that job ID to run again. `status().unresolvedBilling` remains true; known estimates and reserved amounts are reported separately. This is appropriate only when the recorded job ceiling bounded all of that job's requests.

When actual usage becomes available, `settle({ id, estimatedCostUsd, uncertain: false })` records the final estimate and releases only the unused remainder. Known spending cannot decrease. A provider overrun remains recorded and blocks further inference. Never delete, reset or hand-edit a spending journal to resume work.

Local verification: `node --test tests/phase-budget.test.mjs tests/recovery-campaign.test.mjs tests/recovery-protocol.test.mjs`. These tests make no paid requests.
