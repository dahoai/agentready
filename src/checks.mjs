// The agent-readiness checks.
//
// Each check answers one question: "will a coding agent working in this repo
// produce a mergeable pull request, or a plausible-looking mess?" A check
// returns { status, detail, fix? } where status is pass | warn | fail.
//
// Weights reflect blast radius, not effort. A missing verification loop makes
// every agent PR unverifiable; a missing CODEOWNERS is a nice-to-have.

const pass = (detail) => ({ status: "pass", detail });
const na = (detail) => ({ status: "na", detail });
const warn = (detail, fix) => ({ status: "warn", detail, fix });
const fail = (detail, fix) => ({ status: "fail", detail, fix });

const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"];
const TEST_HINT = /\b(test|spec|pytest|vitest|jest|go test|cargo test)\b/i;

// A repo often carries several of these at once (AGENTS.md plus CLAUDE.md is
// common) and the commands may live in any of them. Checking only the first
// reported a repo as having no test command when its CLAUDE.md named it five
// times, so every check reads all of them.
function instructionFiles(ctx) {
  return INSTRUCTION_FILES.filter((f) => ctx.has(f));
}

// Documentation, prompt, and skills repositories are not software, and the
// code-quality checks below do not apply to them — reporting "no tests" on a
// pile of markdown buries the findings that do matter.
//
// The signal is the ratio, not a file count: a focused five-file library is a
// codebase, while a repo with 2 source files and 319 markdown files is not.
// Requiring markdown to both dominate and clear a floor keeps small real
// codebases (which have a README and little else) on the code path.
function markdownCount(ctx) {
  return ctx.findAll(/\.mdx?$/i).length;
}

function isContentRepo(ctx) {
  // No source files at all is the unambiguous case, and it has to come first:
  // a real marketplace repo had zero source files and one markdown file,
  // so the ratio rule below (which needs 5 markdown files) let it through and
  // graded a repo with no code on whether it had tests.
  if (ctx.sourceFiles.length === 0) return true;
  const markdown = markdownCount(ctx);
  return markdown >= 5 && markdown >= 3 * ctx.sourceFiles.length;
}

function contentRepoNote(ctx) {
  // Zero source files and zero markdown is an empty directory, not a
  // documentation repository. Usually it means someone ran this one level up
  // from the repo they meant, so say that instead of explaining a ratio.
  const markdown = markdownCount(ctx);
  if (markdown === 0 && ctx.sourceFiles.length === 0) {
    return "Not applicable: no source files and no documentation found here — check that this is the directory you meant.";
  }
  return `Not applicable: ${markdown} markdown files against ${ctx.sourceFiles.length} source file(s), so this is a documentation repository rather than software.`;
}

function scriptNames(ctx) {
  return Object.keys(ctx.pkg?.scripts ?? {});
}

