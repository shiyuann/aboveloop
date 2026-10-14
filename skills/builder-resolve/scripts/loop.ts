/**
 * The decisions of builder-resolve that must not drift (L3-loop-builder §1): which
 * issues the explore step takes, which issue the implement step takes, and
 * whether a PR body carries its parts.
 * Pure functions: the CLIs (explore.ts, select.ts, recheck.ts, check-pr-body.ts) only read input and print.
 */

/** At most this many PRs wait for the owner at one time (L3-loop-builder §1.2). */
export const PR_LIMIT = 3;

/**
 * The branch of an issue: `issues/<N>`, or `issues/<N>-<k>` for a later try
 * (L2-loop-builder §5). Both modes use it. The author does not tell these PRs:
 * on some platforms the PR is opened as the owner's own account.
 */
export const BRANCH_PREFIX = "issues/";

/**
 * First line of each question comment. The comment can also come from the
 * owner's account, so only this line tells which issues wait for the owner.
 */
export const QUESTION_MARKER = "<!-- builder-resolve:question -->";

/**
 * The label that hands an issue to the automatic mode; it is not a sign-off.
 * The owner adds it, or the explore step when the project's configuration
 * permits. Implement removes it when it stops (L2-loop-builder §3).
 */
export const READY_LABEL = "ready-for-auto-builder";
/** The explore step adds this label when it has written the Explore comment of the issue. */
export const EXPLORED_LABEL = "explored";
/** The explore step takes at most this many issues in one batch. */
export const EXPLORE_MAX = 20;

/** One row of REST `GET /repos/{o}/{r}/pulls?state=open`. */
export interface Pr {
  number: number;
  head: { ref: string };
  body?: string | null;
  /** A draft does not wait for the owner. Not `true` counts as ready. */
  draft?: boolean;
}

/**
 * REST `GET /repos/{o}/{r}/issues/{n}`, or one row of
 * `GET /repos/{o}/{r}/issues?state=open&labels=ready-for-auto-builder`. A PR also answers there, with `pull_request`.
 */
export interface Issue {
  number: number;
  state: string;
  title?: string;
  body?: string | null;
  labels?: (string | { name?: string })[];
  pull_request?: unknown;
  /** When the issue last changed: a comment, a label or an edit (the loops' limit on tries uses it). */
  updated_at?: string;
}

const labelNames = (i: Issue) => (i.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? "")));
const isOpenIssue = (i: Issue) => !i.pull_request && i.state === "open";

/** An open issue (not a PR) that carries READY_LABEL and EXPLORED_LABEL: the implement step may take it. */
export function isReady(i: Issue): boolean {
  const names = labelNames(i);
  return isOpenIssue(i) && names.includes(READY_LABEL) && names.includes(EXPLORED_LABEL);
}

/**
 * The batch of the explore step: open issues (not PRs) without EXPLORED_LABEL,
 * lowest number first, at most EXPLORE_MAX. READY_LABEL does not matter: the
 * owner can add it before the issue is explored.
 */
export function toExplore(issues: Issue[]): number[] {
  return issues
    .filter((i) => isOpenIssue(i) && !labelNames(i).includes(EXPLORED_LABEL))
    .map((i) => i.number)
    .sort((a, b) => a - b)
    .slice(0, EXPLORE_MAX);
}

export type Stop = "limit" | "none" | "closed" | "unlabelled" | "unexplored" | "linked";
/** `draft`: the open draft PR on the branch, which implement continues. */
export type Choice = { stop: Stop; open?: number[] } | { issue: number; branch: string; draft?: number };

const ISSUE_BRANCH = new RegExp(`^${BRANCH_PREFIX}(\\d+)(?:-\\d+)?$`);

/** The issue number of a branch of an issue, `issues/<N>` or `issues/<N>-<k>`. */
export function branchIssue(head: string): number | null {
  const m = ISSUE_BRANCH.exec(head);
  return m ? Number(m[1]) : null;
}

