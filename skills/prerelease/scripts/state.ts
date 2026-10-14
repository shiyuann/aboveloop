/**
 * Where a release stopped (L2-release §1, "Continue after a stop"): the last point that the run reached.
 * The file is `prerelease-state` in the git dir of the release worktree
 * (`git rev-parse --git-dir`, for example `<main folder>/.git/worktrees/<name>/`). It is per worktree,
 * never committed, and `git worktree remove` takes it away with the worktree.
 *
 *   node --experimental-strip-types --no-warnings state.ts [--cwd <release worktree>] write <point>   after the run reaches <point>
 *   node --experimental-strip-types --no-warnings state.ts [--cwd <release worktree>] read            on a resume; it prints one JSON
 *
 * The file has two lines: `version=<the line of VERSION when the point was written>` and `step=<point>`.
 * `write` writes a temp file, then renames it, so a stop never leaves half a file.
 *
 * `read` prints `{ file, step, version, problems }`. No file: `step` is null (a new run, or a stop before step 4).
 * `problems` lists where git does not agree with the point (for example `tagged`, and no local tag;
 * or `version-commit`, and a local tag of the version on another commit than HEAD).
 * With no file, a `version:` commit in `origin/main..HEAD`, or a local version tag that is not on origin, is a problem:
 * a lost file must never send a version commit or a tag of this run back through step 3.
 * It is not empty: the skill stops and names both. It never guesses.
 * The check asks origin for the tag (`git ls-remote --exit-code`): exit 2 is "not on origin";
 * another failure is "origin cannot be read", a problem (fail closed).
 */
import { renameSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { releaseWorktreeOf, run } from "./scope.ts";

/** The points, in the order of a release (SKILL.md "接着上次" has the continuation of each). */
export const POINTS = [
  "bump", // step 4: just before the version command
  "version-commit", // step 4: the commit `version: <V>` is made
  "tagged", // step 4: the local tag is made
  "refix", // "推之前的检查红了": the tag is not on origin; before the move to `<version commit>^`
  "before-push-done", // step 5: every local step before the push passed
  "merge", // step 6: just before `git merge origin/main` (a refused push of main)
  "main-pushed", // step 6: `git push origin HEAD:main` passed
  "tag-pushed", // step 6: `git push origin <V>` passed
  "after-push-done", // step 7: every local step after the push passed
] as const;
export type Point = (typeof POINTS)[number];
export interface State {
  version: string;
  step: Point;
}

export const FILE = "prerelease-state";

export function parseState(text: string): State {
  const m = /^version=(\d{8}\.\d+)\nstep=([a-z-]+)\n?$/.exec(text);
  if (!m || !(POINTS as readonly string[]).includes(m[2])) throw new Error(`not a state file: ${JSON.stringify(text.slice(0, 80))}`);
  return { version: m[1], step: m[2] as Point };
}

const gitOf = (cwd: string) => (...a: string[]) => run("git", a, cwd);

export function statePath(cwd: string): string {
  return join(gitOf(cwd)("rev-parse", "--path-format=absolute", "--git-dir"), FILE);
}

function versionAt(cwd: string): string {
  return readFileSync(join(gitOf(cwd)("rev-parse", "--show-toplevel"), "VERSION"), "utf8").trim();
}

/** Only in the release worktree: the main folder's git dir is shared by its sessions. */
export function writeState(cwd: string, step: string): State {
  if (!(POINTS as readonly string[]).includes(step)) throw new Error(`unknown point ${step}; the points: ${POINTS.join(", ")}`);
  const git = gitOf(cwd);
  const want = releaseWorktreeOf(git);
  const top = realpathSync(git("rev-parse", "--show-toplevel"));
  if (top !== want) throw new Error(`not in the release worktree ${want} (here: ${top})`);
  const s = parseState(`version=${versionAt(cwd)}\nstep=${step}\n`);
  const file = statePath(cwd);
  writeFileSync(`${file}.tmp`, `version=${s.version}\nstep=${s.step}\n`);
  renameSync(`${file}.tmp`, file);
  return s;
}

export function readState(cwd: string): State | null {
  const file = statePath(cwd);
  return existsSync(file) ? parseState(readFileSync(file, "utf8")) : null;
}

/** The tag on origin: its object id, or null (exit 2: not there). Throws when origin cannot be read. */
export type OriginTag = (cwd: string, tag: string) => string | null;
export const lsRemoteTag: OriginTag = (cwd, tag) => {
  const r = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`], { cwd, encoding: "utf8" });
  if (r.status === 2) return null;
  if (r.status === 0) return r.stdout.split(/\s/)[0];
  throw new Error(`origin cannot be read (git ls-remote exit ${r.status}): ${(r.stderr || "").trim().split("\n")[0]}`);
};

/** The version tags on origin (`git ls-remote --tags origin`). Throws when origin cannot be read. */
export type OriginTags = (cwd: string) => Set<string>;
export const lsRemoteTags: OriginTags = (cwd) => {
  const r = spawnSync("git", ["ls-remote", "--tags", "origin"], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`origin cannot be read (git ls-remote exit ${r.status}): ${(r.stderr || "").trim().split("\n")[0]}`);
  return new Set(r.stdout.split("\n").map((l) => /\trefs\/tags\/([^^]+)/.exec(l)?.[1]).filter((t): t is string => !!t));
};

/** The commits `version: <V>` in `origin/main..HEAD`: `<short sha> <subject>`. */
function versionCommits(cwd: string): string[] {
  return gitOf(cwd)("log", "--format=%h %s", "origin/main..HEAD")
    .split("\n")
    .filter((l) => /^\S+ version: /.test(l));
}

/** No state file: a stop before step 4, never after it. A version commit or a local version tag of this run says otherwise. */
export function checkNoFile(cwd: string, originTags: OriginTags = lsRemoteTags): string[] {
  let origin: Set<string>;
  try {
    origin = originTags(cwd);
  } catch (e) {
    return [`no state file: ${(e as Error).message}`];
  }
  const p = versionCommits(cwd).map((c) => `there is no state file, but ${c} is in origin/main..HEAD: a version commit that is not on origin`);
  for (const t of gitOf(cwd)("tag", "-l").split("\n")) {
    if (/^\d{8}\.\d+$/.test(t) && !origin.has(t)) p.push(`there is no state file, but the local tag ${t} is not on origin`);
  }
  return p;
}

/** Where git does not agree with the point. Empty: the point holds, and the resume takes its row. */
export function checkState(cwd: string, s: State, originTag: OriginTag = lsRemoteTag): string[] {
  const git = gitOf(cwd);
  const p: string[] = [];
  const rev = (r: string) => {
    try {
      return git("rev-parse", "-q", "--verify", r);
    } catch {
      return null;
    }
  };
  const ancestor = (a: string, b: string) => spawnSync("git", ["merge-base", "--is-ancestor", a, b], { cwd }).status === 0;
  const V = s.version;
  const head = git("rev-parse", "HEAD");
  const tag = rev(`refs/tags/${V}`); // the tag object
  const tagCommit = rev(`refs/tags/${V}^{commit}`);
  let origin: string | null = null;
  try {
    origin = originTag(cwd, V);
  } catch (e) {
    return [`${s.step}: ${(e as Error).message}`];
  }
  const versionFile = versionAt(cwd);
  const say = (what: string) => p.push(`the state file says ${s.step} (${V}), but ${what}`);

  if (s.step === "bump") return p; // VERSION is the old number, or the new one when the version command ended
  if (s.step === "refix") {
    if (origin) say(`the tag ${V} is on origin: the number is used`);
    if (tagCommit && head !== tagCommit && rev(`${tagCommit}^`) !== head) say(`HEAD ${head.slice(0, 7)} is neither the commit of the local tag ${V} nor its parent`);
    // No local tag: the run deleted it last, after the move to `<version commit>^`. A version commit of V under HEAD
    // then means the tag went by hand, and a redo of step 4 on it would make a second version commit.
    if (!tagCommit) for (const c of versionCommits(cwd).filter((l) => l.endsWith(` version: ${V}`))) say(`there is no local tag ${V}, and ${c} is in origin/main..HEAD`);
    return p;
  }
  if (versionFile !== V) say(`VERSION is ${versionFile}`);
  if (s.step === "version-commit") {
    const subject = git("log", "-1", "--format=%s", "HEAD");
    if (subject !== `version: ${V}`) say(`HEAD is "${subject}", not "version: ${V}"`);
    if (origin) say(`the tag ${V} is on origin: the number is used`);
    // A local tag V on another commit (for example of a run that started over and kept it): `git tag -a V` would fail at each resume.
    if (tagCommit && tagCommit !== head) say(`the local tag ${V} is on ${tagCommit.slice(0, 7)}, not on HEAD ${head.slice(0, 7)}: git tag -a ${V} would fail`);
    return p;
  }
  if (!tagCommit) {
    say(`there is no local tag ${V}`);
    return p;
  }
  if (s.step === "tagged" || s.step === "before-push-done") {
    if (head !== tagCommit) say(`HEAD ${head.slice(0, 7)} is not the commit of the tag ${V} (${tagCommit.slice(0, 7)})`);
    if (origin) say(`the tag ${V} is on origin`);
  } else if (s.step === "merge") {
    if (!ancestor(tagCommit, head)) say(`the commit of the tag ${V} is not under HEAD ${head.slice(0, 7)}`);
    if (origin) say(`the tag ${V} is on origin`);
  } else if (s.step === "main-pushed") {
    if (!ancestor(tagCommit, head)) say(`the commit of the tag ${V} is not under HEAD ${head.slice(0, 7)}`);
    if (!ancestor(head, "origin/main")) say(`origin/main does not hold HEAD ${head.slice(0, 7)}`);
    if (origin && origin !== tag) say(`the tag ${V} on origin is ${origin.slice(0, 7)}, the local one ${tag?.slice(0, 7)}`);
  } else {
    // tag-pushed, after-push-done
    if (origin !== tag) say(origin ? `the tag ${V} on origin is ${origin.slice(0, 7)}, the local one ${tag?.slice(0, 7)}` : `the tag ${V} is not on origin`);
  }
  return p;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { values, positionals } = parseArgs({ options: { cwd: { type: "string" } }, allowPositionals: true });
  const [cmd, point] = positionals;
  const cwd = values.cwd ?? process.cwd();
  try {
    if (cmd === "write" && point) {
      console.log(JSON.stringify(writeState(cwd, point)));
    } else if (cmd === "read") {
      const s = readState(cwd);
      console.log(JSON.stringify({ file: statePath(cwd), step: s?.step ?? null, version: s?.version ?? null, problems: s ? checkState(cwd, s) : checkNoFile(cwd) }, null, 2));
    } else {
      throw new Error("usage: state.ts [--cwd <dir>] write <point> | state.ts [--cwd <dir>] read");
    }
  } catch (e) {
    console.log(JSON.stringify({ problems: [(e as Error).message.split("\n")[0]] }, null, 2));
    process.exit(1);
  }
}
