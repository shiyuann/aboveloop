/**
 * Step 1 of prerelease (L2-release §1): what this release holds, and whether it may go.
 * Read-only: git, and GitHub through `gh api`. It prints one JSON.
 *
 *   node --experimental-strip-types --no-warnings scope.ts [--config .agents/prerelease.md] [--cwd <repo>]
 *   node --experimental-strip-types --no-warnings scope.ts --latest [--cwd <repo>]   only the name of the latest release
 *   … scope.ts --seen <sha>[,<sha>…]   pushes that the owner has looked at (L2-release §1 step 1): not a stop, listed in `seen`
 *
 * - The latest release (L2-release §0): the release that the release variable `RELEASE` names
 *   (release-var.ts). Its tag must be on origin (`git ls-remote`, not the local tag) at the SHA of the
 *   variable, and origin/main must reach that commit; else a stop. Each other release tag on origin/main
 *   with a larger version is ignored and listed; the owner decides what to do with it. A variable that cannot be
 *   read, or has another form, stops the scope. No variable: with no release tag on origin/main, this is
 *   the first release (all in scope); with a release tag there, a stop: the owner writes the variable first.
 * - The commits after it on HEAD, and the files of the working tree, each put in its
 *   area of the project configuration. The local steps of those areas.
 * - The pushes to `main` since the latest release that the owner did not make
 *   (GitHub's activity API names who pushed): a stop. The owner looks at them first.
 *
 * - Release only from the release worktree (`<main folder>-release`) with a detached HEAD:
 *   anywhere else, a stop (L2-release §1 step 1).
 *
 * `stop` is null when the release may go on; else the reason, and the skill stops.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NAME, readRelease, type Release, remoteTagCommit } from "./release-var.ts";

const VERSION_RE = /^(\d{8})\.(\d+)$/;

/** `20261010.10` → [20261010, 10]; another name → null. */
export function parseVersion(name: string): [number, number] | null {
  const m = VERSION_RE.exec(name);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Newer first: the date, then the patch, as numbers. */
export function byVersionDesc(a: string, b: string): number {
  const x = parseVersion(a) as [number, number];
  const y = parseVersion(b) as [number, number];
  return y[0] - x[0] || y[1] - x[1];
}

export interface Area {
  name: string;
  paths: string[];
  steps: string;
}

/** A path pattern of the configuration: `**` is any path, `*` any name part, the rest as it is. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The Areas table of `.agents/prerelease.md`: | Area | Paths | Local steps |. */
export function parseAreas(config: string): Area[] {
  const section = /^## Areas[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(config);
  if (!section) throw new Error("the configuration has no section ## Areas");
  const rows = section[1].split("\n").filter((l) => l.trim().startsWith("|"));
  const out: Area[] = [];
  for (const row of rows.slice(2)) {
    const cells = row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 3 || !cells[0]) continue;
    const paths = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!paths.length) throw new Error(`area ${cells[0]}: no paths in backticks`);
    out.push({ name: cells[0], paths, steps: cells[2] });
  }
  return out;
}

/** Each file in the first area that matches it; the rest are outside every area. */
export function byArea(files: string[], areas: Area[]) {
  const matchers = areas.map((a) => ({ a, res: a.paths.map(globToRegExp) }));
  const areasOut: Record<string, string[]> = {};
  const outside: string[] = [];
  for (const f of files) {
    const hit = matchers.find((m) => m.res.some((r) => r.test(f)));
    if (hit) (areasOut[hit.a.name] ??= []).push(f);
    else outside.push(f);
  }
  const steps = areas.filter((a) => areasOut[a.name] && !/^none\.?$/i.test(a.steps)).map((a) => `${a.name}: ${a.steps}`);
  return { areas: areasOut, outside, steps };
}

export interface TagInfo {
  name: string;
  commit: string;
}

/**
 * The latest release (L2-release §0, §1 step 1). `variable` is the release variable (null: missing).
 * `tags`: the release tags that origin/main reaches. `remote(tag)`: the commit of the tag on origin, or null.
 * `onMain(sha)`: origin/main reaches sha. It throws (a stop) on each case of §0 that stops a job; it never
 * falls back to another tag. The other release tags with a larger version are ignored and listed.
 */
