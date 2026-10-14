import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { checkNoFile, checkState, lsRemoteTag, parseState, readState, statePath, writeState } from "./state.ts";

const roots: string[] = [];
afterEach(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("the state file: two lines, a known point; anything else is not read", () => {
  assert.deepEqual(parseState("version=20261013.2\nstep=tagged\n"), { version: "20261013.2", step: "tagged" });
  assert.throws(() => parseState("version=20261013.2\nstep=pushed\n"), /not a state file/);
  assert.throws(() => parseState("version=v1\nstep=tagged\n"), /not a state file/);
  assert.throws(() => parseState("version=20261013.2\n"), /not a state file/);
});

/** A bare origin, the main folder `<dir>/main`, and the release worktree `<dir>/main-release` at origin/main. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "prerelease-state-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const main = join(root, "main");
  const rel = `${main}-release`;
  const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", main]);
  for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["commit.gpgsign", "false"], ["tag.gpgsign", "false"]]) sh(main, "config", k, v);
  sh(main, "remote", "add", "origin", origin);
  writeFileSync(join(main, "VERSION"), "20261012.1\n");
  sh(main, "add", "VERSION");
  sh(main, "commit", "-qm", "init");
  sh(main, "push", "-q", "origin", "main");
  sh(main, "worktree", "add", "-q", "--detach", rel, "origin/main");
  const git = (...a: string[]) => sh(rel, ...a);
  /** Step 4 in the release worktree: a new VERSION, the version commit, the local tag. */
  const versionCommit = (v: string) => {
    writeFileSync(join(rel, "VERSION"), `${v}\n`);
    git("commit", "-qam", `version: ${v}`);
  };
  return { root, origin, main, rel, git, sh, versionCommit };
}

test("write: in the git dir of the release worktree, by rename; never in the main folder; it goes with the worktree", () => {
  const r = repo();
  assert.equal(readState(r.rel), null, "no file: a new run");
  const s = writeState(r.rel, "bump");
  assert.deepEqual(s, { version: "20261012.1", step: "bump" });
  const file = statePath(r.rel);
  assert.equal(dirname(file), r.git("rev-parse", "--path-format=absolute", "--git-dir"));
  assert.match(file, /\/\.git\/worktrees\/[^/]+\/prerelease-state$/);
  assert.deepEqual(readdirSync(dirname(file)).filter((f) => f.startsWith("prerelease-state")), ["prerelease-state"], "no temp file stays");
  assert.equal(r.git("status", "--porcelain", "--untracked-files=all"), "", "the file is not in the working tree");
  assert.throws(() => writeState(r.rel, "pushed"), /unknown point/);
  assert.throws(() => writeState(r.main, "bump"), /not in the release worktree/);
  assert.equal(existsSync(join(r.main, ".git", "prerelease-state")), false);
  r.versionCommit("20261013.1");
  assert.deepEqual(writeState(r.rel, "version-commit"), { version: "20261013.1", step: "version-commit" });
  assert.deepEqual(readState(r.rel), { version: "20261013.1", step: "version-commit" });
  r.sh(r.main, "worktree", "remove", r.rel);
  assert.equal(existsSync(file), false, "git worktree remove takes the file away");
});

test("check: each point agrees with git, or the problem names both", () => {
  const r = repo();
  const at = (step: string) => {
    writeState(r.rel, step);
    return checkState(r.rel, readState(r.rel)!);
  };
  assert.deepEqual(at("bump"), []);
  r.versionCommit("20261013.1");
  assert.deepEqual(at("version-commit"), []);
  assert.match(at("tagged")[0], /says tagged \(20261013\.1\), but there is no local tag 20261013\.1/);
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1");
  assert.deepEqual(at("tagged"), []);
  assert.deepEqual(at("before-push-done"), []);
  assert.deepEqual(at("merge"), []);
  assert.match(at("main-pushed").join(";"), /origin\/main does not hold HEAD/);
  r.git("push", "-q", "origin", "HEAD:main");
  r.git("fetch", "-q", "origin");
  assert.deepEqual(at("main-pushed"), []);
  assert.match(at("tag-pushed")[0], /the tag 20261013\.1 is not on origin/);
  r.git("push", "-q", "origin", "20261013.1");
  assert.deepEqual(at("main-pushed"), [], "the tag push passed and the stop came before the write: the same tag, no problem");
  assert.deepEqual(at("tag-pushed"), []);
  assert.deepEqual(at("after-push-done"), []);
  assert.match(at("tagged").join(";"), /the tag 20261013\.1 is on origin/, "a pushed tag is never at tagged");
  assert.match(at("refix")[0], /is on origin: the number is used/);
  assert.match(at("version-commit").join(";"), /is on origin: the number is used/);
});

