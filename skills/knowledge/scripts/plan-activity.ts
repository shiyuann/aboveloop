/**
 * The activity of one plan: what changed in it, from git, with no database. Pure: Plans in, events out.
 * The server `plan-view.ts` reads the versions of the file with git and gives them here, oldest first.
 *
 * - `diffPlans(before, after)`: the events of one change. A node added, ✅, dropped, removed; an item checked
 *   or dropped; a D answered (with the quote of its section); an arrow added or removed; `Now:` changed; a group
 *   (`Plan.groups`) proposed, changed, removed, or opened as an issue.
 *   An arrow from or to a node that the same change adds or removes is part of that node, not an event.
 * - `planActivity(versions, working, plan)`: every event, newest first: the uncommitted change, then the
 *   commits, then the `> - ` log lines of the plan (`Plan.log`) by their date.
 * - `answerOf(node)`: who answered a D, and the quote, from its section.
 */
import type { Plan, PlanGroup, PlanItem, PlanNode } from "./plan-graph.ts";

export type ActivityKind =
  | "add"
  | "done"
  | "answer"
  | "tick"
  | "drop"
  | "remove"
  | "arrow-add"
  | "arrow-remove"
  | "now"
  | "log"
  | "propose"
  | "regroup"
  | "unpropose"
  | "issue";

export interface ActivityEvent {
  /** Stable over reloads: the page knows which events are new. */
  id: string;
  kind: ActivityKind;
  /** The node code, or null (a `Now:` line or a log line that names no node). For a group event: its first node. */
  node: string | null;
  /** The group code ("P1", "I42") of a group event, else null. */
  group: string | null;
  /** The item id ("A3.2"), else the start of its text; null for an event of a node. */
  item: string | null;
  /** One line for the list. */
  text: string;
  /** "answer" only: the quote of the owner, when the section holds one. */
  quote: string | null;
  /** "arrow-add" and "arrow-remove" only. */
  from: string | null;
  to: string | null;
  source: "commit" | "uncommitted" | "log";
  sha: string | null;
  /** ISO 8601. The author date of a commit, the mtime of an uncommitted file, the day of a log line. */
  date: string | null;
  subject: string | null;
  author: string | null;
}

/** One committed version of the plan file. */
export interface PlanVersion {
  sha: string;
  date: string;
  author: string;
  subject: string;
  plan: Plan;
}

/** What `diffPlans` gives: an event with no commit facts yet. */
export type Change = Pick<ActivityEvent, "kind" | "node" | "group" | "item" | "text" | "quote" | "from" | "to">;

const change = (kind: ActivityKind, node: string | null, text: string, extra: Partial<Change> = {}): Change => ({
  kind,
  node,
  group: null,
  item: null,
  text,
  quote: null,
  from: null,
  to: null,
  ...extra,
});

/** Markdown marks off, one line, at most `max` characters. */
export function plain(text: string, max = 120): string {
  const t = text
    .replace(/~~|\*\*|__|`/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const QUOTE = /「([^」]+)」|“([^”]+)”|"([^"]+)"/;
const OWNER_ANSWER = /owner\s*定的|owner\s*说|owner\s+decided|owner\s*\(\d{4}-\d{2}-\d{2}\)/i;
const AGENT_ANSWER = /agent\s*定的|agent\s+decided/i;

/** Who answered a D and the quote of the owner, from its section. `by` is null when the section says neither. */
export function answerOf(node: PlanNode): { by: "owner" | "agent" | null; quote: string | null; line: string | null } {
  const lines = (node.section?.body ?? "").split("\n");
  for (const [re, by] of [
    [OWNER_ANSWER, "owner"],
    [AGENT_ANSWER, "agent"],
  ] as const) {
    const at = lines.findIndex((l) => re.test(l));
    if (at < 0) continue;
    // The quote is on the line, or on the next lines of the same paragraph.
    let quote: string | null = null;
    for (let i = at; i < lines.length && i < at + 4 && (i === at || lines[i].trim() !== ""); i++) {
      const m = QUOTE.exec(lines[i]);
      if (m) {
        quote = m[1] ?? m[2] ?? m[3] ?? null;
        break;
      }
    }
    return { by, quote: by === "owner" ? quote : null, line: plain(lines[at].replace(/^\s*[-*]\s*(\[[ xX]\]\s*)?/, ""), 300) };
  }
  return { by: null, quote: null, line: null };
}

/** Pairs each item of `after` with its item of `before`, or null (a new item). By id, then by the same text,
 *  then by order among the items still unpaired. */
function pairItems(before: PlanItem[], after: PlanItem[]): [PlanItem | null, PlanItem][] {
  const used = new Set<PlanItem>();
  const byId = new Map(before.filter((i) => i.id).map((i) => [i.id, i]));
  const pairs: [PlanItem | null, PlanItem][] = after.map((a) => {
    const b = a.id ? byId.get(a.id) : undefined;
    if (b) used.add(b);
    return [b ?? null, a];
  });
  for (const p of pairs) {
    if (p[0] || p[1].id) continue;
    const b = before.find((i) => !i.id && !used.has(i) && i.text === p[1].text);
    if (b) {
      used.add(b);
      p[0] = b;
    }
  }
  const rest = before.filter((i) => !i.id && !used.has(i));
  for (const p of pairs) {
    if (p[0] || p[1].id) continue;
    const b = rest.shift();
    if (!b) break;
    p[0] = b;
  }
  return pairs;
}

const itemRef = (i: PlanItem) => i.id ?? plain(i.text, 60);

/** The first node code that a text names, or null. */
export function nodeIn(text: string, codes: string[]): string | null {
  let best: { at: number; code: string } | null = null;
  for (const code of codes) {
    const esc = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?<![A-Za-z0-9])${esc}(?![0-9])(?!\\.\\d)`).exec(text);
    if (m && (!best || m.index < best.at || (m.index === best.at && code.length > best.code.length))) {
      best = { at: m.index, code };
    }
  }
  return best?.code ?? null;
}

