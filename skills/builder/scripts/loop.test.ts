import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { branchIssue, branchName, checkPrBody, checkPrBodyFor, choose, EXPLORE_MAX, type Issue, type Pr, recheck, sessionCheck, sessionLines, toExplore } from "./loop.ts";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const issues: Issue[] = JSON.parse(fx("issues.json"));
const prs: Pr[] = JSON.parse(fx("prs.json"));
const ready = (n: number, title = "x"): Issue => ({ number: n, state: "open", title, labels: [{ name: "ready-for-auto-builder" }, { name: "explored" }] });
const pr = (number: number, ref: string, o: { body?: string; draft?: boolean } = {}): Pr => ({ number, head: { ref }, body: o.body ?? "", draft: o.draft ?? false });

test("the fake labelled list: skips the unlabelled, the linked, the unexplored and PRs; continues the session's draft of #5", () => {
  // #2 has a draft on issues/2 but no label; #3 a ready PR of the owner; #4 a draft on the branch of #10; #7 a ready PR on issues/7-2.
  assert.deepEqual(choose({ issues, prs }), { issue: 5, branch: "issues/5", draft: 23 });
});

test("PRs that wait for the owner do not stop implement", () => {
  const own = [11, 12, 13, 14].map((n) => pr(n, `issues/${n}`));
  assert.deepEqual(choose({ issues: [ready(1)], prs: own }), { issue: 1, branch: "issues/1" });
  assert.deepEqual(choose({ issues, prs: [...prs, pr(30, "issues/30"), pr(31, "issues/31")] }), { issue: 5, branch: "issues/5", draft: 23 });
});

test("an issue with an open linked PR is skipped: a closing keyword in its body, or its branch", () => {
  const take = (p: Pr[]) => choose({ issues: [ready(1), ready(2)], prs: p });
  assert.equal((take([pr(9, "a", { body: "This fixes #1." })]) as { issue: number }).issue, 2);
  assert.equal((take([pr(9, "a", { body: "Resolves #1" })]) as { issue: number }).issue, 2);
  assert.equal((take([pr(9, "issues/1")]) as { issue: number }).issue, 2);
  assert.equal((take([pr(9, "issues/1-2")]) as { issue: number }).issue, 2);
  // A mention is not a link.
  assert.equal((take([pr(9, "a", { body: "See #1" })]) as { issue: number }).issue, 1);
});

test("the label is the lock: an issue whose only linked PR is a draft on its own branch is taken, on that branch", () => {
  const take = (p: Pr[]) => choose({ issues: [ready(1), ready(2)], prs: p });
  // A session handed it over: its draft on issues/1, with Fixes #1.
  assert.deepEqual(take([pr(9, "issues/1", { body: "Fixes #1", draft: true })]), { issue: 1, branch: "issues/1", draft: 9 });
  assert.deepEqual(take([pr(9, "issues/1-2", { draft: true })]), { issue: 1, branch: "issues/1-2", draft: 9 });
  // A ready PR on its own branch holds it: the owner reads it.
  assert.equal((take([pr(9, "issues/1", { body: "Fixes #1" })]) as { issue: number }).issue, 2);
  // A draft on another branch, or a second PR: not its own draft alone.
  assert.equal((take([pr(9, "issues/7", { body: "Fixes #1", draft: true })]) as { issue: number }).issue, 2);
  assert.equal((take([pr(9, "owner/x", { body: "Fixes #1", draft: true })]) as { issue: number }).issue, 2);
  assert.equal((take([pr(9, "issues/1", { draft: true }), pr(10, "a", { body: "Fixes #1", draft: true })]) as { issue: number }).issue, 2);
  // A draft on issues/1 without the label: a session works on it, and nothing is taken.
  const session = { number: 1, state: "open", labels: [{ name: "explored" }] };
  assert.deepEqual(choose({ issues: [session], prs: [pr(9, "issues/1", { body: "Fixes #1", draft: true })] }), { stop: "none" });
  assert.deepEqual(recheck({ issue: session, prs: [pr(9, "issues/1", { draft: true })] }), { stop: "unlabelled" });
});

test("the lowest number is taken, whatever the order of the list", () => {
  assert.equal((choose({ issues: [ready(30), ready(4), ready(12)], prs: [] }) as { issue: number }).issue, 4);
});

test("nothing left: none", () => {
  assert.deepEqual(choose({ issues: [], prs: [] }), { stop: "none" });
  assert.deepEqual(choose({ issues: [ready(1)], prs: [pr(9, "issues/1")] }), { stop: "none" });
  // An issue with no label is never taken, whatever its comments say (no wait for an answer).
  assert.deepEqual(choose({ issues: [{ number: 1, state: "open", labels: ["explored"] }], prs: [] }), { stop: "none" });
});

