import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePlan } from "./plan-graph.ts";
import { BOX_HEAD, BOX_PREFIX, type LayoutEdge, type LayoutInput, NODE_H, NODE_W, type PlanLayout, planLayout } from "./plan-layout.ts";
import { type IssueFact, planStages } from "./plan-stages.ts";

const fixture = (name: string, file: string) => parsePlan(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), file);

/** The segments of a route that pass through the inside of a node. */
function through(layout: PlanLayout, e: LayoutEdge): string[] {
  const hits: string[] = [];
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i];
    assert.ok(a.x === b.x || a.y === b.y, `${e.via}: a segment is not level or upright`);
    for (const [code, r] of Object.entries(layout.nodes)) {
      const inX = Math.max(a.x, b.x) > r.x + 1 && Math.min(a.x, b.x) < r.x + NODE_W - 1;
      const inY = Math.max(a.y, b.y) > r.y + 1 && Math.min(a.y, b.y) < r.y + NODE_H - 1;
      if (inX && inY) hits.push(`${e.via.join(",")} through ${code}`);
    }
  }
  return hits;
}

/** The segments of a route that pass through the name of a box. */
function throughNames(layout: PlanLayout, e: LayoutEdge): string[] {
  const hits: string[] = [];
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i];
    for (const r of layout.boxes) {
      const inX = Math.max(a.x, b.x) > r.x + 1 && Math.min(a.x, b.x) < r.x + r.width - 1;
      const inY = Math.max(a.y, b.y) > r.y + 1 && Math.min(a.y, b.y) < r.y + BOX_HEAD - 1;
      if (inX && inY) hits.push(`${e.via.join(",")} through the name of ${r.id}`);
    }
  }
  return hits;
}

/** Each pair of arrows that lie on one line for more than a point, apart from the first segments out of one start
 *  and the last segments into one end. */
function shared(edges: LayoutEdge[]): string[] {
  const out: string[] = [];
  const same = (u: { x: number; y: number }, v: { x: number; y: number }) => u.x === v.x && u.y === v.y;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const p = edges[i].points, q = edges[j].points;
      for (let k = 0; k + 1 < p.length; k++) {
        for (let m = 0; m + 1 < q.length; m++) {
          const [a, b, c, d] = [p[k], p[k + 1], q[m], q[m + 1]];
          const level = a.y === b.y && c.y === d.y && a.y === c.y;
          const upright = a.x === b.x && c.x === d.x && a.x === c.x;
          const len = level
            ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
            : upright
              ? Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
              : 0;
          if (len <= 1) continue;
          if (k === 0 && m === 0 && same(p[0], q[0])) continue;
          if (k === p.length - 2 && m === q.length - 2 && same(p.at(-1) as never, q.at(-1) as never)) continue;
          out.push(`${edges[i].via.join(",")} and ${edges[j].via.join(",")}`);
        }
      }
    }
  }
  return out;
}

function inputOf(plan: ReturnType<typeof parsePlan>, issues = new Map<number, IssueFact>()): LayoutInput {
  const st = planStages(plan, issues);
  return {
    nodes: plan.nodes.map((n) => n.code),
    edges: plan.edges,
    stages: st.stages,
    stageOf: st.nodes,
    groupOf: Object.fromEntries(plan.nodes.map((n) => [n.code, n.group])),
  };
}

test("the bands are side by side in the order of the stages, and an empty band is narrow", () => {
  const l = planLayout(inputOf(fixture("alpha.txt", "knowledge/plan/alpha.md")));
  assert.deepEqual(l.bands.map((b) => b.stage), ["proposal", "explore", "spec", "implement", "merge", "release"]);
  for (let i = 1; i < l.bands.length; i++) assert.ok(l.bands[i].x > l.bands[i - 1].x + l.bands[i - 1].width, "a gap between two bands");
  assert.deepEqual(l.bands.filter((b) => b.empty).map((b) => b.stage), ["spec", "implement", "merge"]);
  assert.ok(l.bands.filter((b) => b.empty).every((b) => b.width < NODE_W));
  // Each node is inside its band, and each node of a group inside the box of its group in that band.
  for (const [code, p] of Object.entries(l.nodes)) {
    const band = l.bands.find((b) => b.x <= p.x && p.x + NODE_W <= b.x + b.width);
    assert.ok(band, `${code} is in a band`);
  }
  const box = l.boxes.find((b) => b.group === "P2");
  assert.ok(box && ["A3", "A4"].every((c) => l.nodes[c].x > box.x && l.nodes[c].y > box.y && l.nodes[c].x + NODE_W < box.x + box.width && l.nodes[c].y + NODE_H < box.y + box.height));
});

test("a group with nodes in two stages has a box in each band; the band stacks the nodes of no group first", () => {
  const l = planLayout({
    nodes: ["D1", "A1", "A2", "A3", "A4"],
    edges: [
      { from: "D1", to: "A1" },
      { from: "A1", to: "A2" },
      { from: "A2", to: "A3" },
      { from: "A3", to: "A4" },
    ],
    stages: ["spec", "implement"],
    stageOf: { D1: "spec", A1: "spec", A2: "implement", A3: "implement", A4: "implement" },
    groupOf: { D1: null, A1: "P1", A2: "P1", A3: null, A4: "P1" },
  });
  assert.deepEqual(l.boxes.map((b) => [b.id, b.first]), [["P1@spec", true], ["P1@implement", false]]);
  assert.ok(l.nodes.D1.y < l.nodes.A1.y, "the node of no group is above the box");
  // The arrows that cross the edge of a box end at its ports; arrows with the same two ends are one.
  const port = l.edges.filter((e) => e.from.startsWith(BOX_PREFIX) || e.to.startsWith(BOX_PREFIX));
  assert.deepEqual(port.map((e) => [e.from, e.to, e.via]), [
    ["D1", `${BOX_PREFIX}P1@spec`, ["D1>A1"]],
    [`${BOX_PREFIX}P1@spec`, `${BOX_PREFIX}P1@implement`, ["A1>A2"]],
    [`${BOX_PREFIX}P1@implement`, "A3", ["A2>A3"]],
    ["A3", `${BOX_PREFIX}P1@implement`, ["A3>A4"]],
  ]);
  assert.equal(l.all.length, 4);
  assert.ok(l.all.every((e) => !e.from.startsWith(BOX_PREFIX) && !e.to.startsWith(BOX_PREFIX)));
});

