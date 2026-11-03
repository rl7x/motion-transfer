// Retain the API harness import while MCP uses the same journal-aware executor.
export { createJournalToolExecutor as createInvestigationToolRunner } from './journal-tools.mjs';