/** The group events of one change. A proposal that goes out in the same change as a new issue group with a
 *  node of it is one event: the proposal opened as that issue. */
function groupChanges(before: Plan | null, after: Plan): Change[] {
  const old = new Map((before?.groups ?? []).map((g) => [g.code, g]));
  const now = new Map((after.groups ?? []).map((g) => [g.code, g]));
  const gone = [...old.values()].filter((g) => !now.has(g.code));
  const name = (g: PlanGroup) => (g.kind === "issue" ? `#${g.issue}` : g.code);
  const out: Change[] = [];
  for (const g of after.groups ?? []) {
    const b = old.get(g.code);
    const first = g.nodes[0] ?? null;
    if (!b && g.kind === "issue") {
      const from = gone.find((p) => p.kind === "proposal" && p.nodes.some((c) => g.nodes.includes(c)));
      if (from) gone.splice(gone.indexOf(from), 1);
      const text = from ? `${from.code} opened as #${g.issue}: ${plain(g.title)}` : `#${g.issue} added: ${plain(g.title)}`;
      out.push(change("issue", first, text, { group: g.code }));
    } else if (!b) {
      out.push(change("propose", first, `${g.code} proposed: ${plain(g.title)} (${g.nodes.join(", ")})`, { group: g.code }));
    } else {
      const plus = g.nodes.filter((c) => !b.nodes.includes(c));
      const minus = b.nodes.filter((c) => !g.nodes.includes(c));
      if (plus.length || minus.length) {
        const parts = [...plus.map((c) => `+${c}`), ...minus.map((c) => `−${c}`)].join(" ");
        out.push(change("regroup", plus[0] ?? first, `${name(g)}: ${parts}`, { group: g.code }));
      }
    }
  }
  for (const g of gone) {
    out.push(change("unpropose", g.nodes[0] ?? null, `${name(g)} removed: ${plain(g.title)}`, { group: g.code }));
  }
  return out;
}