test("arrows into one box from one node are one arrow that names each", () => {
  const l = planLayout({
    nodes: ["D1", "A1", "A2"],
    edges: [
      { from: "D1", to: "A1" },
      { from: "D1", to: "A2" },
    ],
    stages: ["proposal"],
    stageOf: {},
    groupOf: { A1: "P1", A2: "P1" },
  });
  assert.deepEqual(l.edges.map((e) => e.via), [["D1>A1", "D1>A2"]]);
});

test("no arrow runs through a node: each fixture, with the arrows to the ports and with all arrows", () => {
  for (const [name, file] of [
    ["alpha.txt", "knowledge/plan/alpha.md"],
    ["42-export.txt", "knowledge/plan/42-export.md"],
    ["index.txt", "knowledge/plan/index.md"],
    ["7-english.txt", "knowledge/plan/7-english.md"],
  ]) {
    const l = planLayout(inputOf(fixture(name, file)));
    for (const e of [...l.edges, ...l.all]) assert.deepEqual(through(l, e), [], name);
  }
});

/** A milestone plan with areas in four stages, done work in release that earlier work waits on, and the plans of
 *  two issues. */
const beta = () => {
  const fact = (issue: number, stage: IssueFact["stage"]): IssueFact => ({ issue, where: "worktree", file: "", ref: null, stage, next: [] });
  return planLayout(inputOf(fixture("beta.txt", "knowledge/plan/beta.md"), new Map([[7, fact(7, "implement")], [9, fact(9, "spec")]])));
};

test("no arrow runs through a node or the name of a box, with the ports and with all arrows", () => {
  const l = beta();
  assert.deepEqual(l.boxes.map((b) => b.stage), ["proposal", "explore", "spec", "implement", "release"]);
  for (const e of [...l.edges, ...l.all]) {
    assert.deepEqual(through(l, e), []);
    assert.deepEqual(throughNames(l, e), []);
  }
  for (const [name, file] of [["alpha.txt", "knowledge/plan/alpha.md"], ["42-export.txt", "knowledge/plan/42-export.md"]]) {
    const a = planLayout(inputOf(fixture(name, file)));
    for (const e of [...a.edges, ...a.all]) assert.deepEqual(throughNames(a, e), [], name);
  }
});

test("no two arrows run on one line: only the first segments out of one start or the last into one end", () => {
  const l = beta();
  assert.deepEqual(shared(l.edges), []);
  assert.deepEqual(shared(l.all), []);
  for (const [name, file] of [
    ["alpha.txt", "knowledge/plan/alpha.md"],
    ["42-export.txt", "knowledge/plan/42-export.md"],
    ["index.txt", "knowledge/plan/index.md"],
    ["7-english.txt", "knowledge/plan/7-english.md"],
  ]) {
    const a = planLayout(inputOf(fixture(name, file)));
    assert.deepEqual(shared(a.edges), [], name);
    assert.deepEqual(shared(a.all), [], name);
  }
});

test("no arrow runs through a node: a wide graph with long arrows inside a cell and back to an earlier band", () => {
  const nodes = Array.from({ length: 14 }, (_, i) => `A${i + 1}`);
  const edges = [
    ["A1", "A2"], ["A2", "A3"], ["A3", "A4"], ["A1", "A4"], ["A1", "A5"], ["A5", "A6"], ["A2", "A6"], ["A6", "A7"],
    ["A4", "A8"], ["A8", "A9"], ["A9", "A10"], ["A3", "A10"], ["A11", "A12"], ["A12", "A1"], ["A10", "A13"], ["A13", "A14"],
    ["A14", "A11"], ["A7", "A13"],
  ].map(([from, to]) => ({ from, to }));
  const stageOf: Record<string, string> = {};
  const groupOf: Record<string, string | null> = {};
  nodes.forEach((c, i) => {
    stageOf[c] = ["spec", "implement", "release"][Math.min(2, Math.floor(i / 5))];
    groupOf[c] = i % 3 === 0 ? "P1" : i % 3 === 1 ? null : "P2";
  });
  const l = planLayout({ nodes, edges, stages: ["spec", "implement", "merge", "release"], stageOf, groupOf });
  for (const e of [...l.edges, ...l.all]) {
    assert.deepEqual(through(l, e), []);
    assert.deepEqual(throughNames(l, e), []);
  }
  assert.deepEqual(shared(l.edges), []);
  assert.deepEqual(shared(l.all), []);
  // Each route starts at the right side of its start and ends at the left side of its end.
  for (const e of l.all) {
    assert.equal(e.points[0].x, l.nodes[e.from].x + NODE_W);
    assert.equal(e.points.at(-1)?.x, l.nodes[e.to].x);
  }
});
