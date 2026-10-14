/**
 * The release variable (L2-release §0): the repository variable `RELEASE` of a project, `<tag> <sha>`.
 * The tag is the name of the latest release; the SHA is the full commit of that tag (not the tag object).
 * Only `prerelease` writes it, on the owner's Mac, with the owner's `gh` login, after the push of the tag
 * (L2-release §1 step 6). No token of the loops can write it (L2-release §2.3).
 *
 *   node --experimental-strip-types --no-warnings release-var.ts read [--cwd <repo>]          prints `<tag> <sha>`
 *   node --experimental-strip-types --no-warnings release-var.ts write <tag> [--cwd <repo>]   after the push of the tag
 *
 * `write` stops (exit 1, one line `stop: …`), and writes nothing, when:
 * - the tag is not a release tag `YYYYMMDD.N`, or origin does not have it at the commit of the local tag;
 * - `origin/main` does not reach that commit (a reader stops on it: L2-release §0);
 * - the variable cannot be read, or has another form;
 * - the variable names a larger version: never an older release over a newer one;
 * - the variable names the same version at another commit.
 * It writes nothing when the variable already names this release (a resume at `tag-pushed`).
 * After the write it reads the variable back, and stops when the value differs.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { byVersionDesc, type Gh, ghApi, parseVersion, repoOf, run } from "./scope.ts";

export const NAME = "RELEASE";
const FORM = /^(\d{8}\.\d+) ([0-9a-f]{40})$/;

export interface Release {
  tag: string;
  sha: string;
}

/** `<tag> <sha>` (one space, a full lower-case SHA), else null. */
export function parseRelease(value: unknown): Release | null {
  const m = typeof value === "string" ? FORM.exec(value) : null;
  return m ? { tag: m[1], sha: m[2] } : null;
}

export const formatRelease = (r: Release) => `${r.tag} ${r.sha}`;

/**
 * The release variable of `repo`: null when it is missing (HTTP 404). It throws when it cannot be
 * read (another error) or has another form: a reader stops then, it never takes "no variable".
 */
export function readRelease(gh: Gh, repo: string): Release | null {
  let res: { value?: unknown };
  try {
    res = gh(`repos/${repo}/actions/variables/${NAME}`) as typeof res;
  } catch (e) {
    if (/HTTP 404/.test(String(e))) return null;
    throw new Error(`the release variable ${NAME} of ${repo} cannot be read: ${String(e instanceof Error ? e.message : e).split("\n")[0]}`);
  }
  const r = parseRelease(res?.value);
  if (!r) throw new Error(`the release variable ${NAME} of ${repo} is not "<YYYYMMDD.N> <40 hex>": ${JSON.stringify(String(res?.value ?? "")).slice(0, 80)}`);
  return r;
}

/**
 * The commit of a tag on origin (`git ls-remote`: the peeled line `^{}` of an annotated tag, else the tag's
 * own line), or null when origin does not have it. It throws when origin cannot be read. A local tag is not
 * enough: a fetch does not remove a tag that was deleted on origin.
 */
export function remoteTagCommit(cwd: string, tag: string): string | null {
  let out: string;
  try {
    out = execFileSync("git", ["ls-remote", "--exit-code", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    if ((e as { status?: number }).status === 2) return null;
    throw new Error(`origin cannot be read (git ls-remote): ${String((e as { stderr?: string }).stderr ?? e).trim().split("\n")[0]}`);
  }
  const lines = out.split("\n").filter(Boolean).map((l) => l.split("\t"));
  const peeled = lines.find((l) => l[1] === `refs/tags/${tag}^{}`);
  return (peeled ?? lines.find((l) => l[1] === `refs/tags/${tag}`))?.[0] ?? null;
}

export interface WriteDeps {
  /** The value of the variable now (`readRelease`). */
  read: () => Release | null;
  /** `gh variable set RELEASE --repo <repo> --body <value>`. */
  set: (value: string) => void;
}

/**
 * Write `RELEASE=<tag> <sha>` (L2-release §1 step 6). `tag` and `sha` are examined by the caller
 * (`writeOf`): the tag is on origin at `sha`, and `origin/main` reaches it. Returns "written" or "already".
 */
export function writeRelease(want: Release, deps: WriteDeps): "written" | "already" {
  if (!parseVersion(want.tag) || !/^[0-9a-f]{40}$/.test(want.sha)) throw new Error(`not a release: ${formatRelease(want)}`);
  const now = deps.read();
  if (now) {
    const order = byVersionDesc(now.tag, want.tag);
    if (order < 0) throw new Error(`the release variable names ${now.tag}, a larger version than ${want.tag}: never an older release over a newer one`);
    if (order === 0 && now.sha !== want.sha) throw new Error(`the release variable names ${now.tag} at ${now.sha}, not at ${want.sha}: the owner looks first`);
    if (order === 0) return "already";
  }
  deps.set(formatRelease(want));
  const back = deps.read();
  if (!back || formatRelease(back) !== formatRelease(want))
    throw new Error(`the read back gives ${back ? formatRelease(back) : "no variable"}, not ${formatRelease(want)}: stop`);
  return "written";
}

/** The release of a local tag in `cwd`, examined as a reader examines it: on origin at the same commit, and on `origin/main`. */
export function releaseOfTag(cwd: string, tag: string): Release {
  if (!parseVersion(tag)) throw new Error(`not a release tag YYYYMMDD.N: ${tag}`);
  const git = (...a: string[]) => run("git", a, cwd);
  let sha: string;
  try {
    sha = git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  } catch {
    throw new Error(`no local tag ${tag}`);
  }
  const remote = remoteTagCommit(cwd, tag);
  if (!remote) throw new Error(`origin has no tag ${tag}: push it first (the variable comes after the push)`);
  if (remote !== sha) throw new Error(`the tag ${tag} is at ${remote} on origin, not at ${sha} as here`);
  git("fetch", "-q", "origin", "main");
  try {
    git("merge-base", "--is-ancestor", sha, "origin/main");
  } catch {
    throw new Error(`origin/main does not reach ${tag} (${sha}): push main first`);
  }
  return { tag, sha };
}

export const ghSet = (cwd: string, repo: string) => (value: string) => {
  execFileSync("gh", ["variable", "set", NAME, "--repo", repo, "--body", value], { cwd, stdio: ["ignore", "ignore", "pipe"] });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { values: a, positionals: p } = parseArgs({ options: { cwd: { type: "string" } }, allowPositionals: true });
  const cwd = a.cwd ?? process.cwd();
  try {
    const repo = repoOf(run("git", ["config", "--get", "remote.origin.url"], cwd));
    const gh: Gh = ghApi(cwd);
    if (p[0] === "read" && p.length === 1) {
      const r = readRelease(gh, repo);
      if (!r) throw new Error(`${repo} has no release variable ${NAME}`);
      console.log(formatRelease(r));
    } else if (p[0] === "write" && p.length === 2) {
      const want = releaseOfTag(cwd, p[1]);
      const done = writeRelease(want, { read: () => readRelease(gh, repo), set: ghSet(cwd, repo) });
      console.log(`${repo} ${NAME}=${formatRelease(want)} (${done})`);
    } else {
      console.error("usage: release-var.ts read | write <tag>  [--cwd <repo>]");
      process.exit(2);
    }
  } catch (e) {
    console.log(`stop: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    process.exit(1);
  }
}
