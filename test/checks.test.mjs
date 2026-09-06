import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildContext } from "../src/context.mjs";
import { CHECKS } from "../src/checks.mjs";

// Minimum source content so a fixture reads as a codebase rather than a
// documentation repo. Checks that only apply to software are skipped otherwise.
const CODE = { "src/a.js": "export const a = 1;" };

/**
 * Build a throwaway git repo from a { path: contents } map and run one check.
 * Real `git init` + `git add` so checks exercise the tracked-files path they
 * use in production rather than the directory-walk fallback.
 */
function runCheck(id, files) {
  const root = mkdtempSync(join(tmpdir(), "agentready-"));
  try {
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "-Af"], { cwd: root });
    const check = CHECKS.find((c) => c.id === id);
    assert.ok(check, `no check with id ${id}`);
    return check.run(buildContext(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("agent-instructions fails on an empty repo and passes on a real AGENTS.md", () => {
  assert.equal(runCheck("agent-instructions", { "index.js": "" }).status, "fail");
  assert.equal(runCheck("agent-instructions", { "AGENTS.md": "x".repeat(500) }).status, "pass");
});

test("agent-instructions warns on a stub file rather than passing it", () => {
  assert.equal(runCheck("agent-instructions", { "AGENTS.md": "# AGENTS\n\nTODO" }).status, "warn");
});

test("instructions-name-commands fails when no test command is named", () => {
  const missing = runCheck("instructions-name-commands", { ...CODE, "AGENTS.md": "# Guide\n\nBe nice to the code." });
  assert.equal(missing.status, "fail");
  const prose = runCheck("instructions-name-commands", { ...CODE, "AGENTS.md": "Run the test suite before pushing." });
  assert.equal(prose.status, "warn", "a command named only in prose is not copy-pasteable");
  const fenced = runCheck("instructions-name-commands", { ...CODE, "AGENTS.md": "```bash\nnpm test\n```" });
  assert.equal(fenced.status, "pass");
});

test("instructions-name-commands does not charge a repo twice for a missing file", () => {
  // agent-instructions already fails for this; double-counting one root cause
  // distorted the score and the published statistics drawn from it.
  const result = runCheck("instructions-name-commands", { ...CODE, "README.md": "# hi" });
  assert.equal(result.status, "na");
});

test("instructions-name-commands reads every instruction file, not just the first", () => {
  // Regression: a repo whose AGENTS.md never says "test" while its CLAUDE.md
  // says it five times — only the first file was being read.
  const split = runCheck("instructions-name-commands", {
    "AGENTS.md": "# Conventions\n\nBe kind to the code.",
    "CLAUDE.md": "Run the suite:\n\n```bash\nnpm test\n```",
    "src/a.js": "",
  });
  assert.equal(split.status, "pass");
  assert.match(split.detail, /CLAUDE\.md/);

  const neither = runCheck("instructions-name-commands", {
    "AGENTS.md": "# Conventions",
    "CLAUDE.md": "# More conventions",
    "src/a.js": "",
  });
  assert.equal(neither.status, "fail");
  assert.match(neither.detail, /AGENTS\.md and CLAUDE\.md/);
});

test("agent-instructions judges the most substantial file present", () => {
  const result = runCheck("agent-instructions", {
    "AGENTS.md": "# Stub",
    "CLAUDE.md": "x".repeat(500),
  });
  assert.equal(result.status, "pass");
  assert.match(result.detail, /CLAUDE\.md/);
});

test("code-quality checks are not applicable to a documentation repository", () => {
  const docs = Object.fromEntries(
    ["a", "b", "c", "d", "e", "f"].map((n) => [`docs/${n}.md`, "# doc"]),
  );
  for (const id of ["test-command", "tests-exist", "ci-runs-tests", "typecheck", "formatter", "linter"]) {
    assert.equal(runCheck(id, docs).status, "na", `${id} should be n/a on a docs repo`);
  }
});

test("a repo with no source files at all is never judged as code", () => {
  // Regression: a real repo with zero source files and a single
  // markdown file, which slipped past the markdown-dominance floor.
  const empty = { "README.md": "# marketplace", ".claude-plugin/marketplace.json": "{}" };
  assert.equal(runCheck("test-command", empty).status, "na");
  assert.equal(runCheck("ci-runs-tests", empty).status, "na");
});

test("an empty directory is not described as a documentation repository", () => {
  // Zero markdown against zero source is an empty folder, and the ratio
  // explanation reads as nonsense there. Someone running this one level up
  // from their repo sees this sentence first.
  const nothing = runCheck("test-command", { ".gitkeep": "" });
  assert.equal(nothing.status, "na");
  assert.doesNotMatch(nothing.detail, /documentation repository/);
  assert.match(nothing.detail, /directory you meant/);
});

test("a small codebase with a README is still judged as code", () => {
  // The ratio guard must not mistake a focused library for documentation.
  const lib = { "README.md": "# lib", "src/a.js": "", "src/b.js": "", "package.json": "{}" };
  assert.equal(runCheck("test-command", lib).status, "fail");
});

test("secret-hygiene fails on a tracked .env but not on .env.example", () => {
  const leaked = runCheck("secret-hygiene", { ".env": "TOKEN=abc", ".gitignore": ".env\n" });
  assert.equal(leaked.status, "fail");
  const sample = runCheck("secret-hygiene", { ".env.example": "TOKEN=", ".gitignore": ".env\n" });
  assert.equal(sample.status, "pass");
});

test("secret-hygiene treats any template suffix as a template, not a leak", () => {
  // Regression: buzz tracks mobile/.env.json.example, which an exclusion
  // anchored directly after ".env" reported as a tracked secret.
  const nested = runCheck("secret-hygiene", { "mobile/.env.json.example": "TOKEN=", ".gitignore": ".env\n" });
  assert.equal(nested.status, "pass");
  assert.equal(runCheck("secret-hygiene", { "deploy/.env.prod": "TOKEN=abc", ".gitignore": ".env\n" }).status, "fail");
});

test("secret-hygiene warns when .gitignore does not cover .env", () => {
  assert.equal(runCheck("secret-hygiene", { ".gitignore": "node_modules\n" }).status, "warn");
});

test("typecheck warns on a non-strict tsconfig and passes on a strict one", () => {
  assert.equal(runCheck("typecheck", { ...CODE, "tsconfig.json": '{"compilerOptions":{}}' }).status, "warn");
  assert.equal(runCheck("typecheck", { ...CODE, "tsconfig.json": '{"compilerOptions":{"strict": true}}' }).status, "pass");
});

test("typecheck fails when TypeScript sources have no tsconfig at all", () => {
  assert.equal(runCheck("typecheck", { "src/a.ts": "export const a = 1;" }).status, "fail");
});

test("typecheck finds per-package tsconfigs when the monorepo root has none", () => {
  // Regression: a real repo had 73 TypeScript files and four tsconfigs, none at
  // the root, and was reported as having no type checking at all.
  const nested = runCheck("typecheck", {
    "src/a.ts": "export const a = 1;",
    "packages/web/tsconfig.json": '{"compilerOptions":{"strict": true}}',
  });
  assert.equal(nested.status, "pass");

  const mixed = runCheck("typecheck", {
    ...CODE,
    "packages/web/tsconfig.json": '{"compilerOptions":{"strict": true}}',
    "packages/api/tsconfig.json": '{"compilerOptions":{}}',
  });
  assert.equal(mixed.status, "warn");
  assert.match(mixed.detail, /1 of 2/);
});

test("typecheck judges the root tsconfig alone when there is one", () => {
  const result = runCheck("typecheck", {
    ...CODE,
    "tsconfig.json": '{"compilerOptions":{"strict": true}}',
    "fixtures/legacy/tsconfig.json": '{"compilerOptions":{}}',
  });
  assert.equal(result.status, "pass");
});

test("ci-runs-tests distinguishes a workflow that runs tests from one that does not", () => {
  const lintOnly = runCheck("ci-runs-tests", { ...CODE, ".github/workflows/ci.yml": "jobs:\n  lint:\n    steps:\n      - run: npm run lint\n" });
  assert.equal(lintOnly.status, "fail");
  const withTests = runCheck("ci-runs-tests", { ...CODE, ".github/workflows/ci.yml": "jobs:\n  ci:\n    steps:\n      - run: npm test\n" });
  assert.equal(withTests.status, "pass");
});

test("context-bloat fails on committed build output", () => {
  const result = runCheck("context-bloat", { "dist/bundle.js": "// generated" });
  assert.equal(result.status, "fail");
  assert.match(result.detail, /build-output/);
});

test("context-bloat stays quiet outside git, where nothing proves a file is tracked", () => {
  const root = mkdtempSync(join(tmpdir(), "agentready-nogit-"));
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist/bundle.js"), "// generated");
    const ctx = buildContext(root);
    assert.equal(ctx.source, "walk");
    assert.equal(CHECKS.find((c) => c.id === "context-bloat").run(ctx).status, "pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lockfile does not penalise a repo with no dependency manifest", () => {
  assert.equal(runCheck("lockfile", { "main.sh": "echo hi" }).status, "pass");
  assert.equal(runCheck("lockfile", { "package.json": "{}" }).status, "fail");
});

test("a malformed package.json degrades instead of crashing the run", () => {
  const result = runCheck("test-command", { ...CODE, "package.json": "{ not json" });
  assert.equal(result.status, "fail");
});
