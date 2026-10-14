/**
 * Examines a PR body before the PR is ready. Prints each problem; exits 1 if there is one.
 *
 *   node --experimental-strip-types --no-warnings check-pr-body.ts --repo <owner/repo> --issue <N> --body <file|->
 *   node --experimental-strip-types --no-warnings check-pr-body.ts --issue <N> --body <file|-> [--refs]
 *
 * --repo: reads the issue (repo-scoped REST); a closed issue takes the Refs form.
 * Use it in both modes. Without --repo (offline, the tests): --refs gives the form
 * for a closed issue: "Refs #N", no closing keyword.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { rest } from "./gh.ts";
import { checkPrBody, checkPrBodyFor, type Issue } from "./loop.ts";

const { values: a } = parseArgs({
  options: {
    repo: { type: "string" },
    issue: { type: "string" },
    body: { type: "string" },
    refs: { type: "boolean" },
  },
});
const issue = Number(a.issue);
if (!Number.isInteger(issue) || issue <= 0 || !a.body) {
  console.error("usage: check-pr-body.ts [--repo <owner/repo>] --issue <N> --body <file|-> [--refs]");
  process.exit(2);
}
const body = readFileSync(a.body === "-" ? 0 : a.body, "utf8");

const problems = a.repo ? checkPrBodyFor(body, rest<Issue>(`repos/${a.repo}/issues/${issue}`)) : checkPrBody(body, issue, { refs: a.refs === true });
for (const p of problems) console.log(`- ${p}`);
if (problems.length) process.exit(1);
console.log("ok");