export const CHECKS = [
  {
    id: "agent-instructions",
    title: "Agent instructions file",
    weight: 3,
    run(ctx) {
      const files = instructionFiles(ctx);
      if (!files.length) {
        return fail(
          "No AGENTS.md, CLAUDE.md, or equivalent. Every agent starts from zero and guesses your conventions.",
          "npx @dahoai/agentready init",
        );
      }
      const sized = files.map((f) => [f, (ctx.read(f) ?? "").trim().length]).sort((a, b) => b[1] - a[1]);
      const [best, length] = sized[0];
      if (length < 400) {
        return warn(
          `${best} exists but is ${length} characters — too thin to change agent behaviour.`,
          "Document the build/test commands, the module layout, and the conventions you actually enforce in review.",
        );
      }
      return pass(`${best} (${length} characters)`);
    },
  },
  {
    id: "instructions-name-commands",
    title: "Instructions name the build and test commands",
    weight: 3,
    run(ctx) {
      const files = instructionFiles(ctx);
      // A missing instructions file is already a failure on `agent-instructions`.
      // Failing here too would charge a repo twice for one root cause, which
      // both distorts the score and makes "N repos name no test command" read
      // as N repos that have a file and left the command out of it.
      if (!files.length) return na("Not applicable: no instructions file exists — see the check above.");
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));

      const named = files.filter((f) => TEST_HINT.test(ctx.read(f) ?? ""));
      if (!named.length) {
        return fail(
          `${files.join(" and ")} never name a test command, so an agent cannot verify its own work before opening a PR.`,
          "Add a 'Commands' section with the exact test, lint, and typecheck invocations.",
        );
      }
      const fenced = named.find((f) => /```/.test(ctx.read(f) ?? ""));
      if (!fenced) {
        return warn(
          `${named.join(" and ")} mention testing but have no fenced command block — agents copy commands verbatim from code fences.`,
          "Put each command in a fenced code block.",
        );
      }
      return pass(`${fenced} names a test command in a code block`);
    },
  },
  {
    id: "test-command",
    title: "Runnable test command",
    weight: 3,
    run(ctx) {
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));
      if (scriptNames(ctx).includes("test")) return pass("package.json scripts.test");
      const makefile = ctx.read("Makefile");
      if (makefile && /^test:/m.test(makefile)) return pass("Makefile test target");
      const pyproject = ctx.read("pyproject.toml");
      if (pyproject && /pytest|tox|nox/.test(pyproject)) return pass("pyproject.toml test runner");
      if (ctx.find(/^(go\.mod|Cargo\.toml)$/)) return pass("language-native test command");
      return fail(
        "No discoverable test command. An agent has no way to check whether its change works.",
        "Add a `test` script (package.json / Makefile) even if it only runs a smoke test.",
      );
    },
  },
  {
    id: "tests-exist",
    title: "Tests exist",
    weight: 2,
    run(ctx) {
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));
      const tests = ctx.findAll(/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/i);
      if (!tests.length) {
        return fail(
          "No test files found. Agent changes can only be reviewed by reading them, which does not scale.",
          "Add tests for the paths agents are most likely to touch.",
        );
      }
      if (tests.length < 3) return warn(`Only ${tests.length} test file(s) found.`, "Broaden coverage around core paths.");
      return pass(`${tests.length} test files`);
    },
  },
  {
    id: "ci-runs-tests",
    title: "CI runs the tests",
    weight: 3,
    run(ctx) {
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));
      const workflows = ctx.findAll(/^\.github\/workflows\/.+\.ya?ml$/);
      const other = ctx.find(/^(\.gitlab-ci\.yml|\.circleci\/config\.yml|azure-pipelines\.yml)$/);
      if (!workflows.length && !other) {
        return fail(
          "No CI configuration. Nothing independently verifies an agent's pull request.",
          "Add a workflow that runs install, lint, typecheck, and test on every PR.",
        );
      }
      const runsTests = workflows.some((w) => TEST_HINT.test(ctx.read(w) ?? "")) || (other && TEST_HINT.test(ctx.read(other) ?? ""));
      if (!runsTests) {
        return fail(
          "CI exists but no workflow appears to run tests.",
          "Add a test step to the pull_request workflow.",
        );
      }
      return pass(`${workflows.length || 1} workflow(s), tests run in CI`);
    },
  },
  {
    id: "formatter",
    title: "Formatter config",
    weight: 2,
    run(ctx) {
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));
      const config = ctx.find(/^(\.prettierrc|\.prettierrc\.(json|ya?ml|js|cjs|mjs)|prettier\.config\.[cm]?js|biome\.jsonc?|\.editorconfig|rustfmt\.toml|\.clang-format)$/);
      if (config) return pass(config);
      const py = ctx.read("pyproject.toml") ?? "";
      if (/\[tool\.(black|ruff)/.test(py)) return pass("pyproject.toml formatter config");
      if (ctx.find(/^go\.mod$/)) return pass("gofmt (language default)");
      return warn(
        "No formatter config. Agent output drifts from house style and reviews fill up with whitespace noise.",
        "Add Prettier, Biome, or Ruff and run it in CI.",
      );
    },
  },
  {
    id: "linter",
    title: "Linter config",
    weight: 2,
    run(ctx) {
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));
      const config = ctx.find(/^(eslint\.config\.[cm]?js|\.eslintrc(\.(json|ya?ml|js|cjs))?|biome\.jsonc?|\.flake8|\.golangci\.ya?ml|clippy\.toml)$/);
      if (config) return pass(config);
      const py = ctx.read("pyproject.toml") ?? "";
      if (/\[tool\.(ruff|pylint|flake8)/.test(py)) return pass("pyproject.toml linter config");
      return warn(
        "No linter config. Nothing catches the dead code and unused imports agents leave behind.",
        "Add ESLint, Biome, or Ruff and run it in CI.",
      );
    },
  },
  {
    id: "typecheck",
    title: "Type checking",
    weight: 2,
    run(ctx) {
      if (isContentRepo(ctx)) return na(contentRepoNote(ctx));
      // A monorepo often has no root tsconfig, only per-package ones. Judge the
      // root when there is one; otherwise judge every tsconfig we can find,
      // rather than reporting a repo with 73 TypeScript files as untyped.
      const rootTsconfig = ctx.find(/^tsconfig(\..+)?\.json$/);
      const tsconfigs = rootTsconfig ? [rootTsconfig] : ctx.findAll(/(^|\/)tsconfig(\..+)?\.json$/);
      if (tsconfigs.length) {
        const strict = tsconfigs.filter((f) => /"strict"\s*:\s*true/.test(ctx.read(f) ?? ""));
        if (strict.length === tsconfigs.length) {
          return pass(tsconfigs.length === 1 ? `${tsconfigs[0]} with strict: true` : `${tsconfigs.length} tsconfig files, all strict`);
        }
        const loose = tsconfigs.find((f) => !strict.includes(f));
        return warn(
          `${loose} does not enable strict${tsconfigs.length > 1 ? ` (${strict.length} of ${tsconfigs.length} tsconfig files are strict)` : ""}. Agents lean on types to self-correct; loose types remove that signal.`,
          'Set "strict": true in compilerOptions.',
        );
      }
      const py = ctx.read("pyproject.toml") ?? "";
      if (/\[tool\.(mypy|pyright)/.test(py) || ctx.find(/^(mypy\.ini|pyrightconfig\.json)$/)) return pass("Python type checker configured");
      if (ctx.find(/^(go\.mod|Cargo\.toml)$/)) return pass("statically typed language");
      if (ctx.findAll(/\.(ts|tsx)$/).length) return fail("TypeScript sources but no tsconfig.json.", "Add a tsconfig with strict enabled.");
      return warn("No type checking configured.", "Add TypeScript, mypy, or pyright so agents get a fast correctness signal.");
    },
  },
  {
    id: "lockfile",
    title: "Dependency lockfile",
    weight: 2,
    run(ctx) {
      const lock = ctx.find(/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|poetry\.lock|uv\.lock|requirements\.txt|Cargo\.lock|go\.sum|Gemfile\.lock)$/);
      if (lock) return pass(lock);
      if (!ctx.pkg && !ctx.read("pyproject.toml")) return pass("no dependency manifest to lock");
      return fail(
        "No lockfile. An agent's install can resolve different versions than yours, so 'works for me' means nothing.",
        "Commit the lockfile your package manager produces.",
      );
    },
  },
  {
    id: "secret-hygiene",
    title: "Secret hygiene",
    weight: 3,
    run(ctx) {
      // Template files are the recommended pattern, not a leak. Exclude them by
      // suffix rather than inline in the pattern below: buzz tracks
      // `mobile/.env.json.example`, which an inline `(?!example)` lookahead
      // right after `.env` does not catch.
      const isTemplate = /\.(example|sample|template|dist)$/i;
      const tracked = ctx
        .findAll(/(^|\/)\.env(\.|$)|\.pem$|(^|\/)id_(rsa|ed25519)$|\.p12$|(^|\/)credentials\.json$/)
        .filter((f) => !isTemplate.test(f));
      if (tracked.length) {
        return fail(
          `Secret-shaped files are tracked in git: ${tracked.slice(0, 3).join(", ")}. Agents read tracked files and can echo them into logs and PRs.`,
          "Remove them from the index, rotate anything they contained, and add them to .gitignore.",
        );
      }
      const gitignore = ctx.read(".gitignore");
      if (!gitignore) return warn("No .gitignore.", "Add one that ignores .env and credential files.");
      if (!/^\s*\.env/m.test(gitignore)) {
        return warn(
          ".gitignore does not ignore .env files, so the next one created gets committed.",
          "Add `.env` and `.env.*` to .gitignore (keep `!.env.example`).",
        );
      }
      return pass(".env ignored, no secret-shaped files tracked");
    },
  },
  {
    id: "pr-template",
    title: "Pull request template",
    weight: 1,
    run(ctx) {
      if (ctx.find(/^(\.github\/)?(PULL_REQUEST_TEMPLATE|pull_request_template)(\.md)?(\/|$)/i)) return pass("PR template present");
      return warn(
        "No PR template. Agent-authored PRs arrive without a statement of what was verified.",
        "Add .github/PULL_REQUEST_TEMPLATE.md asking what changed and what was run to verify it.",
      );
    },
  },
  {
    id: "codeowners",
    title: "CODEOWNERS",
    weight: 1,
    run(ctx) {
      if (ctx.find(/^(\.github\/|docs\/)?CODEOWNERS$/)) return pass("CODEOWNERS present");
      return warn(
        "No CODEOWNERS, so agent PRs touching sensitive paths get no required human reviewer.",
        "Add CODEOWNERS for auth, billing, migrations, and infrastructure paths.",
      );
    },
  },
  {
    id: "context-bloat",
    title: "Context bloat",
    weight: 2,
    run(ctx) {
      const HUGE = 400 * 1024;
      const generated = /(^|\/)(dist|build|out|vendor|\.next|coverage)\//;
      const bulky = ctx.files
        .filter((f) => !/\.(png|jpe?g|gif|webp|svg|ico|pdf|woff2?|mp4|zip|lock)$/i.test(f))
        .filter((f) => !/lock/i.test(f))
        .map((f) => [f, ctx.size(f)])
        .filter(([, size]) => size > HUGE)
        .sort((a, b) => b[1] - a[1]);
      // Only git tells us what is *tracked*. In walk mode a dist/ directory is
      // probably gitignored build output, so flagging it would be a guess.
      const committedBuild = ctx.source === "git" ? ctx.findAll(generated) : [];

      if (committedBuild.length) {
        return fail(
          `${committedBuild.length} build-output files are tracked (e.g. ${committedBuild[0]}). Agents burn context reading generated code and sometimes edit it instead of the source.`,
          "Remove build output from git and add it to .gitignore.",
        );
      }
      if (bulky.length) {
        const [file, size] = bulky[0];
        return warn(
          `${bulky.length} source file(s) over 400 KB, largest ${file} at ${Math.round(size / 1024)} KB. Files this size crowd out everything else in an agent's context.`,
          "Split the largest files, or exclude them if they are data rather than code.",
        );
      }
      return pass("no oversized or generated files tracked");
    },
  },
  {
    id: "readme-orientation",
    title: "README orients a newcomer",
    weight: 1,
    run(ctx) {
      const readme = ctx.find(/^README(\.md|\.rst|\.txt)?$/i);
      if (!readme) {
        return fail("No README. It is the first file an agent reads.", "Add a README that states what this is and how to run it.");
      }
      const body = (ctx.read(readme) ?? "").replace(/^#.*$/m, "").trim();
      if (body.length < 200) return warn(`${readme} is nearly empty.`, "Say what the project does and how to run it locally.");
      return pass(readme);
    },
  },
];
