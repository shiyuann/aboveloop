/**
 * The workflow `loop.yml` of one project repo (L3-loop-workflow §1). No model. One run:
 *
 *   explore    the open issues without the label explored (builder-resolve's `toExplore`, at most 20); launch builder-resolve, step explore, for the batch
 *   implement  choose an open issue with the labels ready-for-auto-builder and explored (builder-resolve's `choose`); launch builder-resolve, step implement, for it
 *
 *   node --experimental-strip-types --no-warnings services/loop/run.ts [--step all|explore|implement|<a,b>] [--dry-run]
 *
 * Without --step, a run does explore and implement.
 * The composite action (action.yml) runs this with the values of `with:` as env.
 *
 * Environment (the log names them, never their values):
 *   REPO (default GITHUB_REPOSITORY), GITHUB_TOKEN
 *   KIT_TAG, KIT_SHA: the release of aboveloop whose skills the agents read (both or none; none is main)
 *   CURSOR_API_KEY, GH_TOKEN_KIT (every agent: reads aboveloop)
 *   explore: GH_TOKEN_EXPLORER; implement: GH_TOKEN_BUILDER
 *
 * --dry-run reads everything and changes nothing: no launch. A missing
 * value skips only its step, with one log line. A failed step does not stop
 * the others; the exit code is 1 at the end if any step failed. The log has
 * issue numbers, counts, sizes and the launched agent's ids; no issue text, no token.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { choose, EXPLORED_LABEL, READY_LABEL, toExplore } from "../../skills/builder-resolve/scripts/loop.ts";
import { holdBack, launch, launchBody, listAgents, SKILL } from "./cursor.ts";
import { type GitHub, gitHub } from "./github.ts";
import { missing, payloadBytes, type StepName, stepsFor } from "./plan.ts";

export interface Options {
  step?: string;
  dryRun?: boolean;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: Date;
  log?: (line: string) => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0];

/** One run. Returns true when every step that ran worked. */
export async function runLoop(o: Options): Promise<boolean> {
  const env: Record<string, string | undefined> = { ...o.env };
  env.REPO = env.REPO?.trim() || env.GITHUB_REPOSITORY;
  const fetchImpl = o.fetch ?? fetch;
  const gh: GitHub = gitHub(fetchImpl);
  const log = o.log ?? ((line: string) => console.log(line));
  const dry = o.dryRun === true;
  const repo = env.REPO ?? "";
  let failed = false;
  const fail = (line: string) => {
    failed = true;
    log(`FAIL ${line}`);
  };

  let steps: StepName[];
  try {
    steps = stepsFor({ step: o.step });
  } catch (e) {
    fail(message(e));
    return false;
  }
  log(`loop ${repo || "(no REPO)"}: steps ${steps.join("+")}${dry ? " (dry run: launches nothing)" : ""}`);

  /** The agents of the account, read once a run, for the limits of holdBack (null: not read). */
  let agents: Awaited<ReturnType<typeof listAgents>> | undefined;

  /**
   * The launch of one job, or what a dry run would launch. `since` is when its work last changed
   * (the issue, or the newest issue of the batch): the limit on tries counts from there.
   */
  async function start(step: StepName, what: string, input: unknown, extra: { issue?: number; since?: string | null } = {}) {
    const skill = `${SKILL} (${step})`;
    const absent = missing(step, env).launch;
    const size = `${payloadBytes(input)} bytes of input`;
    if (dry) {
      log(`${step}: would launch ${skill} for ${what} (${size})${absent.length ? `; a real run would skip it: no ${absent.join(", no ")}` : ""}`);
      return;
    }
    if (absent.length) {
      log(`skip ${step}: would launch ${skill} for ${what}, but no ${absent.join(", no ")}`);
      return;
    }
    let body: ReturnType<typeof launchBody>;
    try {
      body = launchBody(step, { repo, issue: extra.issue, input, env });
    } catch (e) {
      fail(`${step}: ${message(e)}`);
      return;
    }
    // No second agent on the same work, and at most 2 tries with no mark.
    // The list is a guard against cost, not a security check: when it cannot be read, the launch goes on.
    if (agents === undefined) agents = await listAgents(env.CURSOR_API_KEY as string, fetchImpl);
    if (agents === null) log(`${step}: the list of agents cannot be read; launching with no check for a second agent`);
    else {
      const hold = holdBack(agents, body.name, extra.since ?? null, o.now ?? new Date());
      if (hold?.fail) return fail(`${step}: launches nothing for ${what}: ${hold.why}; the owner looks at it`);
      if (hold) return log(`skip ${step}: ${what}: ${hold.why}`);
    }
    const r = await launch(env.CURSOR_API_KEY as string, body, fetchImpl);
    if (r.ok) log(`${step}: launched ${skill} for ${what} (${size}): agent ${r.agent}${r.url ? ` ${r.url}` : ""} run ${r.run ?? "(none)"}`);
    else fail(`${step}: launch ${skill} for ${what}: ${r.why}`);
  }

  async function explore() {
    const open = await gh.openIssues(env.GITHUB_TOKEN as string, repo);
    const batch = toExplore(open);
    log(`explore: ${open.filter((i) => !i.pull_request).length} open issues, ${batch.length} without the label ${EXPLORED_LABEL} in the batch`);
    if (!batch.length) return log("explore: no launch (none)");
    const changed = open.filter((i) => batch.includes(i.number)).map((i) => i.updated_at ?? "").sort().at(-1) || null;
    await start("explore", `${batch.length} issues of ${repo} (${batch.map((n) => `#${n}`).join(" ")})`, { repo, step: "explore", issues: batch }, { since: changed });
  }

  async function implement() {
    const token = env.GITHUB_TOKEN as string;
    const issues = await gh.readyIssues(token, repo);
    log(`implement: ${issues.filter((i) => !i.pull_request).length} open issues with the label ${READY_LABEL}`);
    const choice = choose({ issues, prs: await gh.openPrs(token, repo) });
    if ("stop" in choice) {
      const open = choice.open ? ` (open: ${choice.open.map((n) => `#${n}`).join(" ")})` : "";
      return log(`implement: no launch (${choice.stop})${open}`);
    }
    log(`implement: chose #${choice.issue}${choice.draft ? ` (continues its draft #${choice.draft})` : ""}`);
    const since = issues.find((i) => i.number === choice.issue)?.updated_at ?? null;
    await start("implement", `${repo}#${choice.issue}`, { repo, step: "implement", issue: choice.issue }, { issue: choice.issue, since });
  }

  const run: Record<StepName, () => Promise<unknown>> = { explore, implement };
  for (const step of steps) {
    const absent = missing(step, env).read;
    if (absent.length) {
      log(`skip ${step}: no ${absent.join(", no ")}`);
      continue;
    }
    try {
      await run[step]();
    } catch (e) {
      fail(`${step}: ${message(e)}`);
    }
  }
  log(failed ? "loop: done, with failures" : "loop: done");
  return !failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  let a: { step?: string; "dry-run"?: boolean };
  try {
    a = parseArgs({
      options: {
        step: { type: "string" },
        "dry-run": { type: "boolean" },
      },
    }).values;
  } catch (e) {
    console.error(message(e));
    process.exit(2);
  }
  const ok = await runLoop({ step: a.step, dryRun: a["dry-run"], env: process.env });
  process.exit(ok ? 0 : 1);
}
