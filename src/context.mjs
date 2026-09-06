// Build the read-only view of a repository that every check runs against.
//
// File discovery prefers `git ls-files` so we see exactly what is tracked —
// that is also what an agent's context window will be filled with. Untracked
// build output and node_modules are noise for both of us. Outside a git repo
// we fall back to a walk with the usual suspects pruned.

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";

const PRUNE = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor",
  ".next", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache",
  "coverage", ".turbo", ".cache",
]);

function walk(root, dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (PRUNE.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, acc);
    else if (entry.isFile()) acc.push(relative(root, full).split(sep).join("/"));
  }
  return acc;
}

// Returns { files, source }. `source` matters: only in git mode do we know
// what is actually tracked, and some checks must not guess without that.
function listFiles(root) {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // Outside a git repo this is an expected miss, not an error worth
      // printing — swallow git's "fatal: not a git repository" on stderr.
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files = out.split("\0").filter(Boolean);
    if (files.length) return { files, source: "git" };
  } catch {
    // not a git repo, or git unavailable — fall through to the walk
  }
  return { files: walk(root, root, []), source: "walk" };
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|php|cs|c|cc|cpp|h|hpp|scala|ex|exs)$/i;
const NON_SOURCE_PATH = /(^|\/)(node_modules|dist|build|out|vendor|\.next|coverage)\//;

export function buildContext(root) {
  const { files, source } = listFiles(root);
  const fileSet = new Set(files);
  const cache = new Map();

  const read = (path) => {
    if (cache.has(path)) return cache.get(path);
    let text = null;
    try {
      text = readFileSync(join(root, path), "utf8");
    } catch {
      text = null;
    }
    cache.set(path, text);
    return text;
  };

  const size = (path) => {
    try {
      return statSync(join(root, path)).size;
    } catch {
      return 0;
    }
  };

  let pkg = null;
  const pkgRaw = fileSet.has("package.json") ? read("package.json") : null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw);
    } catch {
      pkg = null;
    }
  }

  // Optional .agentready.json: { "waive": { "<check-id>": "why" } }.
  // A waiver needs a written reason — an unexplained one is just a mute button,
  // and the report shows waived checks rather than hiding them.
  let waived = {};
  const configRaw = read(".agentready.json");
  if (configRaw) {
    try {
      const config = JSON.parse(configRaw);
      for (const [id, reason] of Object.entries(config.waive ?? {})) {
        if (typeof reason === "string" && reason.trim()) waived[id] = reason.trim();
      }
    } catch {
      waived = {};
    }
  }

  return {
    root,
    files,
    source,
    waived,
    // Tracked, hand-written source files. Used to tell a codebase apart from a
    // documentation or prompt repository, where the code-quality checks do not
    // apply at all.
    sourceFiles: files.filter((f) => SOURCE_EXT.test(f) && !NON_SOURCE_PATH.test(f)),
    pkg,
    read,
    size,
    /** Exact tracked-path lookup. */
    has: (path) => fileSet.has(path),
    /** First tracked path matching a regex, or null. */
    find: (re) => files.find((f) => re.test(f)) ?? null,
    /** All tracked paths matching a regex. */
    findAll: (re) => files.filter((f) => re.test(f)),
    /** Does this path exist on disk even if untracked (e.g. .env)? */
    existsOnDisk: (path) => existsSync(join(root, path)),
  };
}
