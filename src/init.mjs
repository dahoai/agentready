// Generate an AGENTS.md seeded from what the repository actually contains.
// Detected commands are written as fenced blocks because agents copy those
// verbatim; anything we cannot detect is left as an explicit TODO rather than
// a plausible guess, so nobody ships instructions that quietly lie.

function detectCommands(ctx) {
  const scripts = ctx.pkg?.scripts ?? {};
  const runner = ctx.has("pnpm-lock.yaml") ? "pnpm" : ctx.has("yarn.lock") ? "yarn" : ctx.has("bun.lockb") ? "bun" : "npm run";
  const install = ctx.has("pnpm-lock.yaml") ? "pnpm install" : ctx.has("yarn.lock") ? "yarn install" : ctx.has("bun.lockb") ? "bun install" : "npm ci";
  const pick = (...names) => {
    const name = names.find((n) => n in scripts);
    return name ? `${runner} ${name}` : null;
  };

  const py = ctx.read("pyproject.toml") ?? "";
  if (!ctx.pkg && py) {
    return {
      install: ctx.has("uv.lock") ? "uv sync" : ctx.has("poetry.lock") ? "poetry install" : "pip install -e .",
      test: /pytest/.test(py) ? "pytest" : null,
      lint: /\[tool\.ruff/.test(py) ? "ruff check ." : null,
      typecheck: /\[tool\.mypy/.test(py) ? "mypy ." : /\[tool\.pyright/.test(py) ? "pyright" : null,
    };
  }
  if (ctx.has("go.mod")) return { install: "go mod download", test: "go test ./...", lint: null, typecheck: "go build ./..." };
  if (ctx.has("Cargo.toml")) return { install: "cargo fetch", test: "cargo test", lint: "cargo clippy", typecheck: "cargo check" };

  return {
    install: ctx.pkg ? install : null,
    test: pick("test"),
    lint: pick("lint"),
    typecheck: pick("typecheck", "tsc", "check-types"),
  };
}

function commandBlock(commands) {
  const rows = [
    ["Install", commands.install],
    ["Test", commands.test],
    ["Lint", commands.lint],
    ["Typecheck", commands.typecheck],
  ];
  return rows
    .map(([label, cmd]) =>
      cmd
        ? `**${label}**\n\n\`\`\`bash\n${cmd}\n\`\`\`\n`
        : `**${label}** — TODO: nothing detected. Fill this in; an agent cannot verify its work without it.\n`,
    )
    .join("\n");
}

function topLevelDirs(ctx) {
  const dirs = new Set();
  for (const file of ctx.files) {
    const [head] = file.split("/");
    if (file.includes("/") && !head.startsWith(".")) dirs.add(head);
  }
  return [...dirs].sort().slice(0, 12);
}

export function renderAgentsMd(ctx) {
  const description = ctx.pkg?.description ?? "TODO: one sentence on what this repository is.";
  const dirs = topLevelDirs(ctx);

  return `# AGENTS.md

${description}

## Commands

Run these before opening a pull request. A change that has not been tested is not finished.

${commandBlock(detectCommands(ctx))}
## Layout

${dirs.length ? dirs.map((d) => `- \`${d}/\` — TODO: what lives here`).join("\n") : "- TODO: describe the module layout"}

## Conventions

- Match the surrounding code. Read neighbouring files before adding a new pattern.
- Do not add a dependency without saying why in the pull request.
- Keep changes scoped to the task. No opportunistic refactors.
- TODO: add the conventions you actually enforce in review — the ones reviewers repeat.

## Before you open a pull request

- [ ] Tests pass locally, and you have said which ones you ran.
- [ ] No debug logging, commented-out code, or unrelated formatting churn.
- [ ] Anything touching auth, billing, migrations, or infrastructure is called out explicitly.

<!-- Scaffolded by agentready. The TODOs are the parts only you can answer;
     an agent will follow this file literally, so leaving them is safer than
     letting anyone guess. -->
`;
}

export const CI_WORKFLOW = `name: verify

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # TODO: replace with this repository's real commands if they differ.
      - run: npm ci
      - run: npm test
`;

export const PR_TEMPLATE = `## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## How it was verified

<!-- The exact commands you ran and what they output. "Should work" is not verification. -->

## Risk

<!-- Anything touching auth, billing, migrations, or infrastructure — say so here. -->
`;
