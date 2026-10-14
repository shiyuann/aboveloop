/**
 * Examines a PR body before the PR opens. Prints each problem; exits 1 if there is one.
 *
 *   node --experimental-strip-types --no-warnings check-pr-body.ts --issue <N> --body <file|->
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkPrBody } from "./loop.ts";

const { values: a } = parseArgs({
  options: { issue: { type: "string" }, body: { type: "string" } },
});
const issue = Number(a.issue);
if (!Number.isInteger(issue) || issue <= 0 || !a.body) {
  console.error("usage: check-pr-body.ts --issue <N> --body <file|->");
  process.exit(2);
}
const body = readFileSync(a.body === "-" ? 0 : a.body, "utf8");

const problems = checkPrBody(body, issue);
for (const p of problems) console.log(`- ${p}`);
if (problems.length) process.exit(1);
console.log("ok");
