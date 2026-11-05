import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePlan } from "./plan-graph.ts";
import { type IssueFact, issueStage, nextNodes, openBefore, planStages, stagesOf } from "./plan-stages.ts";

const fixture = (name: string, file: string) => parsePlan(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), file);
/** The fixture with these nodes ticked ✅ on their labels and headings, and their open items checked. */
function ticked(name: string, file: string, codes: string[]) {
  let text = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  const plan = parsePlan(text, file);
  for (const c of codes) {
    const n = plan.nodes.find((x) => x.code === c);
    assert.ok(n);
    text = text.replaceAll(`"${n.label}"`, `"${n.label} ✅"`).replace(`## ${n.label} ⬜`, `## ${n.label} ✅`);
  }
  return parsePlan(text, file);
}

test("the stages of each kind of plan are steps of the life of an issue, in order", () => {
  assert.deepEqual(stagesOf("issue"), ["spec", "implement", "merge", "release"]);
  assert.deepEqual(stagesOf("index"), ["explore", "spec", "implement", "merge", "release"]);
  assert.deepEqual(stagesOf("milestone"), ["proposal", "explore", "spec", "implement", "merge", "release"]);
});

test("the plan of an issue: the stage of each node from its kind and its arrows", () => {
  const s = planStages(fixture("42-export.txt", "knowledge/plan/42-export.md"));
  assert.deepEqual(s.nodes, {
    // Before the last spec review, a D, and the O before an agent node: the spec step.
    A1: "spec", D1: "spec", O1: "spec", A2: "spec", O2: "spec", D2: "spec", "O3–O4": "spec",
    // The agent nodes after it.
    A3: "implement", A4: "implement", A6: "implement",
    // The release O, and the nodes that wait on main after it.
    O5: "release", A5: "release", E1: "release",
  });
  assert.equal(s.current, "spec");
  assert.deepEqual(s.groups, {});
});

test("an O that comes before no agent node is done before the merge", () => {
  const plan = parsePlan(
    [
      "# my-app #8 plan：x",
      "",
      "```mermaid",
      "flowchart LR",
      '  O1["O1 owner：spec review ✅"] --> A1["A1 agent：做 ✅"]',
      '  A1 --> O2["O2 owner：在真机上跑一遍"]',
      "```",
      "",
      "## O1 owner：spec review ✅",
      "",
      "## A1 agent：做 ✅",
      "",
      "## O2 owner：在真机上跑一遍 ⬜",
      "",
    ].join("\n"),
    "knowledge/plan/8-x.md",
  );
  const s = planStages(plan);
  assert.equal(s.nodes.O2, "merge");
  assert.equal(s.current, "merge");
});

test("the stage of an issue from its plan: the earliest stage of its open nodes; a plan not merged is at most merge", () => {
  const plan = fixture("42-export.txt", "knowledge/plan/42-export.md");
  assert.equal(issueStage(plan, true), "spec");
  const coded = ticked("42-export.txt", "knowledge/plan/42-export.md", ["A2", "O2", "D2", "O3–O4"]);
  assert.equal(issueStage(coded, true), "implement");
  const built = ticked("42-export.txt", "knowledge/plan/42-export.md", ["A2", "O2", "D2", "O3–O4", "A3", "A4", "A6"]);
  assert.equal(issueStage(built, true), "release");
  assert.equal(issueStage(built, false), "merge");
  assert.deepEqual(nextNodes(plan).map((n) => [n.code, n.state]), [["A2", "ready"], ["D2", "waits"], ["O3–O4", "waits"]]);
});

test("a milestone plan: each group is in the stage of its issue, a proposal before them", () => {
  const plan = fixture("alpha.txt", "knowledge/plan/alpha.md");
  // #7 has no plan yet: explore.
  let s = planStages(plan);
  assert.deepEqual(s.nodes, { O1: "proposal", A1: "release", A2: "explore", A3: "proposal", A4: "proposal", A5: "proposal", D1: "proposal", O2: "release" });
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.groups).map(([c, g]) => [c, [g.stage, g.openBefore]])),
    { I7: ["explore", []], P2: ["proposal", ["D1"]], P4: ["proposal", ["A3"]] },
  );
  assert.equal(s.current, "proposal");
  // The plan of #7 on its branch, in the spec step.
  const fact: IssueFact = { issue: 7, where: "branch", file: "knowledge/plan/7-x.md", ref: "origin/issues/7", stage: "spec", next: [] };
  s = planStages(plan, new Map([[7, fact]]));
  assert.equal(s.groups.I7.stage, "spec");
  assert.equal(s.groups.I7.issue, fact);
  assert.equal(s.nodes.A2, "spec");
});

test("the graph of open work: an issue is in the stage of its plan, a closed one in release", () => {
  const plan = fixture("index.txt", "knowledge/plan/index.md");
  const fact: IssueFact = { issue: 44, where: "worktree", file: "knowledge/plan/44-x.md", ref: null, stage: "implement", next: [] };
  const s = planStages(plan, new Map([[44, fact]]));
  assert.equal(s.nodes.I44, "implement");
  assert.equal(s.nodes.I43, "explore");
  assert.equal(s.nodes.I36, "release");
  assert.equal(s.nodes.REL, "release");
  // An event takes the stage of what waits on it.
  assert.equal(s.nodes.E1, "explore");
});

test("what an open node waits on: the open nodes right before it", () => {
  assert.deepEqual(openBefore(fixture("alpha.txt", "knowledge/plan/alpha.md")), {
    A4: ["A3", "D1"],
    A5: ["A3"],
    O2: ["A2", "A4", "A5"],
  });
});
