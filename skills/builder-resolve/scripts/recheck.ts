/**
 * Re-examines the issue that this run was given, with repo-scoped REST only,
 * so it works in every session. Prints one of:
 *
 *   limit            3 PRs wait for the owner (next line: their numbers)
 *   closed           the issue is closed, or is a PR
 *   unlabelled       the issue no longer has the label ready-for-auto-builder
 *   unexplored       the issue does not have the label explored yet
 *   linked           an open PR holds it: a PR that is not a draft, a PR on
 *                    another branch, or more than one PR
 *   <N>              go on (next lines: branch, draft)
 *
 * `draft: #<M>` names the open draft PR on that branch, which implement continues;
 * `draft:` with nothing means a new branch.
 *
 *   node --experimental-strip-types --no-warnings recheck.ts --repo <owner/repo> --issue <N>
 */
import { parseArgs } from "node:util";
import { branchesUnder, openPrs, rest } from "./gh.ts";
import { BRANCH_PREFIX, type Issue, type Pr, recheck } from "./loop.ts";

const { values: a } = parseArgs({ options: { repo: { type: "string" }, issue: { type: "string" } } });
const n = Number(a.issue);
if (!a.repo || !Number.isInteger(n) || n <= 0) {
  console.error("usage: recheck.ts --repo <owner/repo> --issue <N>");
  process.exit(2);
}

const issue = rest<Issue>(`repos/${a.repo}/issues/${n}`);
const c = recheck({ issue, prs: openPrs<Pr>(a.repo), branches: branchesUnder(a.repo, BRANCH_PREFIX) });
if ("stop" in c) {
  console.log(c.stop);
  if (c.open) console.log(`open: ${c.open.map((x) => `#${x}`).join(" ")}`);
} else {
  console.log(c.issue);
  console.log(`branch: ${c.branch}`);
  console.log(`draft: ${c.draft ? `#${c.draft}` : ""}`);
}
