import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBuildsOn, checkPlan, format, type IssueState, knowledgeCheck, marksOf } from "./knowledge-check.ts";

const REPO = "shiyuann/aboveloop";
const URL_OF = (n: number) => `https://github.com/${REPO}/issues/${n}`;

/** A git repo in a temp folder with the given files (path from the root -> text). */
function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "knowledge-check-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The issue states given to the check (no network); a number with no state throws, as a failed `gh` call. */
const states =
  (map: Record<number, "open" | "closed">): IssueState =>
  (n) => {
    if (!map[n]) throw new Error("gh: HTTP 401");
    return map[n];
  };

const problems = (r: { findings: { kind: string; where: string; text: string }[] }) => r.findings.filter((f) => f.kind === "problem");
const questions = (r: { findings: { kind: string; where: string; text: string }[] }) => r.findings.filter((f) => f.kind === "question");

const table = (rows: string[], header = "| Page | What it holds | Builds on | Checked |") => ["# Index", "", header, "| --- | --- | --- | --- |", ...rows, ""].join("\n");

test('"Builds on": a name with no page fails; an L2 page that builds on an L3 page fails', () => {
  const r = checkBuildsOn(
    table([
      "| [spec/L1-foundation.md](spec/L1-foundation.md) | x | — | — |",
      "| [spec/L2-a.md](spec/L2-a.md) | x | L1-foundation (P1, P3), L2-gone, L3-b | 2026-10-13 |",
      "| [spec/L3-b.md](spec/L3-b.md) | x | L2-a, L1-foundation (E1) | 2026-10-13 |",
    ]),
  );
  assert.deepEqual(
    problems(r).map((f) => [f.where, f.text]),
    [
      ["knowledge/index.md:6", '"Builds on" of L2-a names "L2-gone", which is not a page of the table'],
      ["knowledge/index.md:6", "L2-a (L2) builds on L3-b, a page of a lower level (L3)"],
    ],
  );
});

test('"Builds on": a table with Chinese headers and links to another repo passes; a project with no table prints one line', () => {
  const chinese = table(
    [
      "| [spec/L1-foundation.md](spec/L1-foundation.md) | 为谁做 | — | — |",
      "| [spec/L2-loops.md](spec/L2-loops.md) | 两个循环 | L1-foundation（Q3、Q4）、aboveloop 的 [L2-loops](https://github.com/shiyuann/aboveloop/blob/main/knowledge/spec/L2-loops.md)、[L2-loop-builder](https://github.com/shiyuann/aboveloop/blob/main/knowledge/spec/L2-loop-builder.md) | 2026-10-12 |",
      "| [spec/L3-loop-data.md](spec/L3-loop-data.md) | 一轮怎么跑 | L2-loops、L1-foundation（E4） | 2026-10-13 |",
      "| [plan/alpha.md](plan/alpha.md) | alpha 施工单（A30、A72） | L3-loop-data、L2-loops、L1-foundation | 2026-10-13 |",
    ],
    "| 页 | 写什么 | 建立在 | 核对过 |",
  );
  const r = checkBuildsOn(chinese);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.notes, ['"Builds on": 2 name(s) with a link to another repo, not examined.']);

  const root = repo({ "knowledge/index.md": "# Index\n\n| Page | Summary |\n| --- | --- |\n| [a.md](a.md) | x |\n", "knowledge/spec/L2-a.md": "# A\n" });
  const whole = knowledgeCheck(root, { state: null, repo: REPO });
  assert.deepEqual(problems(whole), []);
  assert.equal(whole.notes.filter((n) => n.startsWith('"Builds on"')).length, 1, "one line, and the check is skipped");
});

test("⬜ marks: what is read, and what is skipped", () => {
  const text = [
    "# L2-x",
    "> **Updated** · Built in #36. ⬜ The rename of the label, and a live run: [#43](" + URL_OF(43) + "). ⬜ An app: [example-app#80](https://github.com/example/example-app/pull/80), then [#7](" + URL_OF(7) + ").",
    "> - 2026-10-13: R5 (⬜ #52) is 🔶 now; the last ⬜ #52 mark goes.",
    "A mark names an open issue, for example \"⬜ #42\", or `⬜ #41` in code.",
    "Marks: ✅ built · 🔶 partly built · ⬜ not built. A ⬜ names an issue.",
    "| R5 | 🔶 Only part (⬜ #38) | x |",
    "Measured (⬜ sync plan D4). Other (⬜ A12). Here ⬜ nothing at all.",
  ].join("\n");
  const marks = marksOf(text, REPO);
  assert.deepEqual(
    marks.map((m) => [m.line, m.issues, m.otherRepo, m.oldPlan]),
    [
      [2, [43], 0, null],
      [2, [7], 1, null],
      [6, [38], 0, null],
      [7, [], 0, "sync plan D4"],
      [7, [], 0, "A12"],
      [7, [], 0, null],
    ],
  );
});