test("check refix: HEAD is the commit of the local tag or its parent; with no local tag, no version commit of V under HEAD", () => {
  const r = repo();
  r.versionCommit("20261013.1");
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1");
  writeState(r.rel, "refix");
  const s = readState(r.rel)!;
  assert.deepEqual(checkState(r.rel, s), [], "HEAD is the version commit");
  r.git("checkout", "-q", "--detach", "HEAD^");
  assert.deepEqual(checkState(r.rel, s), [], "HEAD is its parent");
  writeFileSync(join(r.rel, "fix.txt"), "fix\n");
  r.git("add", "fix.txt");
  r.git("commit", "-qm", "fix");
  assert.match(checkState(r.rel, s)[0], /neither the commit of the local tag/);
  r.git("tag", "-d", "20261013.1");
  assert.deepEqual(checkState(r.rel, s), [], "the tag is gone: a fix on the parent");
});

test("check refix: the local tag deleted by hand while HEAD is still the version commit is a problem, never a second version", () => {
  const r = repo();
  r.versionCommit("20261013.1");
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1");
  writeState(r.rel, "refix");
  const s = readState(r.rel)!;
  r.git("tag", "-d", "20261013.1");
  assert.match(checkState(r.rel, s).join(";"), /says refix \(20261013\.1\), but there is no local tag 20261013\.1, and [0-9a-f]+ version: 20261013\.1 is in origin\/main\.\.HEAD/);
  writeFileSync(join(r.rel, "fix.txt"), "fix\n");
  r.git("add", "fix.txt");
  r.git("commit", "-qm", "fix");
  assert.equal(checkState(r.rel, s).length, 1, "a fix on top of the version commit: still a problem");
  r.git("checkout", "-q", "--detach", "HEAD~2");
  assert.deepEqual(checkState(r.rel, s), [], "HEAD is the parent of the version commit: the run's own state");
});

test("check version-commit: a local tag V on another commit (a start over that kept it) is a problem with both commits", () => {
  const r = repo();
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1"); // a stopped run's tag, left on origin/main's commit
  const stale = r.git("rev-parse", "--short=7", "HEAD");
  r.versionCommit("20261013.1");
  writeState(r.rel, "version-commit");
  const head = r.git("rev-parse", "--short=7", "HEAD");
  assert.deepEqual(checkState(r.rel, readState(r.rel)!), [
    `the state file says version-commit (20261013.1), but the local tag 20261013.1 is on ${stale}, not on HEAD ${head}: git tag -a 20261013.1 would fail`,
  ]);
  r.git("tag", "-d", "20261013.1");
  assert.deepEqual(checkState(r.rel, readState(r.rel)!), [], "no local tag: the row makes it");
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1");
  assert.deepEqual(checkState(r.rel, readState(r.rel)!), [], "the tag on HEAD: the row only writes tagged");
});

test("no state file: a version commit or a local version tag that is not on origin is a problem; origin unreadable too", () => {
  const r = repo();
  assert.deepEqual(checkNoFile(r.rel), [], "a new worktree at origin/main");
  writeFileSync(join(r.rel, "fix.txt"), "fix\n");
  r.git("add", "fix.txt");
  r.git("commit", "-qm", "fix: a fix inside the release");
  assert.deepEqual(checkNoFile(r.rel), [], "a fix commit and no version commit: keep and rebase");
  r.versionCommit("20261013.1");
  assert.match(checkNoFile(r.rel).join(";"), /no state file, but [0-9a-f]+ version: 20261013\.1 is in origin\/main\.\.HEAD/);
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1");
  assert.match(checkNoFile(r.rel).join(";"), /the local tag 20261013\.1 is not on origin/);
  r.git("checkout", "-q", "--detach", "HEAD^");
  assert.deepEqual(checkNoFile(r.rel), ["there is no state file, but the local tag 20261013.1 is not on origin"], "HEAD moved off the version commit: the local tag still names it");
  r.git("push", "-q", "origin", "20261013.1");
  assert.deepEqual(checkNoFile(r.rel), [], "a tag on origin is a release, not this run's");
  r.git("remote", "set-url", "origin", join(r.root, "gone.git"));
  assert.match(checkNoFile(r.rel)[0], /no state file: origin cannot be read/);
});

test("ls-remote: exit 2 is 'not on origin'; an origin that cannot be read is a problem, never 'not there'", () => {
  const r = repo();
  assert.equal(lsRemoteTag(r.rel, "20261013.1"), null);
  r.versionCommit("20261013.1");
  r.git("tag", "-a", "20261013.1", "-m", "20261013.1");
  writeState(r.rel, "tagged");
  r.git("remote", "set-url", "origin", join(r.root, "gone.git"));
  assert.throws(() => lsRemoteTag(r.rel, "20261013.1"), /origin cannot be read \(git ls-remote exit 128\)/);
  assert.match(checkState(r.rel, readState(r.rel)!)[0], /tagged: origin cannot be read/);
});
