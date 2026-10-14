/**
 * Step 4 of prerelease (L2-release §1, §2.7): the facts for the section of the new version
 * in `CHANGELOG.md`. The agent writes the words; this script only collects what they come from.
 * Read-only: git, and GitHub through repo-scoped REST (`gh api repos/<repo>/pulls/<n>`). It prints one JSON.
 *
 *   node --experimental-strip-types --no-warnings changelog.ts [--config .agents/prerelease.md] [--cwd <repo>]
 *
 * Run it after the version command and before the version commit.
 * - `heading`: `## <VERSION> · <YYYY-MM-DD>`, the date of today on this machine.
 * - `exists`: `CHANGELOG.md` has a section for VERSION already (the last run stopped in step 4).
 *   Then it collects nothing: the agent writes no second section.
 * - `prs`: the PRs merged after the latest release (scope.ts), oldest first: the number, the title, and
 *   the summary paragraph of the body (the first paragraph after `Fixes #N`, before the first heading).
 *   A PR is found from its commit: GitHub's merge commit `Merge pull request #N from …`, or a squash
 *   commit `… (#N)`. REST then confirms that PR N merged as that commit. A rebase merge shows as commits.
 *   `issues`: the issues of this repo that its `Fixes` and `Refs` lines name (a reference to another repo
 *   is not one), each with its plan at HEAD, `knowledge/plan/<N>-<slug>.md`, or null.
 * - `commits`: the subjects of the other commits after the latest release, made straight to main with
 *   no PR. Not in it: the commits of a PR's branch, merge commits, and version commits. They get no links.
 * - `repo` and `commit` (`HEAD` when step 4 writes the section): the agent makes each link of a line
 *   from them and the numbers and plan paths above (L2-release §2.7). A plan that this release removes
 *   still opens at that commit.
 *
 * It never reads issues or comments: their text is from other persons (E1), and the section
 * goes into the tag with no merge. Quotes in a PR body are dropped. No text in the output has a link.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Gh, ghApi, latestOf, originRepo, parseVersion, run } from "./scope.ts";

/** Text with no links: `[x](url)` → x; images, `<url>` and bare URLs go; the spaces are joined. */
export function unlink(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[a-z][a-z0-9+.-]*:[^>\s]*>/gi, "")
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A line that only names issues: `Fixes #5`, `Closes acme/app#5, #6`, `Part of #36.` */
const REF_LINE =
  /^(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|part of|refs?|related to|see)\s*:?\s+(?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*(?:,|and)\s*(?:[\w.-]+\/[\w.-]+)?#\d+)*\s*\.?$/i;

/** A line that names the issues that a PR fixes or refers to: `Fixes #5`, `Refs #5, acme/app#6`. */
const ISSUE_LINE =
  /^(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?|refs?)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+(?:\s*(?:,|and)\s*(?:[\w.-]+\/[\w.-]+)?#\d+)*)\s*\.?$/i;

/** The issues of `repo` that the `Fixes` and `Refs` lines of a PR body name, once each; not in a quote or code. */
export function issuesOf(body: string | null | undefined, repo: string): number[] {
  const out: number[] = [];
  let code = false;
  for (const raw of (body ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(?:```|~~~)/.test(line)) code = !code;
    const m = code ? null : ISSUE_LINE.exec(line);
    for (const r of m ? m[1].matchAll(/(?:([\w.-]+\/[\w.-]+))?#(\d+)/g) : []) {
      if (r[1] && r[1].toLowerCase() !== repo.toLowerCase()) continue;
      if (!out.includes(Number(r[2]))) out.push(Number(r[2]));
    }
  }
  return out;
}

/** The plan of each issue at a commit: `knowledge/plan/<N>-<slug>.md`, the first by name. */
export function plansAt(names: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const name of [...names].sort()) {
    const m = /^knowledge\/plan\/(\d+)-[a-z0-9-]+\.md$/.exec(name);
    if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), name);
  }
  return out;
}

/**
 * The summary paragraph of a PR body: the first paragraph that is not a reference line, a quote
 * or code. It ends at a blank line or a heading. No links.
 */
export function summaryOf(body: string | null | undefined): string {
  const para: string[] = [];
  let code = false;
  for (const raw of (body ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(?:```|~~~)/.test(line)) {
      code = !code;
      if (para.length) break;
      continue;
    }
    if (code) continue;
    if (/^#{1,6}(?:\s|$)/.test(line)) break;
    if (!line || line.startsWith(">") || REF_LINE.test(line)) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  return unlink(para.join(" "));
}

/** `YYYY-MM-DD` of a date, in the time zone of this machine. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const MERGE_PR = /^Merge pull request #(\d+) from /;
const SQUASH_PR = /\(#(\d+)\)\s*$/;
const VERSION_COMMIT = /^version: \d{8}\.\d+$/;

interface RawPr {
  number: number;
  title?: string;
  body?: string | null;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
}

export function changelog(cwd: string, configPath = ".agents/prerelease.md", gh: Gh = ghApi(cwd), today = new Date()) {
  const git = (...a: string[]) => run("git", a, cwd);
  if (!/^## Changelog[ \t]*$/m.test(readFileSync(join(cwd, configPath), "utf8")))
    throw new Error(`${configPath} has no section ## Changelog (write None when the project has no commands)`);
  const version = readFileSync(join(cwd, "VERSION"), "utf8").trim();
  if (!parseVersion(version)) throw new Error(`VERSION is not YYYYMMDD.N: ${version}`);
  const heading = `## ${version} · ${isoDate(today)}`;
  const file = join(cwd, "CHANGELOG.md");
  const same = new RegExp(`^## ${version.replace(".", "\\.")}(?:\\s|$)`, "m");
  if (existsSync(file) && same.test(readFileSync(file, "utf8"))) return { version, heading, exists: true, stop: null };

  const repo = originRepo(cwd);
  const latest = latestOf(cwd, gh, false);
  const commits = git("log", "--reverse", "--topo-order", "--format=%H %P%x09%s", latest ? `${latest.commit}..HEAD` : "HEAD")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const tab = l.indexOf("\t");
      const [sha, ...parents] = l.slice(0, tab).split(" ").filter(Boolean);
      return { sha, parents, subject: l.slice(tab + 1) };
    });

  /** PR n, if it merged as this commit; null for an issue number (HTTP 404) or another PR. */
  const mergedAs = (n: number, sha: string): RawPr | null => {
    let p: RawPr;
    try {
      p = gh(`repos/${repo}/pulls/${n}`) as RawPr;
    } catch (e) {
      if (/HTTP 404/.test(String(e))) return null;
      throw new Error(`PR #${n} cannot be read: stop`);
    }
    return p.merged_at && p.merge_commit_sha === sha ? p : null;
  };

  const commit = git("rev-parse", "HEAD");
  const plans = plansAt(git("ls-tree", "--name-only", "HEAD", "knowledge/plan/").split("\n").filter(Boolean));
  const prs: { number: number; title: string; summary: string; issues: { number: number; plan: string | null }[] }[] = [];
  const ofPr = new Set<string>();
  for (const c of commits) {
    const m = c.parents.length > 1 ? MERGE_PR.exec(c.subject) : SQUASH_PR.exec(c.subject);
    const p = m ? mergedAs(Number(m[1]), c.sha) : null;
    if (!p) continue;
    const issues = issuesOf(p.body, repo).map((n) => ({ number: n, plan: plans.get(n) ?? null }));
    prs.push({ number: p.number, title: unlink(p.title ?? ""), summary: summaryOf(p.body), issues });
    ofPr.add(c.sha);
    if (c.parents.length > 1) {
      const branch = git("rev-list", c.parents[1], `^${c.parents[0]}`, ...(latest ? [`^${latest.commit}`] : []));
      for (const s of branch.split("\n").filter(Boolean)) ofPr.add(s);
    }
  }
  const direct = commits
    .filter((c) => c.parents.length <= 1 && !ofPr.has(c.sha) && !VERSION_COMMIT.test(c.subject))
    .map((c) => ({ sha: c.sha.slice(0, 7), subject: unlink(c.subject) }));
  return { version, heading, exists: false, since: latest?.name ?? null, repo, commit, prs, commits: direct, stop: null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const a = parseArgs({ options: { config: { type: "string" }, cwd: { type: "string" } } }).values;
  try {
    console.log(JSON.stringify(changelog(a.cwd ?? process.cwd(), a.config ?? ".agents/prerelease.md"), null, 2));
  } catch (e) {
    console.log(JSON.stringify({ stop: (e instanceof Error ? e.message : String(e)).split("\n")[0] }, null, 2));
    process.exit(1);
  }
}