test("⬜ #N: closed with no plan fails; closed with an open plan, or open, passes; a failed gh call is not a problem", () => {
  const spec = [
    "# L3-x",
    "",
    "One. ⬜ The rename of the label: [#10](" + URL_OF(10) + ").",
    "Two (⬜ #11).",
    "Three ⬜ #12.",
    "Four ⬜ #13.",
    "Five (⬜ sync plan D4).",
    "Six (⬜ alpha 施工单 A1). Seven (⬜ alpha 施工单 A2).",
  ].join("\n");
  const root = repo({
    "knowledge/spec/L3-x.md": spec,
    "knowledge/plan/11-open.md": "# 11\n\n## A1 Agent: x ✅\n\n## A2 Agent: y ⬜\n",
    "knowledge/plan/12-done.md": "# 12\n\n## A1 Agent: x ✅\n",
    "knowledge/plan/alpha.md": "# alpha\n\n## A1 agent：x ⬜\n\n## A2 agent：y ✅\n",
  });
  const r = knowledgeCheck(root, { state: states({ 10: "closed", 11: "closed", 12: "open" }), repo: REPO });
  assert.deepEqual(
    problems(r).map((f) => [f.where, f.text]),
    [["knowledge/spec/L3-x.md:3", "⬜ #10: the issue is closed, and no plan knowledge/plan/10-*.md has a node that is not ✅"]],
  );
  assert.deepEqual(
    questions(r).map((f) => f.where),
    ["knowledge/spec/L3-x.md:7", "knowledge/spec/L3-x.md:8"],
    "sync plan D4 (no plan on disk) and alpha A2 (✅) are questions; alpha A1 (open) passes",
  );
  assert.ok(r.notes.includes("could not read #13"), "#13 has no state: the gh call failed");
  assert.ok(questions(r)[0].text.includes("a plan that is not on disk (sync D4"));

  const offline = knowledgeCheck(root, { state: null, repo: REPO });
  assert.deepEqual(problems(offline), [], "--offline reads no state");
  assert.ok(offline.notes.some((n) => n.includes("--offline")));
});

test("plans: a ✅ heading with - [ ] fails; a label with ✅ and a heading with ⬜ fails; a ⬜ heading with all - [x] is a question", () => {
  const plan = [
    "# 66 plan",
    "",
    "```mermaid",
    "flowchart TB",
    '  A1["A1 Agent: one ✅"] --> A2["A2 Agent: two ✅"]',
    '  A2 --> O1["O1 Owner: three"]',
    "```",
    "",
    "## A1 Agent: one ✅",
    "",
    "- [x] **A1.1** done",
    "  - [ ] a sub-item left open",
    "",
    "## A2 Agent: two ⬜",
    "",
    "- [x] **A2.1** done",
    "- [x] ~~**A2.2**~~ moved",
    "",
    "## O1 Owner: three ⬜",
    "",
    "- [ ] the owner",
  ].join("\n");
  const r = checkPlan(plan, "knowledge/plan/66-x.md");
  assert.deepEqual(
    problems(r).map((f) => f.where),
    ["knowledge/plan/66-x.md:12", "knowledge/plan/66-x.md:5"],
  );
  assert.match(problems(r)[1].text, /mermaid label of A2 has ✅, and its heading has no ✅/);
  assert.deepEqual(
    questions(r).map((f) => f.where),
    ["knowledge/plan/66-x.md:14"],
  );
  const onlyQuestion = checkPlan(plan.replace("  - [ ] a sub-item left open\n", "").replace('A2["A2 Agent: two ✅"]', 'A2["A2 Agent: two"]'), "p.md");
  assert.deepEqual(problems(onlyQuestion), []);
  assert.match(format(onlyQuestion).at(-1)!, /^0 problem\(s\), 1 question\(s\)\.$/);
});

test("the command: exit 1 on a problem, exit 0 on questions only", () => {
  const script = fileURLToPath(new URL("./knowledge-check.ts", import.meta.url));
  const cli = (root: string) => spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, "--cwd", root, "--offline"], { encoding: "utf8" });
  const bad = cli(repo({ "a.md": "[x](#nowhere)\n" }));
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^problem a\.md:1: the anchor of #nowhere is not in its file$/m);
  const ok = cli(repo({ "knowledge/spec/L2-x.md": "# L2-x\n\nOld (⬜ sync plan D4).\n" }));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^question knowledge\/spec\/L2-x\.md:3: /m);
});
