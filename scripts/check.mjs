#!/usr/bin/env node
// Guards the things that silently rot in a multi-document standard: section
// cross-references (§N), internal links, and the version number that has to
// agree across four files. No dependencies by design — this repo must never
// grow a build step.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Blank out fenced code blocks so their contents are never scanned. */
function stripFences(text) {
  return text.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * @param {string} relPath   path of the document, relative to repo root
 * @param {string} text      the document's full text
 * @param {(p: string) => boolean} fileExists  resolves a repo-root-relative path
 * @returns {string[]} human-readable problems; empty when clean
 */
export function checkText(relPath, text, fileExists) {
  const problems = [];

  if (text.startsWith("---\n")) {
    problems.push(`${relPath}: leftover Astro frontmatter — plain markdown only`);
  }

  const body = stripFences(text);

  const sections = new Set();
  // "## N. Title" — dot then space. A changelog's "## 1.7 — date" is not a section.
  for (const m of body.matchAll(/^## (\d+)\. /gm)) sections.add(m[1]);
  // Only documents that define numbered sections can resolve §N against themselves.
  if (sections.size > 0) {
    for (const m of body.matchAll(/§(\d+)/g)) {
      if (!sections.has(m[1])) {
        problems.push(`${relPath}: §${m[1]} does not resolve — no "## ${m[1]}." heading`);
      }
    }
  }

  for (const m of body.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split(/\s+/)[0]; // drop an optional "title"
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    if (target.startsWith("/")) {
      problems.push(`${relPath}: site-absolute link "${target}" — use a relative file path`);
      continue;
    }
    const [path] = target.split("#");
    if (!path) continue;
    const resolved = relative(ROOT, resolve(ROOT, dirname(relPath), path));
    if (!fileExists(resolved)) {
      problems.push(`${relPath}: link target "${target}" does not exist (${resolved})`);
    }
  }

  return problems;
}

/**
 * The version is written in four places and must agree. plugin.json must NOT
 * carry one: a pinned plugin version freezes every consumer until it is bumped
 * (Claude Code only re-fetches a plugin when its version string changes).
 * @param {Record<string, string>} files  keyed by repo-root-relative path
 * @returns {string[]}
 */
export function checkVersions(files) {
  const problems = [];
  const found = {};
  const pkg = files["package.json"] && JSON.parse(files["package.json"]).version;
  if (pkg) found["package.json"] = pkg.split(".").slice(0, 2).join(".");
  const arch = files["standards/architecture.md"]?.match(/\*\*Standard version: (\d+\.\d+)\*\*/);
  if (arch) found["standards/architecture.md"] = arch[1];
  const readme = files["README.md"]?.match(/\*\*Current version: Product Standard v(\d+\.\d+)\.\*\*/);
  if (readme) found["README.md"] = readme[1];
  const log = files["CHANGELOG.md"]?.match(/^## (\d+\.\d+) —/m);
  if (log) found["CHANGELOG.md"] = log[1];

  for (const f of ["package.json", "standards/architecture.md", "README.md", "CHANGELOG.md"]) {
    if (!(f in found)) problems.push(`${f}: no version line found`);
  }
  const distinct = new Set(Object.values(found));
  if (distinct.size > 1) {
    const list = Object.entries(found).map(([f, v]) => `${f}=${v}`).join(", ");
    problems.push(`version mismatch: ${list}`);
  }
  if (files[".claude-plugin/plugin.json"] && "version" in JSON.parse(files[".claude-plugin/plugin.json"])) {
    problems.push(`.claude-plugin/plugin.json: remove "version" — a pinned plugin version freezes consumers until bumped`);
  }
  return problems;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".md") ? [full] : [];
  });
}

// CLI entry: only runs when invoked directly, so importing from tests is side-effect free.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const docs = [...walk(join(ROOT, "standards")), ...walk(join(ROOT, "guides"))];
  const rootDocs = ["README.md", "CHANGELOG.md"].map((f) => join(ROOT, f)).filter(existsSync);
  const exists = (p) => existsSync(join(ROOT, p));
  const problems = [...docs, ...rootDocs].flatMap((f) =>
    checkText(relative(ROOT, f), readFileSync(f, "utf8"), exists),
  );
  const versioned = {};
  for (const f of ["package.json", "standards/architecture.md", "README.md", "CHANGELOG.md", ".claude-plugin/plugin.json"]) {
    if (exists(f)) versioned[f] = readFileSync(join(ROOT, f), "utf8");
  }
  if (Object.keys(versioned).length > 1) problems.push(...checkVersions(versioned));
  if (problems.length) {
    console.error(`${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`✓ ${docs.length + rootDocs.length} document(s) clean`);
}
