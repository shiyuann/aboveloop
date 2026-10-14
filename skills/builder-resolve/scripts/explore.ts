/**
 * The batch of the explore step: the open issues without the label explored,
 * lowest number first, at most EXPLORE_MAX. Prints their numbers on one line,
 * or `none`. The workflow loop.yml gives the same batch in the input; use this
 * in a session, or to check the input again.
 *
 *   node --experimental-strip-types --no-warnings explore.ts --repo <owner/repo>
 */
import { parseArgs } from "node:util";
import { openIssues } from "./gh.ts";
import { type Issue, toExplore } from "./loop.ts";

const { values: a } = parseArgs({ options: { repo: { type: "string" } } });
if (!a.repo) {
  console.error("usage: explore.ts --repo <owner/repo>");
  process.exit(2);
}
const batch = toExplore(openIssues<Issue>(a.repo));
console.log(batch.length ? batch.join(" ") : "none");