test("branch names: issues/<N>, then issues/<N>-<k> past the branches that exist; the issue number reads back from each form", () => {
  assert.equal(branchName(12), "issues/12");
  assert.equal(branchName(12, ["issues/12"]), "issues/12-2");
  assert.equal(branchName(12, ["issues/12", "issues/12-2", "issues/120"]), "issues/12-3");
  assert.equal(branchName(12, ["issues/120", "issues/1"]), "issues/12");
  assert.equal(branchIssue("issues/12"), 12);
  assert.equal(branchIssue("issues/12-2"), 12);
  assert.equal(branchIssue("issues/12-map"), null);
  assert.equal(branchIssue("issues/x"), null);
  assert.equal(branchIssue("fix-issues/12"), null);
  assert.equal(branchIssue("builder-resolves/12-x"), null);
  // A new try gets the next free name; the choice passes the branches on.
  assert.deepEqual(choose({ issues: [ready(1)], prs: [], branches: ["issues/1"] }), { issue: 1, branch: "issues/1-2" });
});

test("recheck of a given issue: the same rules, from REST only", () => {
  const issue = { number: 5, state: "open", title: "Saturday times", body: "## Problem\n\nSaturday times differ.", labels: ["ready-for-auto-builder", "explored"] };
  assert.deepEqual(recheck({ issue, prs: [] }), { issue: 5, branch: "issues/5" });
  assert.deepEqual(recheck({ issue, prs: [], branches: ["issues/5"] }), { issue: 5, branch: "issues/5-2" });
  assert.deepEqual(recheck({ issue: { ...issue, state: "closed" }, prs: [] }), { stop: "closed" });
  // The owner took the label off after the choice, or implement stopped and took it off.
  assert.deepEqual(recheck({ issue: { ...issue, labels: [{ name: "explored" }] }, prs: [] }), { stop: "unlabelled" });
  // The owner added the label before the explore step reached the issue.
  assert.deepEqual(recheck({ issue: { ...issue, labels: ["ready-for-auto-builder"] }, prs: [] }), { stop: "unexplored" });
  assert.deepEqual(recheck({ issue: { ...issue, pull_request: {} }, prs: [] }), { stop: "closed" });
  assert.deepEqual(recheck({ issue, prs: [pr(9, "x", { body: "Fixes #5" })] }), { stop: "linked" });
  assert.deepEqual(recheck({ issue, prs: [pr(9, "issues/5")] }), { stop: "linked" });
  assert.deepEqual(recheck({ issue, prs: [pr(9, "issues/5", { draft: true })] }), { issue: 5, branch: "issues/5", draft: 9 });
  const own = [11, 12, 13].map((n) => pr(n, `issues/${n}`));
  assert.deepEqual(recheck({ issue, prs: own }), { issue: 5, branch: "issues/5" });
});

const ok = fx("body-ok.txt");

test("a body with all its parts passes", () => {
  assert.deepEqual(checkPrBody(ok, 5), []);
});