export function latestRelease(variable: Release | null, tags: string[], remote: (tag: string) => string | null, onMain: (sha: string) => boolean) {
  const releases = tags.filter((t) => parseVersion(t)).sort(byVersionDesc);
  if (!variable) {
    if (releases.length)
      throw new Error(
        `no release variable ${NAME}, but release tags on origin/main (${releases.slice(0, 3).join(", ")}): the owner writes the variable first (L2-release §0, the first write: release-var.ts write <tag>)`,
      );
    return { latest: null, ignored: [] as { tag: string; why: string }[] };
  }
  const at = remote(variable.tag);
  if (!at) throw new Error(`the tag ${variable.tag} of the release variable is not on origin: the owner looks first`);
  if (at !== variable.sha) throw new Error(`the tag ${variable.tag} is at ${at.slice(0, 7)} on origin, not at ${variable.sha.slice(0, 7)} of the release variable: the owner looks first`);
  if (!onMain(variable.sha)) throw new Error(`origin/main does not reach ${variable.tag} (${variable.sha.slice(0, 7)}): the owner looks first`);
  const ignored = releases.filter((t) => byVersionDesc(t, variable.tag) < 0).map((tag) => ({ tag, why: "not the release variable" }));
  return { latest: { name: variable.tag, commit: variable.sha } as TagInfo, ignored };
}

export interface Push {
  after: string;
  actor: string;
}

/**
 * The pushes to main, newest first, that are on main and after the latest release,
 * and that the owner did not make. `isAncestor(a, b)`: a is in the history of b.
 * Throws when the list ends before it reaches the latest release (fail closed).
 */
export function foreignPushes(
  pushes: Push[],
  opts: { owner: string; head: string; latest: string | null; has: (sha: string) => boolean; isAncestor: (a: string, b: string) => boolean; complete: boolean },
): Push[] {
  const out: Push[] = [];
  for (const p of pushes) {
    if (!opts.has(p.after) || !opts.isAncestor(p.after, opts.head)) continue; // not on main now
    if (opts.latest && opts.isAncestor(p.after, opts.latest)) return out; // reached the latest release
    if (p.actor !== opts.owner) out.push(p);
  }
  if (opts.latest && !opts.complete) throw new Error("the push list of main ends before the latest release: cannot tell who pushed");
  return out;
}

// ---------- the CLI: git and gh ----------

/** The output of a command, with no trim (`git status -z` starts with a space when the first change is not staged). */
export function runRaw(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
}

export function run(cmd: string, args: string[], cwd: string): string {
  return runRaw(cmd, args, cwd).trim();
}

/**
 * The paths of `git status --porcelain -z`: each entry is `XY <path>` and a NUL, with no quotes.
 * A rename or a copy (`R` or `C` in X or Y) has a second field, the old path: keep the new path only.
 */
export function parseStatusZ(out: string): string[] {
  const fields = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.length < 4) continue; // the empty field after the last NUL
    paths.push(f.slice(3));
    if (/[RC]/.test(f.slice(0, 2))) i++; // skip the old path
  }
  return paths;
}

const ok = (f: () => unknown) => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};

/** owner/name from the URL of origin. */
export function repoOf(url: string): string {
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url.trim());
  if (!m) throw new Error(`origin is not a GitHub repo: ${url}`);
  return m[1];
}

/** One GET through `gh api`; it throws with gh's message (for example "HTTP 404"), never a token. */
export type Gh = (path: string) => unknown;

export const ghApi =
  (cwd: string): Gh =>
  (path) => {
    try {
      return JSON.parse(run("gh", ["api", "-H", "Accept: application/vnd.github+json", path], cwd));
    } catch (e) {
      throw new Error(String((e as { stderr?: string }).stderr ?? e).trim().split("\n").pop());
    }
  };

/** owner/name of the repo in `cwd`, from the configured URL of origin. */
export const originRepo = (cwd: string) => repoOf(run("git", ["config", "--get", "remote.origin.url"], cwd));

/** The latest release of the repo in `cwd` (L2-release §0), or null for the first release; it throws on each stop. */
export function latestOf(cwd: string, gh: Gh = ghApi(cwd), fetch = true): TagInfo | null {
  const git = (...a: string[]) => run("git", a, cwd);
  if (fetch) git("fetch", "-q", "origin", "main", "--tags");
  return latestIn(cwd, git, gh).latest;
}

function latestIn(cwd: string, git: (...a: string[]) => string, gh: Gh) {
  const variable = readRelease(gh, originRepo(cwd));
  const tags = git("tag", "--merged", "origin/main").split("\n").filter(Boolean);
  return latestRelease(variable, tags, (tag) => remoteTagCommit(cwd, tag), (sha) => ok(() => git("merge-base", "--is-ancestor", sha, "origin/main")));
}

/** The release worktree (L2-release §0): `<main folder>-release`, beside the main folder of the repo. */
export function releaseWorktreeOf(git: (...a: string[]) => string): string {
  return `${dirname(realpathSync(git("rev-parse", "--path-format=absolute", "--git-common-dir")))}-release`;
}

