#!/usr/bin/env node
// agentready — audit a repository for AI-coding-agent readiness.
//
//   agentready [path]                   audit and print to the terminal
//   agentready [path] --format markdown|json
//   agentready [path] --min-score 70    exit 1 below the threshold (for CI)
//   agentready init [path]              scaffold AGENTS.md, CI, PR template
//
// Zero dependencies on purpose: `npx @dahoai/agentready` should work in any CI job
// without an install step or a lockfile change.

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildContext } from "./context.mjs";
import { CHECKS } from "./checks.mjs";
import { renderTerminal, renderMarkdown, renderJson, score } from "./report.mjs";
import { renderAgentsMd, CI_WORKFLOW, PR_TEMPLATE } from "./init.mjs";

function parseArgs(argv) {
  const opts = { command: "audit", path: ".", format: "terminal", minScore: null, out: null, force: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format") opts.format = argv[++i];
    else if (arg === "--min-score") opts.minScore = Number(argv[++i]);
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--force") opts.force = true;
    else if (arg === "--help" || arg === "-h") opts.command = "help";
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  if (positional[0] === "init") {
    opts.command = "init";
    positional.shift();
  }
  if (positional[0]) opts.path = positional[0];
  return opts;
}

function runChecks(ctx) {
  return CHECKS.map((check) => {
    const reason = ctx.waived?.[check.id];
    if (reason) {
      return { id: check.id, title: check.title, weight: check.weight, status: "waived", detail: `Waived: ${reason}` };
    }
    try {
      return { id: check.id, title: check.title, weight: check.weight, ...check.run(ctx) };
    } catch (error) {
      return {
        id: check.id,
        title: check.title,
        weight: check.weight,
        status: "warn",
        detail: `Check errored: ${error.message}`,
      };
    }
  });
}

function write(path, contents, force) {
  if (existsSync(path) && !force) return `skipped (exists): ${path}`;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return `wrote: ${path}`;
}

const HELP = `agentready — is this repository ready for AI coding agents?

  agentready [path]                 audit and print a report
  agentready [path] --format json   machine-readable output (markdown|json|terminal)
  agentready [path] --min-score 70  exit non-zero below the threshold
  agentready [path] --out FILE      write the report to a file as well
  agentready init [path] [--force]  scaffold AGENTS.md, a CI workflow, and a PR template
`;

const opts = parseArgs(process.argv.slice(2));
if (opts.command === "help") {
  process.stdout.write(HELP);
  process.exit(0);
}

const root = resolve(opts.path);
const ctx = buildContext(root);

if (opts.command === "init") {
  console.log(write(join(root, "AGENTS.md"), renderAgentsMd(ctx), opts.force));
  console.log(write(join(root, ".github/workflows/verify.yml"), CI_WORKFLOW, opts.force));
  console.log(write(join(root, ".github/PULL_REQUEST_TEMPLATE.md"), PR_TEMPLATE, opts.force));
  console.log("\nThe scaffolds contain TODOs on purpose — fill them in before trusting them.");
  process.exit(0);
}

const results = runChecks(ctx);
const repo = root.split("/").filter(Boolean).pop() ?? root;
const output =
  opts.format === "json"
    ? renderJson(results, { repo })
    : opts.format === "markdown"
      ? renderMarkdown(results, { repo })
      : renderTerminal(results, { color: process.stdout.isTTY && !process.env.NO_COLOR });

process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
if (opts.out) writeFileSync(resolve(opts.out), output.endsWith("\n") ? output : `${output}\n`);

if (opts.minScore !== null && score(results) < opts.minScore) {
  console.error(`\nagentready: score ${score(results)} is below --min-score ${opts.minScore}`);
  process.exit(1);
}
