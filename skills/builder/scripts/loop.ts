/**
 * The decisions of builder that must not drift (L3-loop-builder §1): which
 * issues the explore run takes, which issue the implement run takes, where a
 * session does the spec and implement steps of an issue, and whether a PR body carries its parts.
 * Pure functions: the CLIs (explore.ts, select.ts, recheck.ts, check-pr-body.ts) only read input and print.
 */

/**
 * The branch of an issue: `issues/<N>`, or `issues/<N>-<k>` for a later try
 * (L2-loop-builder §5). Both modes use it. The author does not tell these PRs:
 * on some platforms the PR is opened as the owner's own account.
 */
export const BRANCH_PREFIX = "issues/";

/**
 * First line of each question comment. The comment can also come from the
 * owner's account, so only this line tells which issues wait for the owner.
 * The marker names `builder-resolve`, not `builder`: a marker is a fixed string that
 * scripts read, so it does not follow the name of the skill (L2-loop-builder §2.3).
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

/** An open issue (not a PR) that carries READY_LABEL and EXPLORED_LABEL: the implement run may take it. */
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

export type Stop = "none" | "closed" | "unlabelled" | "unexplored" | "linked";
/** `draft`: the open draft PR on the branch, which implement continues. */
export type Choice = { stop: Stop } | { issue: number; branch: string; draft?: number };

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
  const p = ownPr(n, linked);
  return p?.draft === true ? { issue: n, branch: p.head.ref, draft: p.number } : null;
}

/** The only linked PR of issue `n`, when it is on the issue's own branch; else null. */
function ownPr(n: number, linked: Pr[]): Pr | null {
  return linked.length === 1 && branchIssue(linked[0].head.ref) === n ? linked[0] : null;
}

/**
 * Where a session does the implement step of an issue (L3-loop-builder §1.3).
 * It selects nothing. `stop`: `labelled` (CI has the issue:
 * the label is the lock), `linked` (another PR holds it), `closed` (a closed issue,
 * with the branch for a `Refs #N` PR; a PR number gets no branch). `draft` is the
 * issue's own draft, `pr` its own ready PR, on `branch`.
 */
export type SessionChoice = { stop?: "labelled" | "linked" | "closed"; issue?: number; branch?: string; draft?: number; pr?: number };

export function sessionCheck(input: { issue: Issue; prs: Pr[]; branches?: string[] }): SessionChoice {
  const { issue } = input;
  const n = issue.number;
  if (issue.pull_request) return { stop: "closed" };
  const closed = issue.state !== "open";
  if (!closed && labelNames(issue).includes(READY_LABEL)) return { stop: "labelled" };
  const linked = linkedPrs(input.prs).get(n) ?? [];
  // A closed issue: its branch issues/<N> belongs to the PR that closed it, so a Refs #N PR takes issues/<N>-<k> from k = 2 (L2-loop-builder §5).
  const taken = [...(input.branches ?? []), ...(closed ? [`${BRANCH_PREFIX}${n}`] : [])];
  let at: SessionChoice;
  if (!linked.length) at = { branch: branchName(n, taken) };
  else {
    const p = ownPr(n, linked);
    if (!p) return { stop: "linked" };
    at = p.draft === true ? { branch: p.head.ref, draft: p.number } : { branch: p.head.ref, pr: p.number };
  }
  return closed ? { stop: "closed", ...at } : { issue: n, ...at };
}

/** The lines that the session form of recheck.ts prints for a SessionChoice. */
export function sessionLines(c: SessionChoice): string[] {
  const where = c.branch === undefined ? [] : [`branch: ${c.branch}`, c.pr ? `pr: #${c.pr}` : `draft: ${c.draft ? `#${c.draft}` : ""}`];
  if (c.stop) return [c.stop, ...(c.stop === "closed" ? where : [])];
  return [String(c.issue), ...where];
}

/**
 * The issue that the implement run takes, or why it stops. `issues` are the
 * repo's open issues with READY_LABEL (repo-scoped REST, so it runs in every
 * session); a row without both labels, a closed one or a PR is ignored.
 * `branches` are the repo's branches under BRANCH_PREFIX, for the name of a new
 * try; without them the name is `issues/<N>`. An issue with no label is never
 * taken: implement removes the label when it stops, so nothing waits for a comment.
 */
export function choose(input: { issues: Issue[]; prs: Pr[]; branches?: string[] }): Choice {
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
 * `refs`: the form for a closed issue (a node after a release, L2-loop-builder §5):
 * `Refs #<issue>`, and no closing keyword for it.
 */
export function checkPrBody(body: string, issue: number, opts: { refs?: boolean } = {}): string[] {
  const problems: string[] = [];

  if (opts.refs) {
    if (!new RegExp(`\\brefs?\\s+#${issue}\\b`, "i").test(body)) problems.push(`no "Refs #${issue}"`);
    if (closingRefs(body).includes(issue)) problems.push(`the body closes #${issue}; the issue is closed, so write "Refs #${issue}"`);
  } else if (!closingRefs(body).includes(issue)) problems.push(`no "Fixes #${issue}"`);

  if (section(body, /^evidence\b/i) === null) problems.push('no "## Evidence" section');
  const tests = section(body, /^tests?\b/i);
  if (!tests) problems.push('no "### Tests" with the commands that ran and their results');
  const notVerified = section(body, /^not verified\b/i);
  if (!notVerified) problems.push('no "### Not verified" with what nobody ran or examined (write "Nothing" if so)');

  return problems;
}

/** checkPrBody for an issue as REST gives it: a closed issue takes the `refs` form. */
export function checkPrBodyFor(body: string, issue: Issue): string[] {
  return checkPrBody(body, issue.number, { refs: issue.state !== "open" });
}
