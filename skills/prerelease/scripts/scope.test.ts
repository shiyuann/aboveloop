import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { byArea, byVersionDesc, globToRegExp, latestRelease, parseAreas, parseStatusZ, scope } from "./scope.ts";

const CONFIG = `# prerelease: acme

## Areas

| Area | Paths | Local steps |
| --- | --- | --- |
| mobile | \`mobile/**\`, \`packages/**\` | the upload to TestFlight |
| docs | \`*.md\` | None |

## Commit

None
`;

test("versions compare as numbers: .10 is newer than .9; other names do not count", () => {
  assert.deepEqual(["20261010.9", "20261010.10", "20261009.30"].sort(byVersionDesc), ["20261010.10", "20261010.9", "20261009.30"]);
});

test("the Areas table: paths in backticks; globs", () => {
  const areas = parseAreas(CONFIG);
  assert.deepEqual(areas, [
    { name: "mobile", paths: ["mobile/**", "packages/**"], steps: "the upload to TestFlight" },
    { name: "docs", paths: ["*.md"], steps: "None" },
  ]);
  assert.ok(globToRegExp("mobile/**").test("mobile/app/x.ts"));
  assert.ok(!globToRegExp("*.md").test("docs/a.md"), "* does not cross a folder");
  assert.throws(() => parseAreas("# x\n## Commit\n"), /## Areas/);
  const placed = byArea(["mobile/a.ts", "README.md", "web/x.ts"], areas);
  assert.deepEqual(placed, { areas: { mobile: ["mobile/a.ts"], docs: ["README.md"] }, outside: ["web/x.ts"], steps: ["mobile: the upload to TestFlight"] });
});

test("the latest release: only the owner's tag with the same commit; a record that cannot be read stops", () => {
  const tags = [
    { name: "20261010.9", commit: "a" },
    { name: "20261010.10", commit: "b" },
    { name: "20261011.1", commit: "c" },
  ];
  const records: Record<string, { actor: string; sha: string } | null> = {
    "20261011.1": { actor: "cursor[bot]", sha: "c" },
    "20261010.10": { actor: "owner", sha: "b" },
  };
  const r = latestRelease(tags, "owner", (t) => records[t] ?? null);
  assert.equal(r.latest?.name, "20261010.10");
  assert.deepEqual(r.ignored, [{ tag: "20261011.1", why: "pushed by cursor[bot]" }]);
  assert.equal(latestRelease([{ name: "20261010.10", commit: "z" }], "owner", (t) => records[t] ?? null).latest, null, "a moved tag does not count");
  assert.throws(() => latestRelease(tags, "owner", () => { throw new Error("cannot be read"); }), /cannot be read/);
});

// ---------- a real repo, with a fake GitHub ----------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "prerelease-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.dev");
  git("config", "user.name", "t");
  git("remote", "add", "origin", "https://github.com/acme/app.git");
  mkdirSync(join(dir, ".agents"));
  writeFileSync(join(dir, ".agents/prerelease.md"), CONFIG);
  const commit = (file: string, msg = file) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), msg + Math.random());
    git("add", "-A");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  const publish = () => git("update-ref", "refs/remotes/origin/main", "HEAD");
  // The release worktree (L2-release §0), detached at the head of main: scope runs there.
  const rel = `${dir}-release`;
  const release = () => {
    if (existsSync(rel)) execFileSync("git", ["checkout", "-q", "--detach", "main"], { cwd: rel });
    else git("worktree", "add", "-q", "--detach", rel, "main");
    return rel;
  };
  return { dir, git, commit, publish, rel, release };
}

/** GitHub: the owner, a tag record for each tag, and the pushes to main (newest first). */
function github(records: Record<string, { actor: string; sha: string } | "error">, pushes: { after: string; actor: string }[] = []) {
  return (path: string): unknown => {
    if (path === "repos/acme/app") return { owner: { login: "owner" } };
    const run = /actions\/workflows\/tag-record\.yml\/runs\?event=push&branch=([^&]+)/.exec(path);
    if (run) {
      const r = records[decodeURIComponent(run[1])];
      if (r === "error") throw new Error("HTTP 502");
      return { workflow_runs: r ? [{ actor: { login: r.actor }, head_sha: r.sha }] : [] };
    }
    if (path.startsWith("repos/acme/app/activity?")) return /page=1$/.test(path) ? pushes.map((p) => ({ after: p.after, actor: { login: p.actor } })) : [];
    throw new Error(`HTTP 404 ${path}`);
  };
}

