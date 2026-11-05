/**
 * Where each node of a plan is in the life of an issue: the state of each node, and its stage. Pure: a Plan and
 * the facts of its issues in, the states and the stages out. The server `plan-view.ts` reads the facts with git
 * and gives the result to the page, which only draws it.
 *
 * - `nodeStates(plan)`: done, dropped, ready (能做), waits (等) or blocked, from the ✅ marks and the arrows.
 * - `planStages(plan, issues)`: the stage of each node and each group, and the current stage of the plan.
 * - `issueStage(plan, merged)`: the stage of one issue, from its own plan.
 *
 * The stages are the steps of the life of an issue, as `builder` and `dev` name them (aboveloop's L2-loop-builder
 * §1 and §3): an issue is explored, its spec step writes the spec and the plan, its implement step does the agent
 * nodes, the owner merges its PR, and a release ships it. A milestone plan has one stage before them: the A nodes
 * that are not an issue yet, in a proposal or in no group. No stage is new, and no stage is stored in the plan
 * file: a stage comes from the kind of a node, its arrows, and the plan of its issue.
 * The owner (on deepdev, the same viewer): 「the stages need to match the current progress labels … instead of
 * reinventing a new stage system」.
 */
import type { Plan, PlanNode } from "./plan-graph.ts";

/** In the order of the life of an issue. */
export const STAGES = ["proposal", "explore", "spec", "implement", "merge", "release"] as const;
export type Stage = (typeof STAGES)[number];

/**
 * - done, dropped: the node is ✅, or struck through.
 * - ready (能做): every incoming node is done or dropped, and an agent does it (not D, O, E).
 * - waits (等): every incoming node is done or dropped, and it is a D, an O or an E: the owner or an event moves.
 * - blocked: an incoming node is open.
 */
export type NodeState = "done" | "dropped" | "ready" | "waits" | "blocked";

export const finished = (n: { done: boolean; dropped: boolean }) => n.done || n.dropped;
const OUTSIDE = new Set(["D", "O", "E"]);

export function nodeStates(plan: Plan): Record<string, NodeState> {
  const byCode = new Map(plan.nodes.map((n) => [n.code, n]));
  const states: Record<string, NodeState> = {};
  for (const n of plan.nodes) {
    if (n.dropped) states[n.code] = "dropped";
    else if (n.done) states[n.code] = "done";
    else {
      const open = plan.edges.filter((e) => e.to === n.code).some((e) => {
        const p = byCode.get(e.from);
        return p ? !finished(p) : false;
      });
      states[n.code] = open ? "blocked" : OUTSIDE.has(n.kind) ? "waits" : "ready";
    }
  }
  return states;
}

/** The open nodes right before each open node: what it waits on. A node with none has no entry. */
export function openBefore(plan: Plan): Record<string, string[]> {
  const byCode = new Map(plan.nodes.map((n) => [n.code, n]));
  const out: Record<string, string[]> = {};
  for (const e of plan.edges) {
    const from = byCode.get(e.from), to = byCode.get(e.to);
    if (!from || !to || finished(from) || finished(to)) continue;
    if (!(out[to.code] ??= []).includes(from.code)) out[to.code].push(from.code);
  }
  return out;
}

/** The stages that a plan of this kind can hold. The plan of an issue starts at its spec step; the graph of open
 *  work holds issues, which start at explore. */
export function stagesOf(kind: Plan["kind"]): Stage[] {
  if (kind === "issue") return ["spec", "implement", "merge", "release"];
  if (kind === "index") return ["explore", "spec", "implement", "merge", "release"];
  return [...STAGES];
}

/** What git tells of one issue: where its plan is, and the stage of that plan. */
export interface IssueFact {
  issue: number;
  /** The plan is a file of the checkout (`worktree`), or only on the branch `issues/<N>` (`branch`). */
  where: "worktree" | "branch";
  /** The path of the plan. */
  file: string;
  /** The branch that holds the plan, for `branch`. */
  ref: string | null;
  /** `issueStage` of the plan. */
  stage: Stage;
  /** The open nodes of that plan whose turn it is (ready or waits), in chart order, at most 3. */
  next: { code: string; label: string; state: NodeState }[];
}

const isRelease = (n: PlanNode) =>
  n.kind === "M" || ((n.kind === "O" || n.kind === "X") && /发版|release/i.test(n.label));
const isSpecReview = (n: PlanNode) => n.kind === "O" && /spec review/i.test(n.label);

/** The arrows of a plan as two maps of codes, with only the codes of its nodes. */
function arrows(plan: Plan) {
  const has = new Set(plan.nodes.map((n) => n.code));
  const after = new Map<string, string[]>(), before = new Map<string, string[]>();
  for (const e of plan.edges) {
    if (!has.has(e.from) || !has.has(e.to) || e.from === e.to) continue;
    after.set(e.from, [...(after.get(e.from) ?? []), e.to]);
    before.set(e.to, [...(before.get(e.to) ?? []), e.from]);
  }
  return { after, before };
}

