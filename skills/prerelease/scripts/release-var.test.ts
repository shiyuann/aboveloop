import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseRelease, type Release, readRelease, releaseOfTag, remoteTagCommit, writeRelease } from "./release-var.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("the form of the value: a release tag, one space, a full lower-case SHA; nothing else", () => {
  assert.deepEqual(parseRelease(`20261013.4 ${SHA}`), { tag: "20261013.4", sha: SHA });
  assert.equal(parseRelease(`20261013.4 ${SHA.slice(0, 7)}`), null, "a short SHA");
  assert.equal(parseRelease(`20261013.4  ${SHA}`), null, "a second space");
  assert.equal(parseRelease(`20261013.4 ${SHA} `), null, "a space at the end");
  assert.equal(parseRelease(`v20261013.4 ${SHA}`), null, "a name of another form");
  assert.equal(parseRelease(`20261013 ${SHA}`), null, "a name with no patch");
  assert.equal(parseRelease(`20261013.4 ${SHA.toUpperCase()}`), null, "upper case");
  assert.equal(parseRelease(`20261013.4\n${SHA}`), null, "a new line");
  assert.equal(parseRelease(undefined), null);
});

test("a read: 404 is no variable; another error, or another form, throws (never 'no variable')", () => {
  const gh = (answer: unknown) => (path: string) => {
    assert.equal(path, "repos/acme/app/actions/variables/RELEASE");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  assert.deepEqual(readRelease(gh({ name: "RELEASE", value: `20261013.4 ${SHA}` }), "acme/app"), { tag: "20261013.4", sha: SHA });
  assert.equal(readRelease(gh(new Error("gh: Not Found (HTTP 404)")), "acme/app"), null);
  assert.throws(() => readRelease(gh(new Error("gh: Resource not accessible by integration (HTTP 403)")), "acme/app"), /cannot be read: .*HTTP 403/);
  assert.throws(() => readRelease(gh({ name: "RELEASE", value: "20261013.4" }), "acme/app"), /is not "<YYYYMMDD\.N> <40 hex>"/);
});

/** A variable in memory, with the calls of `set`. `echo` changes what the read back gives. */
function store(value: string | null, echo = (v: string) => v) {
  let now = value;
  const sets: string[] = [];
  return {
    sets,
    deps: {
      read: (): Release | null => (now === null ? null : parseRelease(now)),
      set: (v: string) => {
        sets.push(v);
        now = echo(v);
      },
    },
  };
}

test("a write: never an older release over a newer one; the read back must give the value", () => {
  const want = { tag: "20261013.4", sha: SHA };
  const first = store(null);
  assert.equal(writeRelease(want, first.deps), "written", "the first write");
  assert.deepEqual(first.sets, [`20261013.4 ${SHA}`]);

  const older = store(`20261013.3 ${"a".repeat(40)}`);
  assert.equal(writeRelease(want, older.deps), "written");

  const larger = store(`20261013.10 ${"a".repeat(40)}`);
  assert.throws(() => writeRelease(want, larger.deps), /names 20261013\.10, a larger version than 20261013\.4/, ".10 is larger than .4");
  assert.deepEqual(larger.sets, [], "nothing is written");

  const same = store(`20261013.4 ${SHA}`);
  assert.equal(writeRelease(want, same.deps), "already", "a resume at tag-pushed");
  assert.deepEqual(same.sets, []);

  const moved = store(`20261013.4 ${"b".repeat(40)}`);
  assert.throws(() => writeRelease(want, moved.deps), /at b{40}, not at/);
  assert.deepEqual(moved.sets, []);

  const lost = store(null, () => `20261013.3 ${SHA}`);
  assert.throws(() => writeRelease(want, lost.deps), /read back gives 20261013\.3 .*, not 20261013\.4/);

  assert.throws(() => writeRelease({ tag: "20261013.4", sha: SHA.slice(0, 7) }, store(null).deps), /not a release/);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "release-var-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", `${dir}.git`]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.dev");
  git("config", "user.name", "t");
  git("remote", "add", "origin", "https://github.com/acme/app.git");
  git("config", `url.${dir}.git.insteadOf`, "https://github.com/acme/app.git"); // a bare repo as origin: no network
  const commit = (msg: string) => {
    writeFileSync(join(dir, "f"), msg);
    git("add", "-A");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  return { dir, git, commit };
}

test("the SHA of an annotated tag is its commit, not the tag object; the tag must be on origin and on origin/main", () => {
  const r = repo();
  r.commit("work");
  r.git("push", "-q", "origin", "HEAD:main");
  const c = r.commit("version: 20261013.4");
  r.git("tag", "-a", "20261013.4", "-m", "20261013.4");
  const object = r.git("rev-parse", "20261013.4");
  assert.notEqual(object, c, "an annotated tag is an object of its own");
  assert.throws(() => releaseOfTag(r.dir, "20261013.4"), /origin has no tag 20261013\.4: push it first/);
  assert.equal(remoteTagCommit(r.dir, "20261013.4"), null);
  r.git("push", "-q", "origin", "refs/tags/20261013.4");
  assert.equal(remoteTagCommit(r.dir, "20261013.4"), c, "the peeled line: the commit, as commit.sha of GET …/tags");
  assert.throws(() => releaseOfTag(r.dir, "20261013.4"), /origin\/main does not reach 20261013\.4/, "the tag before main");
  r.git("push", "-q", "origin", "HEAD:main");
  assert.deepEqual(releaseOfTag(r.dir, "20261013.4"), { tag: "20261013.4", sha: c });
  // The tag moved on origin: the local tag is not the release that origin has.
  const d = r.commit("next");
  r.git("push", "-q", "origin", "HEAD:main");
  r.git("push", "-q", "-f", "origin", `${d}:refs/tags/20261013.4`);
  assert.throws(() => releaseOfTag(r.dir, "20261013.4"), new RegExp(`is at ${d} on origin, not at ${c}`));
  assert.throws(() => releaseOfTag(r.dir, "notes"), /not a release tag/);
  assert.throws(() => releaseOfTag(r.dir, "20261013.9"), /no local tag 20261013\.9/);
});

test("the command line: write stops with one line and exit 1, and calls no gh, when the tag is not on origin", () => {
  const r = repo();
  r.commit("version: 20261013.4");
  r.git("tag", "-a", "20261013.4", "-m", "20261013.4");
  const cli = fileURLToPath(new URL("./release-var.ts", import.meta.url));
  // No gh on PATH: a call of gh would fail with another message.
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, "write", "20261013.4", "--cwd", r.dir], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", HOME: r.dir },
  });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.stdout, "stop: origin has no tag 20261013.4: push it first (the variable comes after the push)\n");
  assert.equal(spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", cli, "list"], { encoding: "utf8" }).status, 2);
});
