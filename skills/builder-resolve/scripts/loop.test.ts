import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { branchIssue, branchName, checkPrBody, choose, EXPLORE_MAX, type Issue, type Pr, recheck, toExplore } from "./loop.ts";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const issues: Issue[] = JSON.parse(fx("issues.json"));
const prs: Pr[] = JSON.parse(fx("prs.json"));
const ready = (n: number, title = "x"): Issue => ({ number: n, state: "open", title, labels: [{ name: "ready-for-auto-builder" }, { name: "explored" }] });
const pr = (number: number, ref: string, o: { body?: string; draft?: boolean } = {}): Pr => ({ number, head: { ref }, body: o.body ?? "", draft: o.draft ?? false });

test("the fake labelled list: skips the unlabelled, the linked, the unexplored and PRs; continues the session's draft of #5", () => {
  // #2 has a draft on issues/2 but no label; #3 a ready PR of the owner; #4 a draft on the branch of #10; #7 a ready PR on issues/7-2.
  assert.deepEqual(choose({ issues, prs }), { issue: 5, branch: "issues/5", draft: 23 });
});

test("3 PRs wait for the owner: stop, even with labelled issues", () => {
  const own = [11, 12, 13].map((n) => pr(n, `issues/${n}`));
  assert.deepEqual(choose({ issues: [ready(1)], prs: own }), { stop: "limit", open: [11, 12, 13] });
  // The PRs of later tries wait for the owner too.
  const mixed = [pr(11, "issues/11-2"), pr(12, "issues/12"), pr(13, "issues/13-3")];
  assert.deepEqual(choose({ issues: [ready(1)], prs: mixed }), { stop: "limit", open: [11, 12, 13] });
  // PRs on other branches are the owner's, and do not count.
  const other = [...own.slice(0, 2), pr(14, "owner/x")];
  assert.equal("issue" in choose({ issues: [ready(1)], prs: other }), true);
  // Drafts do not wait for the owner, and do not count.
  const drafts = [...own.slice(0, 2), pr(14, "issues/14", { draft: true }), pr(15, "issues/15-2", { draft: true })];
  assert.equal("issue" in choose({ issues: [ready(1)], prs: drafts }), true);
  // The fixtures: one open PR waits (#24); the drafts #20, #22 and #23 and the owner's #21 do not.
  assert.equal("issue" in choose({ issues, prs: [...prs, pr(30, "issues/30"), pr(31, "issues/31", { draft: true })] }), true);
  assert.deepEqual(choose({ issues, prs: [...prs, pr(30, "issues/30"), pr(31, "issues/31")] }), { stop: "limit", open: [24, 30, 31] });
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
  assert.deepEqual(recheck({ issue, prs: own }), { stop: "limit", open: [11, 12, 13] });
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