test("a body that misses one part is rejected, each part on its own", () => {
  const cut = (from: RegExp) => ok.replace(from, "");
  const has = (body: string, words: string) => checkPrBody(body, 5).some((p) => p.includes(words));
  assert.ok(has(cut(/Fixes #5\n/), '"Fixes #5"'));
  assert.ok(has(ok.replace("Fixes #5", "Fixes #6"), '"Fixes #5"'));
  assert.ok(has(cut(/### Tests\n[^#]*/), "Tests"));
  assert.ok(has(cut(/### Not verified\n[^\n]*\n/), "Not verified"));
  assert.ok(has(cut(/## Evidence\n/), "Evidence"));
});

test("the explore batch: open issues without explored, lowest first, PRs and closed ones never, at most EXPLORE_MAX", () => {
  const rows: Issue[] = [
    { number: 9, state: "open" },
    { number: 3, state: "open", labels: ["explored"] },
    { number: 4, state: "open", labels: [{ name: "ready-for-auto-builder" }] },
    { number: 5, state: "closed" },
    { number: 6, state: "open", pull_request: {} },
    { number: 2, state: "open", labels: [{ name: "bug" }] },
  ];
  // #4 has the owner's label but is not explored yet, so it is in the batch.
  assert.deepEqual(toExplore(rows), [2, 4, 9]);
  const many = Array.from({ length: EXPLORE_MAX + 5 }, (_, i) => ({ number: 100 - i, state: "open" }));
  const batch = toExplore(many);
  assert.equal(batch.length, EXPLORE_MAX);
  assert.equal(batch[0], 76);
});

// ---------- the session form of the script of implement.md §1 (L3-loop-builder §1.3) ----------

const explored = (n: number, o: Partial<Issue> = {}): Issue => ({ number: n, state: "open", labels: [{ name: "explored" }], ...o });

test("session: an issue with no label prints the issue, branch: and draft:; no selection", () => {
  const issue = explored(60);
  const c = sessionCheck({ issue, prs: [] });
  assert.deepEqual(c, { issue: 60, branch: "issues/60" });
  assert.deepEqual(sessionLines(c), ["60", "branch: issues/60", "draft: "]);
  // PRs that wait for the owner do not hold a session.
  const own = [11, 12, 13].map((n) => pr(n, `issues/${n}`));
  assert.deepEqual(sessionCheck({ issue, prs: own }), { issue: 60, branch: "issues/60" });
  // A branch that exists already (a closed PR left it): the next free name.
  assert.deepEqual(sessionCheck({ issue, prs: [], branches: ["issues/60"] }), { issue: 60, branch: "issues/60-2" });
  // An issue with no explored label: a session can still do it (explore in the session comes first).
  assert.deepEqual(sessionCheck({ issue: { number: 7, state: "open" }, prs: [] }), { issue: 7, branch: "issues/7" });
});

test("session: the issue's own draft gives draft:, its own ready PR gives pr:", () => {
  const issue = explored(60);
  const d = sessionCheck({ issue, prs: [pr(62, "issues/60", { body: "Fixes #60", draft: true })] });
  assert.deepEqual(d, { issue: 60, branch: "issues/60", draft: 62 });
  assert.deepEqual(sessionLines(d), ["60", "branch: issues/60", "draft: #62"]);
  const r = sessionCheck({ issue, prs: [pr(62, "issues/60-2", { body: "Fixes #60" })] });
  assert.deepEqual(r, { issue: 60, branch: "issues/60-2", pr: 62 });
  assert.deepEqual(sessionLines(r), ["60", "branch: issues/60-2", "pr: #62"]);
});

test("session: another linked PR gives linked; the label gives labelled", () => {
  const issue = explored(60);
  assert.deepEqual(sessionCheck({ issue, prs: [pr(9, "owner/x", { body: "Fixes #60" })] }), { stop: "linked" });
  assert.deepEqual(sessionCheck({ issue, prs: [pr(9, "issues/61", { body: "Fixes #60", draft: true })] }), { stop: "linked" });
  assert.deepEqual(sessionCheck({ issue, prs: [pr(9, "issues/60", { draft: true }), pr(10, "a", { body: "Fixes #60" })] }), { stop: "linked" });
  assert.deepEqual(sessionLines({ stop: "linked" }), ["linked"]);
  // The label is the lock: CI has the issue, so the session stops and tells the owner.
  const labelled = { ...issue, labels: ["explored", "ready-for-auto-builder"] };
  assert.deepEqual(sessionCheck({ issue: labelled, prs: [] }), { stop: "labelled" });
  assert.deepEqual(sessionLines({ stop: "labelled" }), ["labelled"]);
});

test("session: a closed issue prints closed and the next free issues/<N>-<k> for a Refs #N PR", () => {
  const issue = explored(44, { state: "closed" });
  const c = sessionCheck({ issue, prs: [] });
  assert.deepEqual(c, { stop: "closed", branch: "issues/44-2" });
  assert.deepEqual(sessionLines(c), ["closed", "branch: issues/44-2", "draft: "]);
  assert.deepEqual(sessionCheck({ issue, prs: [], branches: ["issues/44", "issues/44-2"] }), { stop: "closed", branch: "issues/44-3" });
  // Its own Refs draft continues on its branch.
  assert.deepEqual(sessionCheck({ issue, prs: [pr(70, "issues/44-2", { body: "Refs #44", draft: true })], branches: ["issues/44-2"] }), {
    stop: "closed",
    branch: "issues/44-2",
    draft: 70,
  });
  // A PR number is not an issue: closed, with no branch.
  assert.deepEqual(sessionLines(sessionCheck({ issue: { number: 62, state: "open", pull_request: {} }, prs: [] })), ["closed"]);
});

test("check-pr-body: a Refs #N body with the evidence passes; it must not close the issue", () => {
  const refs = fx("body-refs.txt");
  assert.deepEqual(checkPrBody(refs, 44, { refs: true }), []);
  assert.deepEqual(checkPrBodyFor(refs, { number: 44, state: "closed" }), []);
  assert.match(checkPrBody(refs.replace("Refs #44", "Refs #45"), 44, { refs: true }).join(), /Refs #44/);
  assert.match(checkPrBody(refs.replace("Refs #44", "Fixes #44"), 44, { refs: true }).join(), /closes/);
  assert.match(checkPrBody(refs.replace(/### Tests\n[^#]*/, ""), 44, { refs: true }).join(), /Tests/);
  // An open issue takes the Fixes form: a Refs body fails, a Fixes body passes.
  assert.match(checkPrBodyFor(refs, { number: 44, state: "open" }).join(), /Fixes #44/);
  assert.deepEqual(checkPrBodyFor(ok, { number: 5, state: "open" }), []);
});
