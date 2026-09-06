import { test } from "node:test";
import assert from "node:assert/strict";
import { score, grade, renderMarkdown, renderJson } from "../src/report.mjs";

test("score weights failures by blast radius", () => {
  assert.equal(score([{ weight: 3, status: "pass" }]), 100);
  assert.equal(score([{ weight: 3, status: "fail" }]), 0);
  assert.equal(score([{ weight: 2, status: "warn" }]), 50);
  // A heavy failure outweighs a light pass.
  assert.equal(score([{ weight: 3, status: "fail" }, { weight: 1, status: "pass" }]), 25);
});

test("an empty check list does not divide by zero", () => {
  assert.equal(score([]), 100);
});

test("grade boundaries are inclusive at the lower edge", () => {
  assert.equal(grade(90), "A");
  assert.equal(grade(89), "B");
  assert.equal(grade(65), "C");
  assert.equal(grade(49), "F");
});

test("markdown escapes pipes so the table survives", () => {
  const md = renderMarkdown([
    { id: "x", title: "T", weight: 1, status: "warn", detail: "a | b", fix: "do it" },
  ]);
  assert.match(md, /a \\\| b/);
  assert.match(md, /## What to fix, in order/);
});

test("markdown orders fixes with failures first", () => {
  const md = renderMarkdown([
    { id: "w", title: "Warned", weight: 3, status: "warn", detail: "d", fix: "second" },
    { id: "f", title: "Failed", weight: 1, status: "fail", detail: "d", fix: "first" },
  ]);
  // Compare inside the fix list — the table above it keeps declaration order.
  const fixList = md.slice(md.indexOf("## What to fix, in order"));
  assert.ok(fixList.indexOf("Failed") < fixList.indexOf("Warned"));
});

test("json output is machine readable and keeps the fix field", () => {
  const parsed = JSON.parse(
    renderJson([{ id: "x", title: "T", weight: 1, status: "fail", detail: "d", fix: "f" }], { repo: "r" }),
  );
  assert.equal(parsed.repo, "r");
  assert.equal(parsed.grade, "F");
  assert.equal(parsed.checks[0].fix, "f");
});
