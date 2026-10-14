import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { byArea, byVersionDesc, globToRegExp, latestOf, latestRelease, parseAreas, parseStatusZ, scope } from "./scope.ts";

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

const SHA = (c: string) => c.repeat(40);

test("the latest release is the one that the release variable names; each case of L2-release §0 stops", () => {
  const tags = ["20261010.9", "20261010.10", "20261011.1", "notes"];
  const remote: Record<string, string> = { "20261010.10": SHA("b"), "20261011.1": SHA("c"), "20261010.9": SHA("a") };
  const onMain = (sha: string) => sha !== SHA("d");
  const r = latestRelease({ tag: "20261010.10", sha: SHA("b") }, tags, (t) => remote[t] ?? null, onMain);
  assert.deepEqual(r.latest, { name: "20261010.10", commit: SHA("b") });
  assert.deepEqual(r.ignored, [{ tag: "20261011.1", why: "not the release variable" }], "a larger tag is ignored; a smaller one is not listed");
  assert.throws(() => latestRelease({ tag: "20261010.10", sha: SHA("e") }, tags, (t) => remote[t] ?? null, onMain), /at bbbbbbb on origin, not at eeeeeee/, "a moved tag stops");
  assert.throws(() => latestRelease({ tag: "20261012.1", sha: SHA("b") }, tags, (t) => remote[t] ?? null, onMain), /not on origin/, "a deleted tag stops");
  assert.throws(() => latestRelease({ tag: "20261012.1", sha: SHA("d") }, tags, () => SHA("d"), onMain), /origin\/main does not reach/, "a release that main does not reach stops");
  assert.throws(() => latestRelease(null, tags, () => null, onMain), /no release variable RELEASE, but release tags on origin\/main \(20261011\.1, 20261010\.10, 20261010\.9\)/);
  assert.deepEqual(latestRelease(null, ["notes"], () => null, onMain), { latest: null, ignored: [] }, "no variable and no release tag: the first release");
});

// ---------- a real repo, a bare repo as origin, and a fake GitHub ----------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "prerelease-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", `${dir}.git`]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.dev");
  git("config", "user.name", "t");
  git("remote", "add", "origin", "https://github.com/acme/app.git");
  // The URL stays GitHub's (the repo name comes from it); git reaches the bare repo instead (no network).
  git("config", `url.${dir}.git.insteadOf`, "https://github.com/acme/app.git");
  mkdirSync(join(dir, ".agents"));
  writeFileSync(join(dir, ".agents/prerelease.md"), CONFIG);
  const commit = (file: string, msg = file) => {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), msg + Math.random());
    git("add", "-A");
    git("commit", "-q", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  const publish = () => git("push", "-q", "origin", "HEAD:main");
  /** An annotated release tag on HEAD (or on `at`), pushed to origin; it returns the release `<tag> <sha>`. */
  const release_ = (name: string, at = "HEAD") => {
    git("tag", "-a", name, at, "-m", name);
    git("push", "-q", "origin", `refs/tags/${name}`);
    return `${name} ${git("rev-parse", `${name}^{commit}`)}`;
  };
  // The release worktree (L2-release §0), detached at the head of main: scope runs there.
  const rel = `${dir}-release`;
  const release = () => {
    if (existsSync(rel)) execFileSync("git", ["checkout", "-q", "--detach", "main"], { cwd: rel });
    else git("worktree", "add", "-q", "--detach", rel, "main");
    return rel;
  };
  return { dir, git, commit, publish, tag: release_, rel, release };
}

/** GitHub: the owner, the release variable (a value, "error" for HTTP 502, or none: HTTP 404), and the pushes to main (newest first). */
function github(variable: string | "error" | null, pushes: { after: string; actor: string }[] = []) {
  return (path: string): unknown => {
    if (path === "repos/acme/app") return { owner: { login: "owner" } };
    if (path === "repos/acme/app/actions/variables/RELEASE") {
      if (variable === "error") throw new Error("gh: Server Error (HTTP 502)");
      if (variable !== null) return { name: "RELEASE", value: variable };
    }
    if (path.startsWith("repos/acme/app/activity?")) return /page=1$/.test(path) ? pushes.map((p) => ({ after: p.after, actor: { login: p.actor } })) : [];
    throw new Error(`gh: Not Found (HTTP 404) ${path}`);
  };
}