/** Issue numbers a PR body closes: "Fixes #12", "closes #3", "Resolves #40". */
export function closingRefs(body: string | null | undefined): number[] {
  const out = new Set<number>();
  for (const m of (body ?? "").matchAll(/\b(fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+#(\d+)\b/gi)) out.add(Number(m[2]));
  return [...out];
}

/**
 * The branch for a new try on an issue: `issues/<N>`, or `issues/<N>-<k>` with
 * the lowest k from 2 that `taken` (the repo's branches) does not have. The
 * branch of a closed PR stays, and the next try reads it (L2-loop-builder §1).
 */
export function branchName(issue: number, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let name = `${BRANCH_PREFIX}${issue}`;
  for (let k = 2; used.has(name); k++) name = `${BRANCH_PREFIX}${issue}-${k}`;
  return name;
}

/**
 * The PRs that wait for the owner, when they reach the limit: open, not a
 * draft, on the branch of an issue, from either mode.
 */
function limitReached(prs: Pr[]): number[] | null {
  const open = prs.filter((p) => p.draft !== true && branchIssue(p.head.ref) !== null).map((p) => p.number);
  return open.length >= PR_LIMIT ? open.sort((a, b) => a - b) : null;
}

/**
 * The open PRs linked to each issue: a closing keyword in the body
 * (`Fixes #N`), or the branch of the issue. GitHub's closingIssuesReferences
 * is GraphQL only, and some sessions cannot use GraphQL, so the body is the source.
 */
function linkedPrs(prs: Pr[]): Map<number, Pr[]> {
  const out = new Map<number, Pr[]>();
  for (const p of prs) {
    const own = branchIssue(p.head.ref);
    for (const n of new Set([...closingRefs(p.body), ...(own === null ? [] : [own])])) out.set(n, [...(out.get(n) ?? []), p]);
  }
  return out;
}

/**
 * Where implement works on issue `n`, or null when an open PR holds the issue.
 * With no linked PR: a new branch. With one linked PR that is a draft on the
 * issue's own `issues/` branch: that branch and that draft (a session handed
 * it over, or an earlier run died before its end; the label is the lock).
 */
function take(n: number, linked: Pr[], branches: string[]): Choice | null {
  if (!linked.length) return { issue: n, branch: branchName(n, branches) };
  const [p] = linked;
  return linked.length === 1 && p.draft === true && branchIssue(p.head.ref) === n ? { issue: n, branch: p.head.ref, draft: p.number } : null;
}

/**
 * The issue that the implement step takes, or why it stops. `issues` are the
 * repo's open issues with READY_LABEL (repo-scoped REST, so it runs in every
 * session); a row without both labels, a closed one or a PR is ignored.
 * `branches` are the repo's branches under BRANCH_PREFIX, for the name of a new
 * try; without them the name is `issues/<N>`. An issue with no label is never
 * taken: implement removes the label when it stops, so nothing waits for a comment.
 */
export function choose(input: { issues: Issue[]; prs: Pr[]; branches?: string[] }): Choice {
  const open = limitReached(input.prs);
  if (open) return { stop: "limit", open };

  const linked = linkedPrs(input.prs);
  for (const issue of input.issues.filter(isReady).sort((a, b) => a.number - b.number)) {
    const c = take(issue.number, linked.get(issue.number) ?? [], input.branches ?? []);
    if (c) return c;
  }
  return { stop: "none" };
}

/**
 * The same rules for one issue that was chosen earlier, from repo-scoped REST
 * only (it works in every session). State can change between the choice and the run.
 */
export function recheck(input: { issue: Issue; prs: Pr[]; branches?: string[] }): Choice {
  const { issue, prs } = input;
  const open = limitReached(prs);
  if (open) return { stop: "limit", open };
  if (issue.state !== "open" || issue.pull_request) return { stop: "closed" };
  if (!labelNames(issue).includes(READY_LABEL)) return { stop: "unlabelled" };
  if (!labelNames(issue).includes(EXPLORED_LABEL)) return { stop: "unexplored" };
  return take(issue.number, linkedPrs(prs).get(issue.number) ?? [], input.branches ?? []) ?? { stop: "linked" };
}

/** Text under a `## <name>` or `### <name>` heading, up to the next heading of any level. */
function section(body: string, name: RegExp): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && name.test(l.replace(/^#+\s*/, "")));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6}\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/**
 * Problems in a PR body; empty means it passes. The parts: `Fixes #<issue>`,
 * and under `## Evidence` the tests that ran and what was not verified.
 */
export function checkPrBody(body: string, issue: number): string[] {
  const problems: string[] = [];

  if (!closingRefs(body).includes(issue)) problems.push(`no "Fixes #${issue}"`);

  if (section(body, /^evidence\b/i) === null) problems.push('no "## Evidence" section');
  const tests = section(body, /^tests?\b/i);
  if (!tests) problems.push('no "### Tests" with the commands that ran and their results');
  const notVerified = section(body, /^not verified\b/i);
  if (!notVerified) problems.push('no "### Not verified" with what nobody ran or examined (write "Nothing" if so)');

  return problems;
}