/** Every node that a path of arrows reaches from `starts`, with the starts. */
function reach(starts: string[], next: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const c = stack.pop() as string;
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...(next.get(c) ?? []));
  }
  return seen;
}

/**
 * Give each node with no stage of its own a stage from its arrows: the earliest stage of the nodes that wait on
 * it, else the latest stage of the nodes before it, else the first stage. A loop (the check forbids it) gives
 * "no stage" on the way, not a hang.
 */
function fill(plan: Plan, own: Map<string, number | null>, stages: Stage[]): Record<string, Stage> {
  const { after, before } = arrows(plan);
  const forward = new Map<string, number | null>();
  const visiting = new Set<string>();
  const forwardOf = (c: string): number | null => {
    if (forward.has(c)) return forward.get(c) ?? null;
    const o = own.get(c) ?? null;
    if (o !== null) return forward.set(c, o), o;
    if (visiting.has(c)) return null;
    visiting.add(c);
    const later = (after.get(c) ?? []).map(forwardOf).filter((i): i is number => i !== null);
    visiting.delete(c);
    const at = later.length ? Math.min(...later) : null;
    forward.set(c, at);
    return at;
  };
  const index = new Map<string, number>();
  const walking = new Set<string>();
  const indexOf = (c: string): number => {
    const known = index.get(c);
    if (known !== undefined) return known;
    const f = forwardOf(c);
    if (f !== null) return index.set(c, f), f;
    if (walking.has(c)) return 0;
    walking.add(c);
    const at = Math.max(0, ...(before.get(c) ?? []).map(indexOf));
    walking.delete(c);
    index.set(c, at);
    return at;
  };
  const out: Record<string, Stage> = {};
  for (const n of plan.nodes) out[n.code] = stages[indexOf(n.code)];
  return out;
}

/**
 * The stage of each node of the plan of an issue (`stagesOf("issue")`), from its kind and its arrows:
 *
 * - release: a release O, and each node after it (it waits on `main` after the release);
 * - spec: a D, a spec review O, an O before an agent node (the spec step ends when every D and O before the agent
 *   nodes is done), and each node before a node of the spec step;
 * - implement: an A node;
 * - merge: an O that comes before no agent node: the owner does it before the merge;
 * - each other node (E, X): the stage of the nodes that wait on it, else of the nodes before it.
 */
function issueNodeStages(plan: Plan): Record<string, Stage> {
  const stages = stagesOf("issue");
  const at = (s: Stage) => stages.indexOf(s);
  const { after } = arrows(plan);
  const released = reach(plan.nodes.filter(isRelease).map((n) => n.code), after);
  const own = new Map<string, number | null>();
  for (const n of plan.nodes) {
    if (released.has(n.code)) own.set(n.code, at("release"));
    else if (n.kind === "D" || isSpecReview(n)) own.set(n.code, at("spec"));
    else if (n.kind === "O") {
      const later = reach([n.code], after);
      const beforeAgent = plan.nodes.some((m) => m.kind === "A" && m.code !== n.code && later.has(m.code) && !released.has(m.code));
      own.set(n.code, at(beforeAgent ? "spec" : "merge"));
    } else if (n.kind === "A") own.set(n.code, at("implement"));
    else own.set(n.code, null);
  }
  // A node before a node of an earlier stage moves back to that stage: the arrows go from left to right.
  const order = [...plan.nodes].reverse();
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of order) {
      const o = own.get(n.code);
      if (o === null || o === undefined || released.has(n.code)) continue;
      const later = (after.get(n.code) ?? []).map((c) => own.get(c)).filter((i): i is number => i !== null && i !== undefined);
      const min = Math.min(o, ...later);
      if (min < o) {
        own.set(n.code, min);
        changed = true;
      }
    }
  }
  return fill(plan, own, stages);
}

/**
 * The stage of an issue, from its own plan: the earliest stage of its open nodes; release when no node is open.
 * A plan that is only on the branch of the issue is not merged: at most merge.
 */
export function issueStage(plan: Plan, merged: boolean): Stage {
  const nodes = issueNodeStages(plan);
  const stages = stagesOf("issue");
  const open = plan.nodes.filter((n) => !finished(n)).map((n) => stages.indexOf(nodes[n.code]));
  const stage = stages[open.length ? Math.min(...open) : stages.length - 1];
  return !merged && stage === "release" ? "merge" : stage;
}

/** The open nodes of a plan whose turn it is, for `IssueFact.next`. */
export function nextNodes(plan: Plan): IssueFact["next"] {
  const states = nodeStates(plan);
  return plan.nodes
    .filter((n) => states[n.code] === "ready" || states[n.code] === "waits")
    .slice(0, 3)
    .map((n) => ({ code: n.code, label: n.label, state: states[n.code] }));
}

