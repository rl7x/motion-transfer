# Frontend application

The browser application is React with strict TypeScript in `app/`. Components own UI rendering; hooks own requests, polling, storage and cleanup. The existing Node server, investigation coordinator and runtime continue to use explicit ES modules (`.mjs`). That extension identifies the Node module format and is independent of the browser framework.

```sh
npm install
npm run dev:transfer
```

Open http://127.0.0.1:4173. The existing esbuild dependency compiles `app/main.tsx` into an in-memory production React bundle at server startup. Restart the local server after changing frontend source. No second development server or API proxy is required. Saved demos make no model requests.

## Structure

- `transfer-context.tsx` owns catalog loading, recipient selection, playable routes and browser history. Components use context; the existing window diagnostics remain available for browser automation.
- `components/` contains the players, evidence comparisons, investigations, developer handoff, remixes and static copy. JSX replaces the previous page-wide DOM mutation scripts.
- `hooks/use-job.ts` preserves request identities across interrupted submits and refreshes. Reconnecting a failed status read issues a GET; it does not resubmit the paid job. Polls and event listeners are cleaned up on unmount. Shared status reads keep displayed budgets current.
- `hooks/use-resource.ts` handles cancellable evidence requests. `api.ts` centralizes errors and storage access; `types.ts` describes the existing API and frame contracts. The server remains authoritative for validation, billing, acceptance and artifact identity.
- Player controls use React pointer/keyboard handlers. Message channels check the source frame and token. Polling and fullscreen state updates retain the existing iframe DOM node so gameplay is not restarted by rendering.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build:frontend
npm run test:frontend
```

`npm run format` reformats maintained frontend source, stylesheet, shell and frontend configuration. The formatter excludes pinned engines, compiled components, saved evidence and exported project templates because exact bytes are bound to their verification identities. TypeScript, React Hooks lint rules and a no-explicit-any rule apply to the application. Automatic pull-request checks are off. The workflow has a manual trigger only; if it is disabled in GitHub Actions, enable it before dispatching a run. Manual runs use the same checks with browser tests and no API credentials.

`build:frontend` writes the shell, stylesheet and bundle under ignored `reports/frontend-build/`. Those files require the preview server's game and API routes; the build is not an independent deployment. The independent JUJUMP export remains a separate, verified deliverable.

## Runtime boundary

`boot.js`, `clock.js`, `port.js`, `jujump-boot.js` and `roadster-entry.js` belong to the verified game runtimes rather than the React application. Their existing source identities are retained. The standalone exported project also retains its original source and checks. Migrating the page does not regenerate the recovered component, change spending limits or reinterpret failed investigations.
