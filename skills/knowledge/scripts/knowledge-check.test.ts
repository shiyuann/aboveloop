import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBuildsOn, checkPlanFile, checkReport, format, type IssueState, knowledgeCheck, marksOf, notCounts } from "./knowledge-check.ts";

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
    "knowledge/plan/11-open.md": '# 11\n\n> **Updated 2026-10-22**\n\n```mermaid\nflowchart TB\n  A1["A1 Agent: x ✅"] --> A2["A2 Agent: y"]\n```\n\n## A1 Agent: x ✅\n\n- [x] x (2026-10-22, `abc1234`)\n\n## A2 Agent: y ⬜\n',
    "knowledge/plan/12-done.md": '# 12\n\n> **Updated 2026-10-22**\n\n```mermaid\nflowchart TB\n  A1["A1 Agent: x ✅"]\n```\n\n## A1 Agent: x ✅\n\n- [x] x (2026-10-22, `abc1234`)\n',
    "knowledge/plan/alpha.md": '# alpha\n\n> **更新 2026-10-22**\n\n```mermaid\nflowchart TB\n  A2["A2 agent：y ✅"]\n  subgraph P1["P1 proposal：x"]\n    A1["A1 agent：x"]\n  end\n  A2 --> A1\n  A1 --> O1["O1 owner：发版"]\n```\n\n## A2 agent：y ✅\n\n- [x] y（2026-10-22，`abc1234`）\n\n## A1 agent：x ⬜\n\n## O1 owner：发版 ⬜\n',
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
  const r = checkPlanFile(plan, "knowledge/plan/66-x.md");
  assert.deepEqual(
    problems(r).map((f) => f.where),
    ["knowledge/plan/66-x.md:5", "knowledge/plan/66-x.md:12"],
  );
  assert.match(problems(r)[0].text, /label of A2 has ✅, and its heading has no ✅/);
  assert.ok(questions(r).some((f) => f.where === "knowledge/plan/66-x.md:14" && /each of its 2 item\(s\) is "- \[x\]": done\?/.test(f.text)));
  const onlyQuestion = checkPlanFile(plan.replace("  - [ ] a sub-item left open\n", "").replace('A2["A2 Agent: two ✅"]', 'A2["A2 Agent: two"]'), "knowledge/plan/66-x.md");
  assert.deepEqual(problems(onlyQuestion), []);
  assert.match(format(onlyQuestion).at(-1)!, /^0 problem\(s\), \d+ question\(s\)\.$/);
});

/** Lines of a correct report; each small part has only counts and IDs. */
const CORRECT = [
  "# deep-verify 2026-10-14: counts and IDs",
  "",
  "## Summary",
  "",
  "- 33 findings, 27 distinct. 0 blocking, 11 important, 16 small.",
  "- Small: 16; 14 repaired; B-3 does not hold; C-15 goes to the owner.",
  "- Small findings: 11, all repaired (A8, A9, A10, B8, B11, C9, C10, C11, C12, C13, D13).",
  "- 16 findings, 13 distinct. 0 blocking. 3 important, all repaired. 10 small, all repaired. No owner decision. No rule, owner quote or decision vanished (role b).",
  "",
  "| Kind | Count |",
  "| --- | --- |",
  "| Small | 18 |",
  "| Second look: new problems from the repair | 1 important, 9 small; all repaired in round 2 (§6) |",
  "",
  "## Small findings",
  "",
  "16: A-2 (in part), A-3 (in part), A-5/C-7, A-6/C-10, B-3, B-4, B-5/D-3b, C-4, C-5, C-8, C-9, C-11, C-13, C-14, C-15, D-6. 14 repaired; B-3 does not hold; C-15 goes to the owner (above).",
  "",
  "小发现 18 条只给数：修了 17 条，1 条修了一半（见上面「数」）。",
  "",
  "## Second look",
  "",
  "- The first second look: 8 problems. 1 blocking, 2 important, 5 small. All repaired.",
  "  - **S-1 (blocking):** the repair of D-5 broke the rule of one writer (L2-loop-builder §4). Repaired: one writer.",
  "  - **S-2 (important):** a late line stops the close, and the next run starts again. Repaired: the batch does not skip the issue.",
  "  - Small: S-4 to S-8.",
  "- The second look found 9 problems in the repairs: 3 important, 6 small.",
].join("\n");

/** Lines whose small parts give the problem of each finding. */
const WRONG_111 = [
  "## The small findings",
  "",
  "Repaired: C-4 and D-2 (`entry` sends the model of a section to another section), C-5 and D-3 (two lists of what `knowledge` holds in L2-plugin §2), C-6, A/B-2 and D-4 (the pointer of the L2-loops §3 row), C-8 (`knowledge-base.md` 「记一下」 row skips the issue question), C-9 (two passive sentences), C-10 (in the loop and on the loop are defined only in `knowledge`), D-6 (`prerelease`'s description), A/B-3 (the plan form), A/B-4 (update records that tell the story of the move), E-3 and E-4 (two section gaps), the second look's cross-reference.",
  "",
  "Not repaired: C-11. The session models of the three steps are written in `entry` (the table and a note), in L2-loop-builder §1 and in L3-loop-workflow §2. This was so at `f922a07`; this change does not move these rows. It is not a contradiction.",
  "",
  "## Second round (before O2): solo, changes since `9670c94`, read at `2088561`",
  "",
  "- The small findings, repaired: a-2 (the discussion steps of `entry` point to 「自动化的 spec」), a-3 and solo-6 (the worked example names `entry` step 2 as the pointer that fires), b-3 (the O1 quotes have one home, L2-plugin §2; `placement.md` links), b-4 (three section rows name the dropped words), solo-3 (the step \"where to record\" comes before the write), solo-4 (the terms are in the word table of spec-and-plan.md), solo-5 (L2-loop-architecture §2: one copy of each routine rule), solo-7 (the row of `entry`: a section name goes to L1 by an owner decision), solo-8 (the L2-loops §3 row names the design discussion), solo-9 (two long sentences of L2-plugin §2).",
  "- The second look (only the repairs that change meaning, `2088561` → `806a29a`): all right; 3 important and 1 small new problems, all repaired: two stale step numbers after the reorder (the plan, the section), no fallback in `AGENTS.md` when the plugin is not installed (now: read `skills/entry/SKILL.md` of this repo), and one unclear 「它」.",
].join("\n");

