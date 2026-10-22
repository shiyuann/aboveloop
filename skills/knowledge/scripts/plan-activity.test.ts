import assert from "node:assert/strict";
import { test } from "node:test";
import { answerOf, diffPlans, planActivity } from "./plan-activity.ts";
import type { Plan, PlanItem, PlanNode } from "./plan-graph.ts";

/** A plan in the shape of `plan-graph.ts`, with no parser: the tests do not depend on it. */
function plan(nodes: Partial<PlanNode>[], edges: [string, string][] = [], extra: Partial<Plan> = {}): Plan {
  return {
    file: "knowledge/plan/42-export.md",
    kind: "issue",
    title: "my-app #42 plan",
    update: null,
    now: null,
    log: [],
    notes: "",
    nodes: nodes.map((n, i) => ({
      code: "A1",
      kind: "A",
      label: "A1 agent",
      done: false,
      dropped: false,
      section: null,
      items: [],
      chartLine: i + 1,
      ...n,
    })) as PlanNode[],
    edges: edges.map(([from, to], i) => ({ from, to, line: i + 1 })),
    ...extra,
  };
}

const item = (text: string, extra: Partial<PlanItem> = {}): PlanItem => ({
  id: null,
  text,
  checked: false,
  dropped: false,
  depth: 0,
  line: 1,
  ...extra,
});

const section = (body: string) => ({ line: 1, endLine: 9, title: "x", body });

const kinds = (cs: { kind: string; node: string | null }[]) => cs.map((c) => `${c.kind} ${c.node}`);

test("a change of a plan gives one event for each node ✅, item checked, node and item dropped, D answered, arrow and Now:", () => {
  const before = plan(
    [
      { code: "A1", label: "A1 agent：调研", items: [item("**A1.1 读文档**", { id: "A1.1" }), item("跑一遍")] },
      { code: "D1", kind: "D", label: "D1 owner 拍板：存在哪" },
      { code: "A2", label: "A2 agent：导出", items: [item("**A2.1 导出**", { id: "A2.1" }), item("**A2.2 上传**", { id: "A2.2" })] },
      { code: "O1", kind: "O", label: "O1 owner：spec review" },
    ],
    [
      ["A1", "O1"],
      ["D1", "O1"],
    ],
    { now: "等 owner：D1" },
  );
  const after = plan(
    [
      // The text of an item changes when it is checked: it still pairs, by id or by order.
      { code: "A1", label: "A1 agent：调研", done: true, items: [item("**A1.1 读文档**（2026-10-20，`abc1234`）", { id: "A1.1", checked: true }), item("跑一遍（2026-10-20）", { checked: true })] },
      {
        code: "D1",
        kind: "D",
        label: "D1 owner 拍板：存在哪",
        done: true,
        section: section("问题：存在哪？\n\nowner 定的（2026-10-20，「放桶里，别放库里」）：桶。"),
      },
      {
        code: "A2",
        label: "A2 agent：导出",
        items: [item("**A2.1 导出**", { id: "A2.1" }), item("~~**A2.2 上传**~~ 不用做了", { id: "A2.2", checked: true, dropped: true })],
      },
      { code: "O1", kind: "O", label: "O1 owner：spec review" },
      { code: "A3", label: "A3 agent：新的" },
    ],
    [
      ["A1", "O1"],
      ["O1", "A2"],
      ["A2", "A3"],
    ],
    { now: "等 owner：O1 spec review" },
  );
  const events = diffPlans(before, after);
  assert.deepEqual(kinds(events), [
    "done A1",
    "answer D1",
    "drop A2",
    "tick A1",
    "tick A1",
    "add A3",
    "arrow-add A2",
    "arrow-remove O1",
    "now O1",
  ]);
  const answer = events.find((e) => e.kind === "answer");
  assert.equal(answer?.quote, "放桶里，别放库里");
  assert.equal(events.find((e) => e.kind === "drop")?.item, "A2.2");
  // The arrow A2 → A3 comes with the new node A3: it is not an event of its own.
  assert.equal(events.filter((e) => e.kind === "arrow-add").length, 1);
  assert.deepEqual(
    events.filter((e) => e.kind.startsWith("arrow")).map((e) => `${e.from}->${e.to}`),
    ["O1->A2", "D1->O1"],
  );
});

test("a new file adds each node, with no arrow events; a removed node is one event with its arrows", () => {
  const first = plan([{ code: "A1" }, { code: "O1", kind: "O" }], [["A1", "O1"]]);
  assert.deepEqual(kinds(diffPlans(null, first)), ["add A1", "add O1"]);
  const second = plan([{ code: "O1", kind: "O" }]);
  assert.deepEqual(kinds(diffPlans(first, second)), ["remove A1"]);
});

test("a D that the agent decided (skipped) has no quote of the owner", () => {
  const d = { code: "D2", kind: "D" as const, label: "D2", done: true, dropped: false, items: [], chartLine: 1 };
  const a = answerOf({ ...d, section: section("- [x] Agent decided (2026-10-21): CSV, because the owner skipped this D.") });
  assert.equal(a.by, "agent");
  assert.equal(a.quote, null);
  const o = answerOf({ ...d, section: section('Owner decided (2026-10-21, "CSV is fine"): CSV.') });
  assert.deepEqual([o.by, o.quote], ["owner", "CSV is fine"]);
});

test("the activity is newest first: the uncommitted change, then the commits and the log lines by date", () => {
  const v1 = plan([{ code: "A1" }]);
  const v2 = plan([{ code: "A1", done: true }]);
  const now = plan([{ code: "A1", done: true }, { code: "A2" }], [], {
    log: ["> - 2026-10-21：加了 A2", "> - 2026-10-19：开工 A1"],
  });
  const events = planActivity(
    [
      { sha: "aaa", date: "2026-10-18T10:00:00Z", author: "o", subject: "plan", plan: v1 },
      { sha: "bbb", date: "2026-10-20T10:00:00Z", author: "o", subject: "A1 done", plan: v2 },
    ],
    { plan: now, date: "2026-10-22T09:00:00Z" },
    now,
  );
  assert.deepEqual(
    events.map((e) => `${e.source} ${e.kind} ${e.node} ${e.sha ?? "-"}`),
    [
      "uncommitted add A2 -",
      "log log A2 -",
      "commit done A1 bbb",
      "log log A1 -",
      "commit add A1 aaa",
    ],
  );
  // Ids are stable: a reload of the same history gives the same ids.
  assert.equal(events[2].id, "bbb:0");
  assert.equal(events[0].id, "work:add:A2:::");
});