test("no release tag yet: every commit and every area is in scope", () => {
  const r = repo();
  r.commit("mobile/a.ts");
  r.commit("README.md");
  r.publish();
  const s = scope(r.release(), ".agents/prerelease.md", github({}), false);
  assert.equal(s.latest, null);
  assert.equal(s.stop, null);
  assert.equal(s.commits?.length, 2);
  assert.deepEqual(s.steps, ["mobile: the upload to TestFlight"]);
});

test("after the owner's tag: one area changed, then no area, then nothing", () => {
  const r = repo();
  const base = r.commit("mobile/a.ts");
  r.git("tag", "-a", "20261010.9", "-m", "x");
  r.commit("web/x.ts");
  r.publish();
  const gh = github({ "20261010.9": { actor: "owner", sha: base } });
  let s = scope(r.release(), ".agents/prerelease.md", gh, false);
  assert.equal(s.latest, "20261010.9");
  assert.deepEqual(s.outside, ["web/x.ts"]);
  assert.deepEqual(s.steps, [], "a change in no area makes no local step");
  assert.equal(s.stop, null);

  r.commit("packages/p.ts");
  r.publish();
  s = scope(r.release(), ".agents/prerelease.md", gh, false);
  assert.deepEqual(s.steps, ["mobile: the upload to TestFlight"]);

  const head = r.git("rev-parse", "HEAD");
  r.git("tag", "-a", "20261010.10", "-m", "x");
  s = scope(r.release(), ".agents/prerelease.md", github({ "20261010.9": { actor: "owner", sha: base }, "20261010.10": { actor: "owner", sha: head } }), false);
  assert.equal(s.latest, "20261010.10", ".10 is newer than .9");
  assert.match(s.stop ?? "", /nothing changed since 20261010\.10/);

  // A change in the working tree is in scope too.
  writeFileSync(join(r.rel, "mobile/b.ts"), "x");
  s = scope(r.release(), ".agents/prerelease.md", github({ "20261010.10": { actor: "owner", sha: head } }), false);
  assert.equal(s.stop, null);
  assert.deepEqual(s.worktree, ["mobile/b.ts"]);
});

test("a tag that is not on main, and a larger tag that the owner did not push, are not the latest release", () => {
  const r = repo();
  const base = r.commit("mobile/a.ts");
  r.git("tag", "-a", "20261010.1", "-m", "x");
  r.publish();
  r.git("checkout", "-q", "-b", "side");
  r.commit("web/side.ts");
  r.git("tag", "-a", "20261010.5", "-m", "x");
  r.git("checkout", "-q", "main");
  r.commit("web/x.ts");
  r.git("tag", "-a", "20261010.3", "-m", "x");
  r.publish();
  const s = scope(
    r.release(),
    ".agents/prerelease.md",
    github({ "20261010.1": { actor: "owner", sha: base }, "20261010.5": { actor: "owner", sha: "?" }, "20261010.3": { actor: "cursor[bot]", sha: r.git("rev-parse", "HEAD") } }),
    false,
  );
  assert.equal(s.latest, "20261010.1");
  assert.deepEqual(s.ignored, [{ tag: "20261010.3", why: "pushed by cursor[bot]" }], "the side tag is not on main, so it is not even read");
});

test("a push to main that the owner did not make stops the release; a record that cannot be read stops it too", () => {
  const r = repo();
  const base = r.commit("mobile/a.ts");
  r.git("tag", "-a", "20261010.1", "-m", "x");
  const bot = r.commit("web/bot.ts");
  const mine = r.commit("web/mine.ts");
  r.publish();
  const records = { "20261010.1": { actor: "owner", sha: base } };
  const s = scope(r.release(), ".agents/prerelease.md", github(records, [
    { after: mine, actor: "owner" },
    { after: bot, actor: "cursor[bot]" },
    { after: base, actor: "owner" },
  ]), false);
  assert.match(s.stop ?? "", new RegExp(`${bot.slice(0, 7)} by cursor\\[bot\\]`));
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github({ "20261010.1": "error" }), false), /cannot be read/);
  // The owner looked at it and called again (L2-release §1 step 1): not a stop, and listed; a new push still stops.
  const gh = github(records, [{ after: mine, actor: "owner" }, { after: bot, actor: "cursor[bot]" }, { after: base, actor: "owner" }]);
  const seen = scope(r.release(), ".agents/prerelease.md", gh, false, [bot.slice(0, 7)]);
  assert.equal(seen.stop, null);
  assert.deepEqual(seen.seen, [{ sha: bot.slice(0, 7), actor: "cursor[bot]" }]);
  assert.match(scope(r.release(), ".agents/prerelease.md", gh, false, ["abc"]).stop ?? "", /cursor\[bot\]/, "a short or wrong SHA counts for nothing");
});

