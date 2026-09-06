import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../src/context.mjs";
import { score, renderTerminal } from "../src/report.mjs";

function contextWith(config) {
  const root = mkdtempSync(join(tmpdir(), "agentready-waive-"));
  writeFileSync(join(root, ".agentready.json"), config);
  try {
    return buildContext(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a waiver needs a written reason", () => {
  assert.deepEqual(contextWith('{"waive":{"linter":"we use biome elsewhere"}}').waived, {
    linter: "we use biome elsewhere",
  });
  assert.deepEqual(contextWith('{"waive":{"linter":""}}').waived, {}, "empty reason is not a waiver");
  assert.deepEqual(contextWith('{"waive":{"linter":true}}').waived, {}, "a bare true is not a waiver");
});

test("malformed config is ignored rather than crashing the audit", () => {
  assert.deepEqual(contextWith("{ not json").waived, {});
});

test("waived checks leave the score alone instead of inflating it", () => {
  const base = [{ weight: 3, status: "pass" }, { weight: 3, status: "fail" }];
  assert.equal(score(base), 50);
  assert.equal(score([...base, { weight: 3, status: "waived" }]), 50);
});

test("a fully waived repo does not divide by zero", () => {
  assert.equal(score([{ weight: 3, status: "waived" }]), 100);
});

test("waived checks stay visible in the report", () => {
  const output = renderTerminal(
    [{ id: "linter", title: "Linter config", weight: 2, status: "waived", detail: "Waived: reason" }],
    { color: false },
  );
  assert.match(output, /WAIV/);
  assert.match(output, /1 waived/);
});
