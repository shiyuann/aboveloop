import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { KIT_REPO } from "../cursor.ts";
import { APP_NAMES, missing, SCHEDULES, SECRETS, stepsFor, VARIABLES } from "../plan.ts";

const REPO = "acme/app";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The script of the step "The latest release of aboveloop" in the template. */
const releaseScript = (yml: string) => {
  const step = yml.slice(yml.indexOf("- id: release"), yml.indexOf("- uses: actions/checkout"));
  return step.slice(step.indexOf("run: |\n") + 7).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
};

/**
 * Run that script with a fake `gh`: `variable` is the value of aboveloop's release variable RELEASE,
 * null when it is missing (404), or { error: true } when it cannot be read (HTTP 502); `tags` are the tags that
 * exist now, [name, sha]; `onMain` the shas that main reaches. Returns the exit code, the log and the outputs.
 */
function pick(variable: string | null | { error: true }, tags: [string, string][], onMain: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pick-"));
  const fixture = join(dir, "fixture.json");
  writeFileSync(fixture, JSON.stringify({ variable, tags: tags.map(([name, sha]) => ({ name, commit: { sha } })), onMain }));
  // gh api <path> [--paginate] --jq <filter>: the answer of the path, filtered by jq -r.
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env bash
set -o pipefail # an error of the path is the exit code of gh, as with the real gh
path="$2"; while [ "$1" != "--jq" ]; do shift; done; filter="$2"
f=${JSON.stringify(fixture)}
case "$path" in
  repos/${KIT_REPO}/actions/variables/RELEASE)
    v="$(jq -c '.variable' "$f")"
    [ "$v" = null ] && { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    [ "$v" = '{"error":true}' ] && { echo "gh: Server Error (HTTP 502)" >&2; exit 1; }
    jq '{name: "RELEASE", value: .variable}' "$f" ;;
  repos/${KIT_REPO}/tags*) jq '.tags' "$f" ;;
  */compare/*) s="\${path#*compare/}"; s="\${s%%...*}"
    jq -n --arg s "$s" --slurpfile x "$f" 'if ($x[0].onMain | index($s)) then {status: "ahead"} else {status: "diverged"} end' ;;
  *) echo "gh: Not Found (HTTP 404) $path" >&2; exit 1 ;;
esac | jq -r "$filter"
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const out = join(dir, "out");
  writeFileSync(out, "");
  const r = spawnSync("bash", ["-c", releaseScript(read("../../../skills/setup-app/references/loop.yml"))], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, GH_TOKEN: "t" },
    encoding: "utf8",
  });
  return { code: r.status, log: r.stdout + r.stderr, outputs: readFileSync(out, "utf8") };
}

test("stepsFor: a run with no step, or all, does explore + implement; an explicit step wins", () => {
  assert.deepEqual(stepsFor({}), ["explore", "implement"]);
  // A scheduled run's step input is empty.
  assert.deepEqual(stepsFor({ step: "" }), ["explore", "implement"]);
  assert.deepEqual(stepsFor({ step: "all" }), ["explore", "implement"]);
  assert.deepEqual(stepsFor({ step: "implement" }), ["implement"]);
  assert.deepEqual(stepsFor({ step: "implement,explore" }), ["explore", "implement"]);
  assert.throws(() => stepsFor({ step: "deploy" }), /unknown step/);
  // The workflow `loop.yml` adds no issues anywhere (L2-loop-builder §3).
  assert.throws(() => stepsFor({ step: "backlog" }), /unknown step/);
});

test("a missing value skips only its step; the launch values are separate, so a dry run reads without them", () => {
  const env = { REPO, GITHUB_TOKEN: "g" };
  assert.deepEqual(missing("implement", env), { read: [], launch: ["CURSOR_API_KEY", "GH_APP_ID_DEV", "GH_APP_KEY_DEV", "GH_TOKEN_KIT"] });
  assert.deepEqual(missing("explore", env), { read: [], launch: ["CURSOR_API_KEY", "GH_TOKEN_EXPLORER", "GH_TOKEN_KIT"] });
  assert.deepEqual(missing("implement", { ...env, GITHUB_TOKEN: " " }).read, ["GITHUB_TOKEN"]);
});

// ---------- the template, the action and the key script agree with the code ----------

test("the template has both schedules, the dispatch inputs, and passes every variable and secret to the action", () => {
  const yml = read("../../../skills/setup-app/references/loop.yml");
  for (const cron of SCHEDULES) assert.ok(yml.includes(`cron: "${cron}"`), cron);
  assert.equal(yml.match(/cron: /g)?.length, SCHEDULES.length);
  // The action of the latest release, checked out at its commit, never @main.
  assert.ok(!yml.includes("services/loop@"), "no action by a moving name");
  assert.ok(yml.includes("- uses: ./.aboveloop/services/loop") && yml.includes("ref: ${{ steps.release.outputs.sha }}"));
  assert.ok(yml.includes(`repository: ${KIT_REPO}`) && yml.includes("path: .aboveloop"));
  assert.ok(yml.includes("kit_tag: ${{ steps.release.outputs.tag }}") && yml.includes("kit_sha: ${{ steps.release.outputs.sha }}"));
  const names = yml.slice(yml.indexOf("- id: kitrepo"), yml.indexOf("- id: kit\n"));
  assert.ok(names.includes(`kit=${KIT_REPO}`), "the kit token is for the repo of aboveloop");
  const kit = yml.slice(yml.indexOf("- id: kit\n"), yml.indexOf("- id: release"));
  assert.ok(kit.includes("owner: ${{ steps.kitrepo.outputs.owner }}") && kit.includes("repositories: ${{ steps.kitrepo.outputs.name }}"));
  assert.ok(kit.includes("permission-contents: read"));
  // Step 0 reads the release variable (Variables read, W14), not the runs of a workflow (Actions read).
  assert.match(kit, /^          permission-actions-variables: read$/m, "the kit token reads the release variable");
  assert.ok(!/permission-actions:/.test(kit), "the kit token reads no runs");
  assert.ok(!/permission-(issues|pull-requests|contents: write)/.test(kit), "the kit token writes nothing");
  assert.ok(releaseScript(yml).includes(`kit=${KIT_REPO}`));
  assert.ok(!/\$\{\{ *(github\.event|inputs)\./.test(releaseScript(yml)), "no event value inside the script text");
  assert.ok(yml.includes("options: [all, explore, implement]"));
  assert.ok(yml.includes("group: loop") && yml.includes("cancel-in-progress: false"));
  for (const v of VARIABLES) assert.ok(yml.includes(`${v.toLowerCase()}: \${{ vars.${v} }}`), v);
  for (const s of SECRETS) assert.ok(yml.includes(`${s.toLowerCase()}: \${{ secrets.${s} }}`), s);
  for (const x of ["step: ${{ inputs.step }}", "dry_run: ${{ inputs.dry_run }}"]) assert.ok(yml.includes(x), x);
});

test("the action has an input for each value and hands each to run.ts as env, never in the script text", () => {
  const yml = read("../action.yml");
  const inputs = [...VARIABLES, ...SECRETS].map((n) => n.toLowerCase()).concat(["step", "dry_run", "repo", "github_token", "kit_tag", "kit_sha"]);
  const app = APP_NAMES.map((n) => n.toLowerCase()) as string[];
  for (const i of inputs) {
    assert.match(yml, new RegExp(`^  ${i}:$`, "m"), `input ${i}`);
    if (app.includes(i)) {
      assert.match(yml, new RegExp(`^        ${i.toUpperCase()}: \\$\\{\\{ inputs\\.${i} \\}\\}$`, "m"), `env of ${i}`);
      continue;
    }
    assert.match(yml, new RegExp(`^        [A-Z_]+: \\$\\{\\{ inputs\\.${i} \\}\\}$`, "m"), `env of ${i}`);
  }
  for (const n of [...VARIABLES, ...SECRETS].filter((n) => !(APP_NAMES as readonly string[]).includes(n)))
    assert.ok(yml.includes(`${n}: \${{ inputs.${n.toLowerCase()} }}`), n);
  // The run's GitHub tokens: minted from the App, pinned by commit, and not revoked when the job ends (the agents work after it).
  assert.equal(yml.match(/uses: actions\/create-github-app-token@[0-9a-f]{40} # v\d/g)?.length, 3);
  assert.equal(yml.match(/skip-token-revoke: true/g)?.length, 3, "the agents' tokens outlive the job");
  assert.ok(yml.includes("GH_TOKEN_KIT: ${{ steps.kit.outputs.token }}"));
  assert.ok(yml.includes("GH_TOKEN_EXPLORER: ${{ steps.explorer.outputs.token }}"));
  assert.ok(!yml.includes("GH_TOKEN_BUILDER"), "implement mints its own token");
  assert.ok(yml.includes("if: ${{ false }}"), "step dev does not mint");
  // The kit token reads only aboveloop; only implement's token writes code.
  assert.ok(yml.slice(yml.indexOf("- id: kitrepo"), yml.indexOf("- id: kit\n")).includes(`kit=${KIT_REPO}`));
  const kit = yml.slice(yml.indexOf("- id: kit\n"), yml.indexOf("- id: explorer"));
  assert.ok(kit.includes("repositories: ${{ steps.kitrepo.outputs.name }}") && kit.includes("permission-contents: read"), "the kit token reads aboveloop");
  assert.ok(!/permission-(issues|pull-requests|actions)/.test(kit), "the kit token writes nothing");
  const explorer = yml.slice(yml.indexOf("- id: explorer"), yml.indexOf("- id: dev"));
  assert.ok(explorer.includes("permission-contents: read") && !explorer.includes("pull-requests"), "explore reads code, opens no PR");
  assert.equal(yml.match(/permission-contents: write/g)?.length, 1, "only implement's token can push");
  assert.ok(!/permission-(administration|workflows|secrets)/.test(yml), "no token changes settings, workflows or secrets");
  assert.ok(!/permission-actions-variables: (write|admin)/.test(yml), "no token can write a variable (L2-release §2.3)");
  const script = yml.slice(yml.lastIndexOf("run: |"));
  assert.ok(!script.includes("${{"), "no expression inside the script");
  assert.ok(script.includes('"$GITHUB_ACTION_PATH/run.ts"'));
});

test("keys.sh knows exactly the contract's secrets", () => {
  const sh = read("../keys.sh");
  const list = (name: string) => (new RegExp(`^${name}=\\(([^)]*)\\)`, "m").exec(sh)?.[1] ?? "").split(/\s+/).filter(Boolean);
  assert.deepEqual(list("EVERY_REPO"), ["CURSOR_API_KEY", "GH_APP_KEY_DEV"]);
  assert.deepEqual(list("EVERY_REPO").sort(), [...SECRETS].sort());
});

test("the release that loop.yml runs: the one that the release variable names, on main; it fails closed", () => {
  const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
  const stops = (r: ReturnType<typeof pick>, why: RegExp, msg: string) => {
    assert.notEqual(r.code, 0, `${msg}: ${r.log}`);
    assert.match(r.log, why, msg);
    assert.equal(r.outputs, "", `${msg}: no pick`);
  };
  let r = pick(`20261013.5 ${B}`, [["20261012.9", A], ["20261013.5", B]], [A, B]);
  assert.equal(r.code, 0, r.log);
  assert.equal(r.outputs, `tag=20261013.5\nsha=${B}\n`, "the variable names the release");
  assert.match(r.log, new RegExp(`aboveloop 20261013\\.5 \\(${B}\\)`), "the log names the tag and the sha");

  // A release tag that the variable does not name is never read, whatever its version (an implement run can push one).
  r = pick(`20261012.9 ${A}`, [["20261012.9", A], ["20261012.10", B], ["20261013.1", C]], [A, B, C]);
  assert.equal(r.code, 0, r.log);
  assert.equal(r.outputs, `tag=20261012.9\nsha=${A}\n`, "a larger tag that the variable does not name is not the release");

  // L3-loop-workflow §1 step 0: each case stops, and never falls back to another tag.
  r = pick(null, [["20261012.9", A]], [A]);
  stops(r, /release variable RELEASE of aboveloop is missing or cannot be read.*HTTP 404/, "no variable (404)");

  r = pick({ error: true }, [["20261012.9", A]], [A]);
  stops(r, /release variable RELEASE of aboveloop is missing or cannot be read.*HTTP 502/, "a variable that cannot be read");

  for (const bad of [`20261012.9 ${A.slice(0, 7)}`, `20261012.9  ${A}`, `v20261012.9 ${A}`, `20261012.9 ${A.toUpperCase()}`, `20261012.9 ${A} x`, "20261012.9", ""])
    stops(pick(bad, [["20261012.9", A]], [A]), /release variable RELEASE of aboveloop is not '<YYYYMMDD\.N> <sha>'/, `a value of another form: '${bad}'`);

  r = pick(`20261013.1 ${C}`, [["20261012.9", A]], [A, C]);
  stops(r, /latest release 20261013\.1 is gone/, "a deleted tag is named");

  r = pick(`20261013.1 ${C}`, [["20261012.9", A], ["20261013.1", B]], [A, B, C]);
  stops(r, new RegExp(`latest release 20261013\\.1 was moved: the variable names ${C}, the tag is at ${B}`), "a moved tag is named");

  r = pick(`20261012.9 ${A}`, [["20261012.9", A]], []);
  stops(r, /latest release 20261012\.9 is not on main/, "a release that main does not reach");
});
