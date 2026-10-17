/**
 * Re-examines the issue that this run was given, with repo-scoped REST only,
 * so it works in every session. CI form (implement.md §1) prints one of:
 *
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
 * Session form (--session; L3-loop-builder §1.3): it selects nothing. It prints one of:
 *
 *   labelled         the issue has ready-for-auto-builder: CI has it (the label is the lock)
 *   linked           another open PR holds it
 *   closed           a closed issue (next lines: branch, draft or pr, for a Refs #N PR);
 *                    a PR number, with no other line
 *   <N>              go on (next lines: branch, draft or pr)
 *
 * `pr: #<M>` names the issue's own ready PR on that branch.
 *
 *   node --experimental-strip-types --no-warnings recheck.ts --repo <owner/repo> --issue <N> [--session]
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { branchesUnder, openPrs, rest } from "./gh.ts";
import { BRANCH_PREFIX, type Issue, type Pr, recheck, sessionCheck, sessionLines } from "./loop.ts";

const token = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", fileURLToPath(new URL("./token.ts", import.meta.url))], { encoding: "utf8" });
const word = token.stdout.trim();
if (word === "stopped" || word === "failed") {
  console.log(word);
  process.exit(word === "failed" ? 1 : 0);
}

const { values: a } = parseArgs({ options: { repo: { type: "string" }, issue: { type: "string" }, session: { type: "boolean" } } });
const n = Number(a.issue);
if (!a.repo || !Number.isInteger(n) || n <= 0) {
  console.error("usage: recheck.ts --repo <owner/repo> --issue <N> [--session]");
  process.exit(2);
}

const issue = rest<Issue>(`repos/${a.repo}/issues/${n}`);
const input = { issue, prs: openPrs<Pr>(a.repo), branches: branchesUnder(a.repo, BRANCH_PREFIX) };
if (a.session) {
  for (const line of sessionLines(sessionCheck(input))) console.log(line);
  process.exit(0);
}
const c = recheck(input);
if ("stop" in c) {
  console.log(c.stop);
} else {
  console.log(c.issue);
  console.log(`branch: ${c.branch}`);
  console.log(`draft: ${c.draft ? `#${c.draft}` : ""}`);
}
