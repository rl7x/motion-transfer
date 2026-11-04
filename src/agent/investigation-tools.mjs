// Retain the API harness import while MCP uses the same journal-aware executor.
// Model-visible v6 filtering is shared in that executor, after feedback shaping.
export { createJournalToolExecutor as createInvestigationToolRunner } from './journal-tools.mjs';
