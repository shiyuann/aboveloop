/**
 * The decisions of the workflow `loop.yml` (L3-loop-workflow §1), as pure functions: which
 * steps a run does, and what each step needs. run.ts does the reads and the launches;
 * github.ts talks to GitHub, cursor.ts to Cursor.
 *
 * The choices of issues are builder's `choose` and `toExplore`: run.ts imports them, not a copy.
 */

export const STEPS = ["explore", "implement"] as const;
export type StepName = (typeof STEPS)[number];

/** The two crons of loop.yml. Each run does explore and implement: together, every 6 hours. */
export const SCHEDULES = ["17 3,9,21 * * *", "17 15 * * *"] as const;

/** The repo variables of the workflow `loop.yml` (not secret). */
export const VARIABLES = ["GH_APP_ID_DEV"] as const;

/** The repo secrets of the workflow `loop.yml`. GITHUB_TOKEN is not one: Actions makes it. `make loop-secrets` sets these. */
export const SECRETS = ["CURSOR_API_KEY", "GH_APP_KEY_DEV"] as const;

/**
 * The repo variable and secret of the GitHub App of the loop: the action mints the run's
 * GitHub tokens from them (GH_TOKEN_KIT, the read token of aboveloop for every agent;
 * GH_TOKEN_EXPLORER and GH_TOKEN_BUILDER for the two steps of builder), so they
 * go to the mint steps, not to run.ts.
 */
export const APP_NAMES = ["GH_APP_ID_DEV", "GH_APP_KEY_DEV"] as const;

/** The steps of this run. `--step` wins (one step or a comma list); `all` or none is explore and implement. */
export function stepsFor(input: { step?: string }): StepName[] {
  const step = input.step?.trim();
  if (step && step !== "all") {
    const names = step.split(",").map((s) => s.trim());
    for (const n of names)
      if (!(STEPS as readonly string[]).includes(n)) throw new Error(`unknown step "${n}" (${STEPS.join(", ")}, all)`);
    return STEPS.filter((s) => names.includes(s));
  }
  return ["explore", "implement"];
}

/**
 * What a step needs: `read` to run at all, `launch` only to launch an agent.
 * A dry run reads without the second list and says what it would not launch.
 */
export const NEEDS: Record<StepName, { read: string[]; launch: string[] }> = {
  explore: { read: ["REPO", "GITHUB_TOKEN"], launch: ["CURSOR_API_KEY", "GH_TOKEN_EXPLORER", "GH_TOKEN_KIT"] },
  implement: { read: ["REPO", "GITHUB_TOKEN"], launch: ["CURSOR_API_KEY", "GH_TOKEN_BUILDER", "GH_TOKEN_KIT"] },
};

export function missing(step: StepName, env: Record<string, string | undefined>) {
  const absent = (names: string[]) => names.filter((n) => !env[n]?.trim());
  return { read: absent(NEEDS[step].read), launch: absent(NEEDS[step].launch) };
}

/** The bytes of an input; the only thing the log says about it. */
export const payloadBytes = (payload: unknown) => Buffer.byteLength(JSON.stringify(payload), "utf8");