/** The events of one change of a plan. `before` null: the file is new, and each node is added. */
export function diffPlans(before: Plan | null, after: Plan): Change[] {
  const old = new Map((before?.nodes ?? []).map((n) => [n.code, n]));
  const now = new Map(after.nodes.map((n) => [n.code, n]));
  const ends: Change[] = [];
  const drops: Change[] = [];
  const ticks: Change[] = [];
  const adds: Change[] = [];
  const removes: Change[] = [];
  for (const n of after.nodes) {
    const b = old.get(n.code);
    if (!b) {
      adds.push(change("add", n.code, `${n.code} added: ${plain(n.label)}`));
      continue;
    }
    if (n.done && !b.done) {
      if (n.kind === "D") {
        const a = answerOf(n);
        const who = a.by === "agent" ? "agent decided" : "answered";
        ends.push(change("answer", n.code, `${n.code} ${who}: ${plain(n.label)}`, { quote: a.quote }));
      } else {
        ends.push(change("done", n.code, `${n.code} ✅ ${plain(n.label)}`));
      }
    }
    if (n.dropped && !b.dropped) drops.push(change("drop", n.code, `${n.code} dropped: ${plain(n.label)}`));
    for (const [bi, ai] of pairItems(b.items, n.items)) {
      if (ai.dropped && !bi?.dropped) {
        drops.push(change("drop", n.code, ai.id ? `${ai.id} dropped` : `dropped: ${plain(ai.text, 80)}`, { item: itemRef(ai) }));
      } else if (ai.checked && !ai.dropped && !bi?.checked) {
        ticks.push(change("tick", n.code, `checked: ${plain(ai.text, 80)}`, { item: itemRef(ai) }));
      }
    }
  }
  for (const b of before?.nodes ?? []) {
    if (!now.has(b.code)) removes.push(change("remove", b.code, `${b.code} removed: ${plain(b.label)}`));
  }
  const key = (e: { from: string; to: string }) => `${e.from}\u0000${e.to}`;
  const oldEdges = new Set((before?.edges ?? []).map(key));
  const newEdges = new Set(after.edges.map(key));
  const arrows: Change[] = [];
  if (before) {
    for (const e of after.edges) {
      if (!oldEdges.has(key(e)) && old.has(e.from) && old.has(e.to)) {
        arrows.push(change("arrow-add", e.to, `arrow ${e.from} → ${e.to} added`, { from: e.from, to: e.to }));
        oldEdges.add(key(e));
      }
    }
    for (const e of before.edges) {
      if (!newEdges.has(key(e)) && now.has(e.from) && now.has(e.to)) {
        arrows.push(change("arrow-remove", e.to, `arrow ${e.from} → ${e.to} removed`, { from: e.from, to: e.to }));
        newEdges.add(key(e));
      }
    }
  }
  const out = [...ends, ...drops, ...ticks, ...adds, ...removes, ...groupChanges(before, after), ...arrows];
  const line = (p: Plan | null) => p?.now ?? null;
  if (before && line(after) !== line(before) && line(after)) {
    out.push(change("now", nodeIn(line(after) ?? "", after.nodes.map((n) => n.code)), `Now: ${plain(line(after) ?? "", 200)}`));
  }
  return out;
}

/** The date at the start of a log line ("2026-10-20：…"), as ISO, or null. */
function logDate(line: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(line);
  return m ? `${m[1]}T00:00:00Z` : null;
}

const time = (d: string | null) => (d ? Date.parse(d) : Number.NEGATIVE_INFINITY);

/**
 * Every event of a plan, newest first.
 * - `versions`: the committed versions, oldest first. The first is diffed against no plan (each node added).
 * - `working`: the plan on disk when it differs from the newest version, with the file's mtime; else null.
 * - `plan`: the current plan, for its log lines.
 */
export function planActivity(
  versions: PlanVersion[],
  working: { plan: Plan; date: string } | null,
  plan: Plan,
): ActivityEvent[] {
  const commits: ActivityEvent[][] = [];
  let prev: Plan | null = null;
  for (const v of versions) {
    commits.push(
      diffPlans(prev, v.plan).map((c, i) => ({
        ...c,
        id: `${v.sha}:${i}`,
        source: "commit" as const,
        sha: v.sha,
        date: v.date,
        subject: v.subject,
        author: v.author,
      })),
    );
    prev = v.plan;
  }
  const uncommitted: ActivityEvent[] = working
    ? diffPlans(prev, working.plan).map((c) => ({
        ...c,
        id: `work:${c.kind}:${c.node ?? ""}:${c.item ?? ""}:${c.from ?? ""}:${c.to ?? ""}`,
        source: "uncommitted" as const,
        sha: null,
        date: working.date,
        subject: "now (uncommitted)",
        author: null,
      }))
    : [];
  const codes = plan.nodes.map((n) => n.code);
  const logs: ActivityEvent[] = plan.log.map((raw, i) => {
    const text = raw.replace(/^>\s*-\s*/, "").trim();
    return {
      ...change("log", nodeIn(text, codes), plain(text, 300)),
      id: `log:${i}:${text}`,
      source: "log" as const,
      sha: null,
      date: logDate(text),
      subject: null,
      author: null,
    };
  });
  // Commits newest first (git order is by commit time; sort by author date, stable).
  const committed = commits.reverse().flat();
  const rest = [...committed, ...logs].map((e, at) => ({ e, at }));
  rest.sort((a, b) => time(b.e.date) - time(a.e.date) || a.at - b.at);
  return [...uncommitted, ...rest.map((r) => r.e)];
}