/** Release only from the release worktree, with a detached HEAD (L2-release §1 step 1); else the reason to stop. */
export function releaseWorktreeStop(git: (...a: string[]) => string, branch: string): string | null {
  const want = releaseWorktreeOf(git);
  const top = realpathSync(git("rev-parse", "--show-toplevel"));
  if (top !== want) return `not in the release worktree ${want} (here: ${top}): release only from there`;
  if (branch !== "HEAD") return `on branch ${branch}: release only with a detached HEAD in the release worktree`;
  return null;
}

/** A push named in `seen` (a full SHA, or a prefix of 7 or more hex characters). */
export const isSeen = (sha: string, seen: string[]) => seen.some((s) => /^[0-9a-f]{7,40}$/i.test(s) && sha.toLowerCase().startsWith(s.toLowerCase()));

export function scope(cwd: string, configPath: string, gh: Gh = ghApi(cwd), fetch = true, seen: string[] = []) {
  const git = (...a: string[]) => run("git", a, cwd);
  const areas = parseAreas(readFileSync(`${cwd}/${configPath}`, "utf8"));
  const repo = originRepo(cwd);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const where = releaseWorktreeStop(git, branch);
  if (where) return { repo, branch, stop: where };
  if (fetch) git("fetch", "-q", "origin", "main", "--tags");
  const owner = (gh(`repos/${repo}`) as { owner: { login: string } }).owner.login;
  const { latest, ignored } = latestIn(cwd, git, gh);
  const head = git("rev-parse", "HEAD");
  const range = latest ? `${latest.commit}..HEAD` : "HEAD";
  const commits = git("log", "--format=%H %s", range).split("\n").filter(Boolean).map((l) => ({ sha: l.slice(0, 7), subject: l.slice(41) }));
  // NUL-separated, with no trim: a plain `--name-only` or `ls-files` quotes a non-ASCII path, and the file misses its area.
  const committedZ = latest ? ["diff", "--name-only", "-z", latest.commit, "HEAD"] : ["ls-files", "-z"];
  const committed = runRaw("git", committedZ, cwd).split("\0").filter(Boolean);
  const worktree = parseStatusZ(runRaw("git", ["status", "--porcelain", "-z", "--untracked-files=all"], cwd));
  const files = [...new Set([...committed, ...worktree])].sort();
  const pushes: Push[] = [];
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const rows = gh(`repos/${repo}/activity?ref=refs/heads/main&per_page=100&page=${page}`) as { after?: string; actor?: { login?: string } }[];
    for (const r of rows) if (r.after && !/^0+$/.test(r.after)) pushes.push({ after: r.after, actor: r.actor?.login ?? "?" });
    if (rows.length < 100) {
      complete = true;
      break;
    }
  }
  const originMain = git("rev-parse", "origin/main");
  const foreign = foreignPushes(pushes, {
    owner,
    head: originMain,
    latest: latest?.commit ?? null,
    has: (sha) => ok(() => git("cat-file", "-e", `${sha}^{commit}`)),
    isAncestor: (a, b) => ok(() => git("merge-base", "--is-ancestor", a, b)),
    complete,
  });
  const placed = byArea(files, areas);
  // The pushes that the owner has looked at in this session do not stop it (L2-release §1 step 1); a new one still does.
  const looked = foreign.filter((p) => isSeen(p.after, seen)).map((p) => ({ sha: p.after.slice(0, 7), actor: p.actor }));
  const unseen = foreign.filter((p) => !isSeen(p.after, seen));
  let stop: string | null = null;
  if (unseen.length)
    stop = `pushes to main that the owner did not make: ${unseen.map((p) => `${p.after.slice(0, 7)} by ${p.actor}`).join(", ")}; the owner looks at them first`;
  else if (latest && !commits.length && !worktree.length) stop = `nothing changed since ${latest.name}`;
  return { repo, owner, branch, head: head.slice(0, 7), latest: latest?.name ?? null, ignored, seen: looked, commits, worktree, ...placed, stop };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const a = parseArgs({ options: { config: { type: "string" }, cwd: { type: "string" }, latest: { type: "boolean" }, seen: { type: "string" } } }).values;
  try {
    if (a.latest) {
      const t = latestOf(a.cwd ?? process.cwd());
      if (!t) throw new Error("no release yet");
      console.log(t.name);
      process.exit(0);
    }
    const seen = (a.seen ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    console.log(JSON.stringify(scope(a.cwd ?? process.cwd(), a.config ?? ".agents/prerelease.md", undefined, true, seen), null, 2));
  } catch (e) {
    console.log(JSON.stringify({ stop: (e instanceof Error ? e.message : String(e)).split("\n")[0] }, null, 2));
    process.exit(1);
  }
}