test("only from the release worktree, with a detached HEAD", () => {
  const r = repo();
  r.commit("a.md");
  r.publish();
  const gh = github({});
  // The release worktree, detached at origin/main: no stop.
  assert.equal(scope(r.release(), ".agents/prerelease.md", gh, false).stop, null);
  // The release worktree at a version commit after origin/main: no stop.
  writeFileSync(join(r.rel, "VERSION"), "20261013.1\n");
  execFileSync("git", ["add", "VERSION"], { cwd: r.rel });
  execFileSync("git", ["commit", "-q", "-m", "version: 20261013.1"], { cwd: r.rel });
  assert.equal(scope(r.rel, ".agents/prerelease.md", gh, false).stop, null);
  // The main folder on main stops.
  assert.match(scope(r.dir, ".agents/prerelease.md", gh, false).stop ?? "", /not in the release worktree .*-release/);
  // Another detached worktree stops.
  const other = `${r.dir}-other`;
  r.git("worktree", "add", "-q", "--detach", other, "main");
  assert.match(scope(other, ".agents/prerelease.md", gh, false).stop ?? "", /not in the release worktree/);
  // A named branch in the release worktree stops.
  execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: r.rel });
  assert.match(scope(r.rel, ".agents/prerelease.md", gh, false).stop ?? "", /on branch feature/);
});

test("the working tree from git status -z: no trim, no quotes, the new path of a rename", () => {
  assert.deepEqual(parseStatusZ(" M knowledge/a.md\0R  new.txt\0old.txt\0?? a b.md\0"), ["knowledge/a.md", "new.txt", "a b.md"]);
  assert.deepEqual(parseStatusZ(""), []);

  // A real repo: an unstaged change as the first line, a path with a space, a non-ASCII path, a rename.
  const r = repo();
  r.git("config", "core.quotepath", "true"); // git's default: a plain `--name-only` or `ls-files` quotes a non-ASCII path
  const base = r.commit("mobile/a.ts");
  r.git("tag", "-a", "20261010.1", "-m", "x");
  r.commit("old.md");
  r.commit("mobile/é.ts");
  r.commit("mobile/ü.ts"); // committed only: not changed in the working tree, so only the committed paths name it
  r.publish();
  const rel = r.release();
  writeFileSync(join(rel, "mobile/a.ts"), "changed");
  writeFileSync(join(rel, "mobile/é.ts"), "changed");
  writeFileSync(join(rel, "mobile/a b.ts"), "new");
  execFileSync("git", ["mv", "old.md", "new.md"], { cwd: rel });
  // No release yet (the tag has no record): the committed paths come from `git ls-files`.
  const s = scope(rel, ".agents/prerelease.md", github({}), false);
  assert.equal(s.latest, null);
  assert.deepEqual([...(s.worktree ?? [])].sort(), ["mobile/a b.ts", "mobile/a.ts", "mobile/é.ts", "new.md"]);
  assert.deepEqual([...(s.areas?.mobile ?? [])].sort(), ["mobile/a b.ts", "mobile/a.ts", "mobile/é.ts", "mobile/ü.ts"], "the first letter stays, so the file finds its area");
  assert.deepEqual(s.outside, [".agents/prerelease.md"], "no quoted path falls outside the areas");
  assert.deepEqual(s.steps, ["mobile: the upload to TestFlight"]);
  // After a release tag: the committed paths come from `git diff --name-only`.
  const t = scope(rel, ".agents/prerelease.md", github({ "20261010.1": { actor: "owner", sha: base } }), false);
  assert.equal(t.latest, "20261010.1");
  assert.deepEqual([...(t.areas?.mobile ?? [])].sort(), ["mobile/a b.ts", "mobile/a.ts", "mobile/é.ts", "mobile/ü.ts"], "a committed non-ASCII path finds its area");
  assert.deepEqual(t.outside, [], "no quoted path falls outside the areas");
});