test("no release tag and no variable: the first release, every commit and every area is in scope", () => {
  const r = repo();
  r.commit("mobile/a.ts");
  r.commit("README.md");
  r.publish();
  const s = scope(r.release(), ".agents/prerelease.md", github(null), false);
  assert.equal(s.latest, null);
  assert.equal(s.stop, null);
  assert.equal(s.commits?.length, 2);
  assert.deepEqual(s.steps, ["mobile: the upload to TestFlight"]);
});

test("after the release of the variable: one area changed, then no area, then nothing", () => {
  const r = repo();
  r.commit("mobile/a.ts");
  r.publish();
  const v9 = r.tag("20261010.9");
  r.commit("web/x.ts");
  r.publish();
  let s = scope(r.release(), ".agents/prerelease.md", github(v9), false);
  assert.equal(s.latest, "20261010.9");
  assert.deepEqual(s.outside, ["web/x.ts"]);
  assert.deepEqual(s.steps, [], "a change in no area makes no local step");
  assert.equal(s.stop, null);

  r.commit("packages/p.ts");
  r.publish();
  s = scope(r.release(), ".agents/prerelease.md", github(v9), false);
  assert.deepEqual(s.steps, ["mobile: the upload to TestFlight"]);

  const v10 = r.tag("20261010.10");
  s = scope(r.release(), ".agents/prerelease.md", github(v10), false);
  assert.equal(s.latest, "20261010.10", ".10 is newer than .9");
  assert.match(s.stop ?? "", /nothing changed since 20261010\.10/);

  // A change in the working tree is in scope too.
  writeFileSync(join(r.rel, "mobile/b.ts"), "x");
  s = scope(r.release(), ".agents/prerelease.md", github(v10), false);
  assert.equal(s.stop, null);
  assert.deepEqual(s.worktree, ["mobile/b.ts"]);
});

test("a larger tag that the variable does not name is ignored; the variable's tag is the release", () => {
  const r = repo();
  r.commit("mobile/a.ts");
  r.publish();
  const v1 = r.tag("20261010.1");
  r.commit("web/x.ts");
  r.publish();
  r.tag("20261010.3"); // pushed by someone, never written to the variable
  const s = scope(r.release(), ".agents/prerelease.md", github(v1), false);
  assert.equal(s.latest, "20261010.1");
  assert.deepEqual(s.ignored, [{ tag: "20261010.3", why: "not the release variable" }]);
  assert.deepEqual(s.outside, ["web/x.ts"], "the scope starts at the variable's release, not at the larger tag");
});

test("the tag of the variable deleted or moved on origin (still old in the local repo), or not on main, stops", () => {
  const r = repo();
  const base = r.commit("mobile/a.ts");
  r.publish();
  const v1 = r.tag("20261010.1");
  const next = r.commit("web/x.ts");
  r.publish();
  // Deleted on origin; the local tag stays (a fetch does not remove it).
  r.git("push", "-q", "origin", ":refs/tags/20261010.1");
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github(v1), false), /20261010\.1 of the release variable is not on origin/);
  // Moved on origin to another commit; the local tag still names the old one.
  r.git("tag", "-f", "-a", "20261010.1", next, "-m", "moved");
  r.git("push", "-q", "origin", "refs/tags/20261010.1");
  r.git("tag", "-f", "-a", "20261010.1", base, "-m", "old");
  assert.equal(r.git("rev-parse", "20261010.1^{commit}"), base, "the local tag is the old one");
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github(v1), false), /at [0-9a-f]{7} on origin, not at [0-9a-f]{7} of the release variable/);
  // A release on a side branch: on origin, at the SHA, but origin/main does not reach it.
  r.git("checkout", "-q", "-b", "side");
  r.commit("web/side.ts");
  const side = r.tag("20261010.5");
  r.git("checkout", "-q", "main");
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github(side), false), /origin\/main does not reach 20261010\.5/);
  // The latest release for --latest and changelog: the same stops.
  assert.throws(() => latestOf(r.dir, github(side), false), /origin\/main does not reach/);
});

