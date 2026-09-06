# agentready

Audit a repository for AI-coding-agent readiness, then scaffold what is missing.

This audits a git repository, not a website. If you want `llms.txt` and `/.well-known` checks — whether an agent can use your *product* — that is a different problem, and several similarly named tools solve it.

Teams buy Claude Code and Cursor seats, point them at a repo with no AGENTS.md, no test command an agent can find, and no CI that would catch a mistake — then conclude the agent is bad at coding. Usually the repo is the problem. `agentready` names which part, in the order worth fixing.

```bash
npx @dahoai/agentready .
```

```
  Agent readiness: 68/100  (C)
  Agents produce plausible code that nothing in this repo can verify.

  FAIL  CI runs the tests
        No CI configuration. Nothing independently verifies an agent's pull request.
        -> Add a workflow that runs install, lint, typecheck, and test on every PR.
  WARN  Type checking
        tsconfig.json does not enable strict. Agents lean on types to self-correct;
        loose types remove that signal.
        -> Set "strict": true in compilerOptions.
```

## Commands

```bash
npx @dahoai/agentready [path]                  # audit and print a report
npx @dahoai/agentready [path] --format json    # machine-readable (markdown | json | terminal)
npx @dahoai/agentready [path] --min-score 70   # exit non-zero below the threshold
npx @dahoai/agentready init [path]             # scaffold AGENTS.md, CI, and a PR template
```

`init` writes explicit TODOs where it cannot detect an answer. It will not invent your conventions for you — an agent follows that file literally, so a marked gap is safer than a confident guess.

## In CI

```yaml
- uses: dahoai/agentready@v0
  with:
    min-score: 70
```

Writes the report to the job summary and fails the build below the threshold.

## What it checks

Fourteen checks, weighted by blast radius rather than effort:

| Weight | Checks |
|---|---|
| High | agent instructions exist and name the commands, a runnable test command, CI runs the tests, secret hygiene |
| Medium | tests exist, formatter, linter, type checking, lockfile, context bloat |
| Low | PR template, CODEOWNERS, README orientation |

## Waiving a check

Some checks will not apply to you. Say so in `.agentready.json`:

```json
{
  "waive": {
    "typecheck": "Ruby service; the team ships without a type checker on purpose."
  }
}
```

A waiver needs a written reason. Waived checks are shown in the report and excluded from the score — never counted as passes, because a grade you can inflate is not worth printing.

## Design

Zero runtime dependencies, so `npx @dahoai/agentready` works in any CI job with no install step and no lockfile change. Node 20+.

## License

MIT