export interface GroupStage {
  stage: Stage;
  /** The fact of its issue from git (an issue group), or null. */
  issue: IssueFact | null;
  /** The open nodes outside the group that a node of the group waits on. */
  openBefore: string[];
}

export interface PlanStages {
  /** The stage bands of the plan, in order. */
  stages: Stage[];
  /** Where the plan is: for the plan of an issue, `issueStage`; else the earliest stage with an open node. */
  current: Stage;
  nodes: Record<string, Stage>;
  groups: Record<string, GroupStage>;
}

/** The stage of an issue that a plan names (an issue group, or `I<N>` in `index.md`): closed when each of its
 *  nodes here is done or dropped; else the stage of its own plan; else explore (it has no plan yet). */
function stageOfIssue(fact: IssueFact | undefined, closed: boolean): Stage {
  if (closed) return "release";
  return fact ? fact.stage : "explore";
}

/**
 * The stage of each node and each group of a plan. `issues` holds the facts of the issues that the plan names.
 *
 * - The plan of an issue: `issueNodeStages`.
 * - A milestone plan: a node of a group is in the stage of its group. A proposal is in `proposal`; an issue group
 *   is in the stage of its issue. An open A node in no group is not an issue yet: `proposal`; a done one is closed:
 *   `release`. A release O and an M are in `release`. Each other node (D, O, E) is in the stage of the nodes that
 *   wait on it.
 * - `index.md`: `I<N>` is in the stage of issue N; a release is in `release`; each other node as above.
 */
export function planStages(plan: Plan, issues: Map<number, IssueFact> = new Map()): PlanStages {
  const stages = stagesOf(plan.kind);
  const groups: Record<string, GroupStage> = {};
  const before = openBefore(plan);
  for (const g of plan.groups ?? []) {
    const members = plan.nodes.filter((n) => g.nodes.includes(n.code));
    const fact = g.kind === "issue" && g.issue !== null ? issues.get(g.issue) : undefined;
    const stage = g.kind === "proposal" ? "proposal" : stageOfIssue(fact, members.length > 0 && members.every(finished));
    const outside = [...new Set(members.flatMap((n) => before[n.code] ?? []))].filter((c) => !g.nodes.includes(c));
    groups[g.code] = { stage, issue: fact ?? null, openBefore: outside };
  }
  let nodes: Record<string, Stage>;
  if (plan.kind === "issue") nodes = issueNodeStages(plan);
  else {
    const at = (s: Stage) => stages.indexOf(s);
    const own = new Map<string, number | null>();
    for (const n of plan.nodes) {
      const g = n.group ? groups[n.group] : undefined;
      if (g) own.set(n.code, at(g.stage));
      else if (n.kind === "I") {
        const num = Number(/^I(\d+)$/.exec(n.code)?.[1] ?? Number.NaN);
        own.set(n.code, at(stageOfIssue(issues.get(num), finished(n))));
      } else if (isRelease(n)) own.set(n.code, at("release"));
      else if (n.kind === "A" && plan.kind === "milestone") own.set(n.code, at(finished(n) ? "release" : "proposal"));
      else own.set(n.code, null);
    }
    nodes = fill(plan, own, stages);
  }
  const open = plan.nodes.filter((n) => !finished(n)).map((n) => stages.indexOf(nodes[n.code]));
  const current = plan.kind === "issue" ? issueStage(plan, true) : stages[open.length ? Math.min(...open) : stages.length - 1];
  return { stages, current, nodes, groups };
}

export interface Progress {
  /** The chain of the stages: before the stage of the plan now, the stage now, after it; with the nodes in each. */
  steps: { stage: Stage; position: "past" | "current" | "future"; done: number; total: number }[];
  done: number;
  total: number;
  /** The open nodes whose turn it is, in chart order: a D, an O or an E (等), and the agent's (能做). */
  waits: { code: string; label: string; kind: string }[];
  ready: { code: string; label: string }[];
  /** The open nodes that wait on open work. */
  blocked: number;
}

/** Where a plan is on its way: the chain of its stages, and its counts. */
export function progressOf(plan: Plan, stages: PlanStages): Progress {
  const states = nodeStates(plan);
  const now = stages.stages.indexOf(stages.current);
  const steps = stages.stages.map((stage, i) => {
    const mine = plan.nodes.filter((n) => stages.nodes[n.code] === stage);
    return {
      stage,
      position: (i < now ? "past" : i === now ? "current" : "future") as Progress["steps"][number]["position"],
      done: mine.filter(finished).length,
      total: mine.length,
    };
  });
  return {
    steps,
    done: plan.nodes.filter(finished).length,
    total: plan.nodes.length,
    waits: plan.nodes.filter((n) => states[n.code] === "waits").map((n) => ({ code: n.code, label: n.label, kind: n.kind })),
    ready: plan.nodes.filter((n) => states[n.code] === "ready").map((n) => ({ code: n.code, label: n.label })),
    blocked: plan.nodes.filter((n) => states[n.code] === "blocked").length,
  };
}
