/**
 * Which issue to take next. Prints one of:
 *
 *   limit            3 PRs wait for the owner (next line: their numbers)
 *   none             no open issue with the label ready-for-auto-builder to take
 *   <N>              take issue N (next lines: branch, draft)
 *
 * `draft: #<M>` names the open draft PR on that branch, which implement continues;
 * `draft:` with nothing means a new branch.
 *
 * Live:     node --experimental-strip-types --no-warnings select.ts --repo <owner/repo>
 * Offline:  … select.ts --repo <owner/repo> --issues <file> [--prs <file>]
 *
 * --issues: JSON of REST `GET /repos/{o}/{r}/issues?state=open&labels=ready-for-auto-builder`.
 * --prs: JSON of REST `GET /repos/{o}/{r}/pulls?state=open`.
 * Offline reads no branches, so a new branch is always `issues/<N>`.
 * Reads only, repo-scoped REST only. Another script imports `choose` from loop.ts instead of this CLI.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { branchesUnder, openPrs, readyIssues } from "./gh.ts";
import { BRANCH_PREFIX, choose, type Issue, type Pr, READY_LABEL } from "./loop.ts";

const { values: a } = parseArgs({
  options: {
    repo: { type: "string" },
    issues: { type: "string" },
    prs: { type: "string" },
  },
});
if (!a.repo) {
  console.error("usage: select.ts --repo <owner/repo> [--issues <file> [--prs <file>]]");
  process.exit(2);
}
const repo = a.repo;
const file = (p: string) => JSON.parse(readFileSync(p, "utf8"));

let issues: Issue[];
let prs: Pr[];
let branches: string[];
if (a.issues) {
  issues = file(a.issues);
  prs = a.prs ? file(a.prs) : [];
  branches = [];
} else {
  issues = readyIssues<Issue>(repo, READY_LABEL);
  prs = openPrs<Pr>(repo);
  branches = branchesUnder(repo, BRANCH_PREFIX);
}

const c = choose({ issues, prs, branches });
if ("stop" in c) {
  console.log(c.stop);
  if (c.open) console.log(`open: ${c.open.map((n) => `#${n}`).join(" ")}`);
} else {
  console.log(c.issue);
  console.log(`branch: ${c.branch}`);
  console.log(`draft: ${c.draft ? `#${c.draft}` : ""}`);
}
