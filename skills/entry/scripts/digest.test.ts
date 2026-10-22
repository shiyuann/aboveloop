import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BEGIN, DIGEST, END, ENTRY, extract, isFresh, SKILL } from "./digest.ts";

const ROOT = join(ENTRY, "..", "..");
const HOOKS = join(ROOT, "hooks", "hooks.json");
const MAX_LINES = 60;

/** The command of the one SessionStart hook. */
function command(): string {
  const groups = JSON.parse(readFileSync(HOOKS, "utf8")).hooks.SessionStart;
  return groups[0].hooks[0].command;
}

const runHook = (pluginRoot: string) =>
  spawnSync("/bin/sh", ["-c", command()], { encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } });

test("digest.md is a fresh build of the block in SKILL.md (rebuild: skills/entry/scripts/digest.ts)", () => {
  assert.ok(isFresh(), "skills/entry/digest.md differs from the block; run the script with no option");
});

test(`the digest has at most ${MAX_LINES} lines`, () => {
  const lines = readFileSync(DIGEST, "utf8").trimEnd().split("\n").length;
  assert.ok(lines <= MAX_LINES, `the digest has ${lines} lines`);
});

test("--check exits 1 when digest.md differs, and 0 when it is fresh", () => {
  const dir = mkdtempSync(join(tmpdir(), "digest-"));
  const out = join(dir, "digest.md");
  writeFileSync(out, "old\n");
  assert.equal(isFresh(SKILL, out), false);
  writeFileSync(out, extract(readFileSync(SKILL, "utf8")));
  assert.equal(isFresh(SKILL, out), true);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ENTRY, "scripts", "digest.ts"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("extract: the text between the markers, with one final newline; wrong markers throw", () => {
  assert.equal(extract(`a\n${BEGIN}\n\nx\ny\n\n${END}\nb\n`), "x\ny\n");
  assert.throws(() => extract("no markers"), /one <!-- digest:begin --> line/);
  assert.throws(() => extract(`${BEGIN}\n${BEGIN}\nx\n${END}`), /found 2 and 1/);
  assert.throws(() => extract(`${END}\nx\n${BEGIN}`), /wrong order/);
});

test("hooks.json: one SessionStart group with no matcher, one command hook that is not async", () => {
  const hooks = JSON.parse(readFileSync(HOOKS, "utf8")).hooks;
  assert.deepEqual(Object.keys(hooks), ["SessionStart"]);
  assert.equal(hooks.SessionStart.length, 1);
  const group = hooks.SessionStart[0];
  assert.equal(group.matcher, undefined, "no matcher: the hook runs at startup, resume, clear and compact");
  assert.equal(group.hooks.length, 1);
  assert.equal(group.hooks[0].type, "command");
  assert.notEqual(group.hooks[0].async, true);
});

test("the hook prints the digest, then the path of the full entry", () => {
  const r = runHook(ROOT);
  assert.equal(r.status, 0, r.stderr);
  const digest = readFileSync(DIGEST, "utf8");
  assert.ok(r.stdout.startsWith(digest), r.stdout.slice(0, 200));
  assert.equal(r.stdout.slice(digest.length).trim(), `entry 全文：${SKILL}`);
});

test("the hook exits 0 and still prints the path when digest.md is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "digest-hook-"));
  const r = runHook(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `entry 全文：${join(dir, "skills", "entry", "SKILL.md")}`);
});
