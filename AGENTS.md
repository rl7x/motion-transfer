# Agent instructions

## Working style

- Keep changes focused and follow the existing code style.
- Prefer simple implementations; avoid unrelated refactors.
- Run relevant checks and report what passed, failed, or was not run.

## Pull requests

Use this exact title format:

```text
[area] <Imperative description of the change>
```

Example: `[runtime] Add deterministic input replay`.

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