test("reports: a correct report passes; counts, IDs and the words of a count are not a description", () => {
  assert.deepEqual(checkReport(CORRECT, "r.md").findings, []);
  assert.deepEqual(notCounts("12 distinct small: 11 repaired, 1 not repaired (C-11, below)."), []);
  assert.deepEqual(notCounts("修了 17 条；1 条没修（C-11，写在 plan 里）。"), []);
  assert.deepEqual(notCounts("C-8 (the plan form)"), ["form"]);
});

test("reports: lines that give a small finding with its problem fail", () => {
  const r = checkReport(WRONG_111, "knowledge/reference/deep-verify-2026-10-14-111.md");
  assert.deepEqual(
    problems(r).map((f) => f.where),
    [3, 5, 9, 10].map((n) => `knowledge/reference/deep-verify-2026-10-14-111.md:${n}`),
  );
  assert.match(problems(r)[3].text, /two stale step numbers/);
});

test("reports: a small item gives its lines under it; a sentence that counts important ones keeps their lines", () => {
  const report = [
    "## Second look",
    "",
    "- The second second look: all repairs answer their findings; 3 small problems, not repaired (no third round, step 6). They are words only:",
    "  - T-1: L3-loop-builder §1.1 does not name the exception of case 1.",
    "- The repair brought in 1 important and 9 small new problems:",
    "  - **Important:** the reason of A5.3 (C-F5, D-F1).",
    "  - Small:",
    "    1. Only A3 opened the branch.",
    "- **P2 (small).** The size tier is used for the band.",
    "- **小的 4 条：** L3 §8.1 的「或」读成哪个条件都能关（改成一类一句）。",
    "| Small | 18 (the plan form) |",
    "",
    "The last second look found the repairs correct, and left 3 small points. The plan names them:",
    "",
    "- **P1.** The A6.1 grep also hits an update record.",
    "",
    "The rest of the report.",
    "",
    "- **S-1 (blocking):** a problem.",
  ].join("\n");
  assert.deepEqual(
    problems(checkReport(report, "r.md")).map((f) => f.where),
    ["r.md:4", "r.md:8", "r.md:9", "r.md:10", "r.md:11", "r.md:15"],
  );
});

test("reports: a heading that names important findings is not a small part, also when it names small ones", () => {
  const report = ["## Blocking, important and small findings", "", "| IDs | Problem | Result |", "| --- | --- | --- |", "| C-1 | The page says two things | Repaired |", "", "## 重要和小的发现", "", "- C-2：两页说的不一样，修了。"].join("\n");
  assert.deepEqual(checkReport(report, "r.md").findings, []);
  assert.deepEqual(problems(checkReport("## Small and other findings\n\nC-3 (the plan form).\n", "r.md")).map((f) => f.where), ["r.md:3"]);
});

test("reports: the count words take a commit, next, fixed and listed, and no word of a problem", () => {
  assert.deepEqual(notCounts("5 small problems, repaired in the next commit."), []);
  assert.deepEqual(notCounts("2 small, fixed; 1 not listed."), []);
  assert.deepEqual(notCounts("5 small problems, repaired in the next commit: the Summary bullet."), ["Summary", "bullet"]);
});

test("reports: only the sentence that ends with \":\" decides whether the list after it is small", () => {
  const report = [
    "- 10 small, all repaired. The important ones:",
    "  - **I-1:** the page says two things. Repaired.",
    "",
    "10 small, all repaired. The important ones:",
    "",
    "- **I-2:** the plan misses a node. Repaired.",
    "",
    "- The second second look: 3 small problems, not repaired. They are words only:",
    "  - T-1: the chart node does not name the exception.",
  ].join("\n");
  assert.deepEqual(problems(checkReport(report, "r.md")).map((f) => f.where), ["r.md:9"]);
});

test("reports: the check reads knowledge/reference/deep-verify-*.md from 2026-10-14; an older report is counted, not examined", () => {
  const root = repo({
    "knowledge/reference/deep-verify-2026-10-13-66.md": WRONG_111,
    "knowledge/reference/deep-verify-2026-10-14-111.md": WRONG_111,
    "knowledge/reference/deep-verify-2026-10-14-80.md": CORRECT,
    "knowledge/reference/other-note.md": WRONG_111,
    "knowledge/reference/deep-verify-notes.md": WRONG_111,
  });
  const r = knowledgeCheck(root, { state: null, repo: REPO });
  assert.deepEqual(
    [...new Set(problems(r).map((f) => f.where.split(":")[0]))],
    ["knowledge/reference/deep-verify-2026-10-14-111.md", "knowledge/reference/deep-verify-notes.md"],
    "a report with no date in its file name is examined",
  );
  assert.ok(r.notes.includes("Reports: 3 deep-verify report(s) examined; 1 dated before 2026-10-14, not examined."));
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
