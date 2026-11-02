# Agent instructions

## Working style

- Keep changes focused and follow the existing code style.
- Prefer simple implementations; avoid unrelated refactors.
- Run relevant checks and report what passed, failed, or was not run.

## Frontend

- Build the application UI with TypeScript and React in `web/app/`.
- Use React state, props and hooks for UI behavior; clean up listeners, timers and requests.
- Run the frontend type, lint and formatting checks along with relevant browser tests.
- Keep pinned game engines and verified artifact inputs separate from application source.

## Commits

When I ask you to commit, write a professional conventional commit message.

- One subject line: a type prefix, a space, then a short imperative summary.
- Keep the summary lowercase and leave off the trailing period.
- Name the change itself. If the commit only adds a target, the subject is about adding that target.
- Add a body when the reason is not clear from the subject. Skip area tags unless I ask for them.

Use these prefixes:

- `feat:` for a new capability or target.
- `fix:` for a bug fix.
- `chore:` for a small maintenance change, including a small readme edit.
- `refactor:` for restructuring code without changing its behavior.
- `test:` for adding or updating tests without changing production behavior.

```text
feat: add the dashy dango target
chore: update the readme
fix: correct the broken link
refactor: share the artifact integrity checks
test: cover adapter collision handling
```

## Pull requests

Use this exact title format:

```text
<type>(<scope>): <short imperative description>
```

- Use `feat` for a new capability, `fix` for a bug fix, `chore` for maintenance, `refactor` for restructuring, and `test` for test coverage.
- Name the affected area in the scope, such as `agent`, `runtime`, or `web`.
- Start the description with a lowercase imperative verb and leave off the trailing period. Preserve proper names such as Meta.

Examples:

```text
feat(agent): add bounded Meta cartridge experiments
fix(runtime): reset input state between replays
chore(docs): update the setup instructions
```

- Explain the problem, the resulting behavior, and why the change fixes it. Use short paragraphs and concrete examples.
- Describe the final diff; omit implementation diaries and generic filler.
- List actual test commands and results. State when a check was not run and why.
- Include screenshots or a short recording when they help demonstrate a visible change.
- Link relevant issues and mention material limitations when applicable.

Use these exact body headings, keeping detail proportional to the change:

```md
## Summary

<Describe the problem and previous behavior.>

<Explain what changes, the resulting behavior, and why this approach fixes it.>

## How did you test this change?

- `<command>` — <actual result>.
- <Manual verification and observed result, when applicable.>
```