test("no variable but a release tag on main stops; a variable that cannot be read or has another form stops", () => {
  const r = repo();
  r.commit("mobile/a.ts");
  r.publish();
  const v1 = r.tag("20261010.1");
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github(null), false), /no release variable RELEASE, but release tags on origin\/main \(20261010\.1\): the owner writes the variable first/);
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github("error"), false), /cannot be read: gh: Server Error \(HTTP 502\)/);
  assert.throws(() => scope(r.release(), ".agents/prerelease.md", github(v1.slice(0, 18)), false), /is not "<YYYYMMDD\.N> <40 hex>"/, "a short SHA");
  assert.equal(latestOf(r.dir, github(v1), false)?.name, "20261010.1");
});

test("a push to main that the owner did not make stops the release", () => {
  const r = repo();
  const base = r.commit("mobile/a.ts");
  r.publish();
  const v1 = r.tag("20261010.1");
  const bot = r.commit("web/bot.ts");
  const mine = r.commit("web/mine.ts");
  r.publish();
  const s = scope(r.release(), ".agents/prerelease.md", github(v1, [
    { after: mine, actor: "owner" },
    { after: bot, actor: "cursor[bot]" },
    { after: base, actor: "owner" },
  ]), false);
  assert.match(s.stop ?? "", new RegExp(`${bot.slice(0, 7)} by cursor\\[bot\\]`));
  // The owner looked at it and called again (L2-release §1 step 1): not a stop, and listed; a new push still stops.
  const gh = github(v1, [{ after: mine, actor: "owner" }, { after: bot, actor: "cursor[bot]" }, { after: base, actor: "owner" }]);
  const seen = scope(r.release(), ".agents/prerelease.md", gh, false, [bot.slice(0, 7)]);
  assert.equal(seen.stop, null);
  assert.deepEqual(seen.seen, [{ sha: bot.slice(0, 7), actor: "cursor[bot]" }]);
  assert.match(scope(r.release(), ".agents/prerelease.md", gh, false, ["abc"]).stop ?? "", /cursor\[bot\]/, "a short or wrong SHA counts for nothing");
});

test("only from the release worktree, with a detached HEAD", () => {
  const r = repo();
  r.commit("a.md");
  r.publish();
  const gh = github(null);
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
  r.commit("old.md");
  r.commit("mobile/é.ts");
  r.commit("mobile/ü.ts"); // committed only: not changed in the working tree, so only the committed paths name it
  r.publish();
  const rel = r.release();
  writeFileSync(join(rel, "mobile/a.ts"), "changed");
  writeFileSync(join(rel, "mobile/é.ts"), "changed");
  writeFileSync(join(rel, "mobile/a b.ts"), "new");
  execFileSync("git", ["mv", "old.md", "new.md"], { cwd: rel });
  // No release yet (no variable, no release tag): the committed paths come from `git ls-files`.
  const s = scope(rel, ".agents/prerelease.md", github(null), false);
  assert.equal(s.latest, null);
  assert.deepEqual([...(s.worktree ?? [])].sort(), ["mobile/a b.ts", "mobile/a.ts", "mobile/é.ts", "new.md"]);
  assert.deepEqual([...(s.areas?.mobile ?? [])].sort(), ["mobile/a b.ts", "mobile/a.ts", "mobile/é.ts", "mobile/ü.ts"], "the first letter stays, so the file finds its area");
  assert.deepEqual(s.outside, [".agents/prerelease.md"], "no quoted path falls outside the areas");
  assert.deepEqual(s.steps, ["mobile: the upload to TestFlight"]);
  // After a release tag: the committed paths come from `git diff --name-only`.
  const t = scope(rel, ".agents/prerelease.md", github(r.tag("20261010.1", base)), false);
  assert.equal(t.latest, "20261010.1");
  assert.deepEqual([...(t.areas?.mobile ?? [])].sort(), ["mobile/a b.ts", "mobile/a.ts", "mobile/é.ts", "mobile/ü.ts"], "a committed non-ASCII path finds its area");
  assert.deepEqual(t.outside, [], "no quoted path falls outside the areas");
});
