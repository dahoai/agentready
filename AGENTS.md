# AGENTS.md

`agentready` audits a repository for AI-coding-agent readiness and scaffolds what is missing. It ships as a CLI and a GitHub Action.

## Commands

Run these before opening a pull request. A change that has not been tested is not finished.

**Install**

```bash
npm ci
```

**Test**

```bash
npm test
```

**Audit this repo with itself**

```bash
node src/cli.mjs .
```

There is no lint or typecheck step, and that is deliberate — see Conventions.

## Layout

- `src/context.mjs` — builds the read-only view of a repository. Prefers `git ls-files`; falls back to a directory walk and records which in `ctx.source`.
- `src/checks.mjs` — every check. One exported array, `CHECKS`. Each entry is `{ id, title, weight, run(ctx) }` returning `{ status, detail, fix? }`.
- `src/report.mjs` — scoring plus the terminal, markdown, and JSON renderers.
- `src/init.mjs` — the AGENTS.md, CI, and PR-template scaffolds.
- `src/cli.mjs` — argument parsing and the two commands, `audit` and `init`.
- `test/` — `node:test`, no runner dependency. Fixtures build real throwaway git repos.

## Conventions

- **Zero runtime dependencies.** `npx @dahoai/agentready` must work in any CI job with no install step. A new dependency needs a written justification in the pull request; assume the answer is no.
- **Node's own tooling only** — `node:test` for tests, no ESLint or TypeScript. The project is small enough that adding them would cost more than it catches. If it stops being small, revisit this line rather than working around it.
- **A check earns its place by changing what a reviewer does.** If a team would read the finding and shrug, it does not belong in `CHECKS`.
- **Findings state the consequence, not the rule.** "No lockfile" is a fact; "an agent's install can resolve different versions than yours" is why anyone should care. Write the second.
- **Never guess in output.** `init` writes explicit TODOs where it cannot detect an answer, and `context-bloat` stays silent outside git rather than inferring what is tracked. A plausible wrong answer is worse than a marked gap.
- Weights reflect blast radius, not effort.

## Before you open a pull request

- [ ] `npm test` passes, and you have said so.
- [ ] `node src/cli.mjs .` still scores this repo at A — it is the case study.
- [ ] New checks come with fixture tests covering the pass, warn, and fail paths.
- [ ] No debug logging, commented-out code, or unrelated formatting churn.
