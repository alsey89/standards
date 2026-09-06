import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText, checkVersions } from "../scripts/check.mjs";

// Every markdown file is checked in isolation; `fileExists` is injected so the
// tests never touch the filesystem.
const noFiles = () => false;
const allFiles = () => true;

test("accepts a clean document", () => {
  const text = "# T\n\n## 1. One\n\n## 2. Two\n\nSee §2 and [g](guides/x.md).\n";
  assert.deepEqual(checkText("standards/architecture.md", text, allFiles), []);
});

test("flags a section reference with no matching heading", () => {
  const text = "# T\n\n## 1. One\n\nSee §7.\n";
  const problems = checkText("standards/architecture.md", text, allFiles);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /§7/);
});

test("resolves a section reference to a heading that exists", () => {
  const text = "# T\n\n## 1. One\n\n## 7. Seven\n\nSee §7.\n";
  assert.deepEqual(checkText("standards/architecture.md", text, allFiles), []);
});

test("treats a sub-section reference as its parent section", () => {
  const text = "# T\n\n## 5. Five\n\nSee §5.2.\n";
  assert.deepEqual(checkText("standards/architecture.md", text, allFiles), []);
});

test("does not read a changelog version heading as a numbered section", () => {
  const text = "# Changelog\n\n## 1.7 — 2026-09-06\n\nEntries mention §12 of the standard.\n";
  assert.deepEqual(checkText("CHANGELOG.md", text, allFiles), []);
});

test("flags a site-absolute link — these break outside Astro", () => {
  const text = "# T\n\nSee [bootstrap](/guides/bootstrap/).\n";
  const problems = checkText("standards/architecture.md", text, allFiles);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /site-absolute/);
});

test("flags a relative link whose target file is missing", () => {
  const text = "# T\n\nSee [g](guides/gone.md).\n";
  const problems = checkText("standards/architecture.md", text, noFiles);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /guides\/gone\.md/);
});

test("checks a link that carries a title attribute", () => {
  const text = '# T\n\nSee [g](guides/gone.md "The guide").\n';
  const problems = checkText("standards/architecture.md", text, noFiles);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /guides\/gone\.md/);
});

test("ignores external links and anchors", () => {
  const text = "# T\n\n[a](https://example.com) [b](#heading) [c](mailto:x@y.z)\n";
  assert.deepEqual(checkText("standards/architecture.md", text, noFiles), []);
});

test("flags leftover Astro frontmatter", () => {
  const text = '---\ntitle: "T"\n---\n\n# T\n';
  const problems = checkText("standards/architecture.md", text, allFiles);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /frontmatter/);
});

test("ignores section references inside fenced code blocks", () => {
  // The document defines a numbered section, so §-checking is active; the
  // unresolvable §99 must be invisible because it sits inside a fence.
  const text = "# T\n\n## 1. One\n\n```\n§99 in a code fence\n```\n";
  assert.deepEqual(checkText("standards/architecture.md", text, allFiles), []);
});

const agreeing = {
  "package.json": '{ "version": "1.7.0" }',
  "standards/architecture.md": "# T\n\n**Standard version: 1.7** — changelog in [CHANGELOG.md](../CHANGELOG.md).\n",
  "README.md": "# P\n\n**Current version: Product Standard v1.7.**\n",
  "CHANGELOG.md": "# Changelog\n\n## 1.7 — 2026-09-06\n\n## 1.6 — earlier\n",
  ".claude-plugin/plugin.json": '{ "name": "product-standard" }',
};

test("accepts four agreeing version lines", () => {
  assert.deepEqual(checkVersions(agreeing), []);
});

test("flags a README that lags the standard", () => {
  const files = { ...agreeing, "README.md": "**Current version: Product Standard v1.6.**\n" };
  const problems = checkVersions(files);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /README\.md=1\.6/);
});

test("flags a missing version line", () => {
  const files = { ...agreeing, "CHANGELOG.md": "# Changelog\n" };
  const problems = checkVersions(files);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CHANGELOG\.md: no version line/);
});

test("flags a version field in plugin.json — it would freeze consumers", () => {
  const files = { ...agreeing, ".claude-plugin/plugin.json": '{ "name": "p", "version": "1.7.0" }' };
  const problems = checkVersions(files);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /plugin\.json/);
});
