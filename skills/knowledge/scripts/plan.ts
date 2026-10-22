/**
 * The edits of a plan in `knowledge/plan/` (L3-loop-dev §4). An agent changes the graph parts of a plan with this
 * command, not by hand: the chart, the `##` headings and their ✅, the items, a struck node, the answer of a D and
 * the `Now:` line. The steps for agents are in `knowledge`'s `references/spec-and-plan.md`.
 *
 *   node --experimental-strip-types --no-warnings <this folder>/plan.ts <verb> [--cwd <repo>] <file> …
 *
 * Verbs:
 *   check [<file>…] [--against <ref>] [--new]   the rules of `plan-graph.ts`; default: each file in knowledge/plan/
 *   add <file> --code A7 --label "agent：…" [--after X…] [--before Y…] [--body-file f | --item "…"…]
 *   arrow <file> X Y / unarrow <file> X Y
 *   done <file> <code> [--commit <sha>] [--summary "…"]
 *   item <file> <code> --check <id or text> [--evidence "…"] | --add "…" | --drop <id or text> --reason "…"
 *   drop <file> <code> --reason "…"
 *   answer <file> <D code> --option "…" --quote "…" | --skipped
 *   now <index.md> "…"
 *   json <file>
 * Each edit takes `--date YYYY-MM-DD` (default: today, from the clock).
 *
 * Each write parses the file, applies the edit, runs `checkPlan` and `checkTransition` (old → new), and writes only
 * when the edit adds no problem. An edit changes only the lines that it names: the rest of the file stays
 * byte for byte. It exits 1 when it refuses an edit, when an edit adds a problem, or when `check` finds a problem.
 * `check --against <ref> --new` prints only the findings that the file at <ref> does not have, and the
 * transition findings: the hook `plan-hook.mjs` runs it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fenced } from "../../prerelease/scripts/markdown.mjs";
import {
  checkPlan,
  checkTransition,
  codesOf,
  DONE,
  isCode,
  NOW,
  OPEN,
  type Plan,
  type PlanChart,
  type PlanFinding,
  type PlanNode,
  parseChartLine,
  parsePlan,
} from "./plan-graph.ts";

/** An edit that the command refuses: the text says why. */
export class EditError extends Error {}
const refuse = (message: string): never => {
  throw new EditError(message);
};

/** Today in the local time zone: `YYYY-MM-DD`. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- helpers ----------

/** The index of the last line of the text (the empty string after a final newline is not a line). */
const lastLine = (lines: string[]) => (lines.length > 1 && lines[lines.length - 1] === "" ? lines.length - 2 : lines.length - 1);

/** The node of a code: the code itself, its id, or one code of a range (`O4` of `O3–O4`). */
function nodeOf(plan: Plan, code: string): PlanNode {
  return (
    plan.nodes.find((n) => n.code === code) ??
    plan.nodes.find((n) => n.id === code) ??
    plan.nodes.find((n) => codesOf(n.code).includes(code)) ??
    refuse(`${plan.file} has no node ${code}`)
  );
}

const charts = (plan: Plan) => plan.charts.filter((c) => c.section === null);

/** Each place where a chart gives a label to an id: the line index (from 0) and the raw text of the reference. */
function labelsOf(plan: Plan, lines: string[], id: string, only?: PlanChart) {
  const out: { i: number; raw: string; labelEnd: number; label: string }[] = [];
  for (const c of only ? [only] : charts(plan))
    for (let i = c.start; i < c.end - 1; i++)
      for (const r of parseChartLine(lines[i]).refs)
        if (r.id === id && r.label !== null) out.push({ i, raw: lines[i].slice(r.start, r.end), labelEnd: r.labelEnd, label: r.label });
  return out;
}

/** The indent of the node lines of a chart. */
function indentOf(lines: string[], c: PlanChart): string {
  for (let i = c.end - 2; i >= c.start; i--) if (parseChartLine(lines[i]).refs.length) return /^\s*/.exec(lines[i])![0];
  return "  ";
}

/** The index (from 0) where a new line of a chart goes: before its closing fence and before the `style`/`class` lines at its end. */
function chartEnd(lines: string[], c: PlanChart): number {
  let at = c.end - 1;
  while (at - 1 > c.start && /^\s*(?:style|classDef|class|linkStyle|click)\b|^\s*$/.test(lines[at - 1])) at--;
  return at;
}

/** Add lines to a chart; a node of `redraw` that the chart does not label is drawn again first, with its label. */
function addToChart(plan: Plan, lines: string[], c: PlanChart, redraw: PlanNode[], add: string[]) {
  const indent = indentOf(lines, c);
  const out: string[] = [];
  for (const n of redraw)
    if (!labelsOf(plan, lines, n.id, c).length) {
      const first = labelsOf(plan, lines, n.id)[0];
      out.push(`${indent}${first ? first.raw : `${n.id}["${n.label}${n.done ? ` ${DONE}` : ""}"]`}`);
    }
  lines.splice(chartEnd(lines, c), 0, ...out, ...add.map((l) => `${indent}${l}`));
}

/** Put ✅ at the end of each label of a node in the charts. */
function tickLabels(plan: Plan, lines: string[], n: PlanNode) {
  for (const l of labelsOf(plan, lines, n.id))
    if (!l.label.trim().endsWith(DONE)) lines[l.i] = `${lines[l.i].slice(0, l.labelEnd).replace(/\s+$/, "")} ${DONE}${lines[l.i].slice(l.labelEnd)}`;
}

/** Put ✅ at the end of the `##` heading of a node, in place of ⬜. */
function tickHeading(lines: string[], n: PlanNode) {
  const i = n.section!.line - 1;
  lines[i] = `${lines[i].replace(/\s*(?:✅|⬜)?\s*$/, "")} ${DONE}`;
}

/** Replace the body of a section (the lines after its heading) with `body`, kept apart from the next heading by a blank line. */
function setBody(lines: string[], n: PlanNode, body: string[]) {
  const s = n.section!;
  const isLast = s.endLine - 1 >= lastLine(lines);
  lines.splice(s.line, s.endLine - s.line, "", ...body, ...(isLast ? [] : [""]));
}

/** The text of a label after its code and role: 「导出成文件」 of 「A3 agent：导出成文件」. */
const gist = (label: string) => /^[^：:]*[：:]\s*(.+)$/.exec(label)?.[1].trim() ?? label;

/** A date and a note in the form of the plan: 「（2026-10-22，`abc1234`）」 or " (2026-10-22, `abc1234`)". */
const paren = (plan: Plan, parts: string[]) => (plan.lang === "zh" ? `（${parts.join("，")}）` : ` (${parts.join(", ")})`);

/** The section of a node, or a refusal (a node of `index.md`, or a node with no `##` section). */
function sectionOf(plan: Plan, n: PlanNode) {
  if (plan.kind === "index") refuse(`${n.code} is a node of the graph of open work: it has no section`);
  return n.section ?? refuse(`${n.code} has no "## " section`);
}

/** The item of a node that `which` names: its id (`A3.2`), else the one item whose text holds `which`. */
function itemOf(n: PlanNode, which: string) {
  const byId = n.items.filter((it) => it.id === which);
  if (byId.length === 1) return byId[0];
  const byText = n.items.filter((it) => it.text.includes(which));
  if (byText.length === 1) return byText[0];
  return refuse(byText.length ? `${byText.length} items of ${n.code} hold "${which}": give its id or more of its text` : `${n.code} has no item "${which}"`);
}

/** The items under an item (deeper, up to the next item at its depth or less). */
function childrenOf(n: PlanNode, item: PlanNode["items"][number]) {
  const k = n.items.indexOf(item);
  const out = [];
  for (let j = k + 1; j < n.items.length && n.items[j].depth > item.depth; j++) out.push(n.items[j]);
  return out;
}

/** The line of an open item, struck through and checked: `- [ ] text` -> `- [x] ~~text~~`. */
const strike = (line: string) => line.replace(/\[ \]([ \t]+)(.*?)\s*$/, (_m, ws: string, t: string) => `[x]${ws}~~${t}~~`);

/** The path from `from` to `to` along the arrows, or null. */
function path(plan: Plan, from: string, to: string): string[] | null {
  const seen = new Set<string>();
  const walk = (c: string): string[] | null => {
    if (c === to) return [c];
    if (seen.has(c)) return null;
    seen.add(c);
    for (const e of plan.edges.filter((x) => x.from === c)) {
      const p = walk(e.to);
      if (p) return [c, ...p];
    }
    return null;
  };
  return walk(from);
}

// ---------- the edits: text in, text out ----------

export interface AddOptions {
  code: string;
  label: string;
  after?: string[];
  before?: string[];
  body?: string;
  items?: string[];
}

/** Add a node: its labelled line and its arrows to the chart (the last one, the open chart, when there are two), and a `##` section in the order of the chart. */
export function addNode(text: string, file: string, o: AddOptions): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const isIndex = plan.kind === "index";
  const code = o.code.trim();
  let label = o.label.trim();
  let id = code;
  if (isIndex) {
    if (!/^[A-Za-z_]\w*$/.test(code)) refuse(`"${code}" is not a mermaid id (I<N> for an issue)`);
    const n = /^I(\d+)$/.exec(code)?.[1];
    if (n && !label.startsWith(`#${n}`)) label = `#${n} ${label}`;
  } else {
    if (!isCode(code)) refuse(`"${code}" is not a code (A7, D3, O4, E2, M1, O5–O6)`);
    id = codesOf(code)[0];
    if (label.split(/\s+/)[0] !== code) label = `${code} ${label}`;
  }
  const taken = new Set(plan.nodes.flatMap((n) => [...codesOf(n.code), n.id]));
  for (const c of [...codesOf(code), id]) if (taken.has(c)) refuse(`${plan.file} already has ${c}: a code is not used again`);
  if (label.includes('"')) refuse('a label has no " (mermaid ends the label there)');
  const after = (o.after ?? []).map((c) => nodeOf(plan, c));
  const before = (o.before ?? []).map((c) => nodeOf(plan, c));
  for (const b of before) if (b.done) refuse(`${b.code} is ${DONE}: a ${DONE} node does not wait on a new node`);
  const chart = charts(plan).at(-1) ?? refuse(`${plan.file} has no mermaid chart`);

  // The section first: it is below the chart, so the line numbers of the chart stay.
  if (!isIndex) {
    const auto = code[0] === "A" && codesOf(code).length === 1;
    const body = o.body !== undefined ? o.body.replace(/\s+$/, "").split("\n") : (o.items ?? []).map((t, k) => `- [ ] ${auto && !t.startsWith("**") ? `**${code}.${k + 1}** ` : ""}${t}`);
    const block = [`## ${label} ${OPEN}`, "", ...(body.length && body.some((l) => l.trim()) ? [...body, ""] : [])];
    const succ = before.filter((n) => n.section).map((n) => n.section!.line);
    const pred = after.filter((n) => n.section).map((n) => n.section!.endLine);
    const sections = plan.sections.map((s) => s.line);
    // Before the first node that waits on it; else after the last node that it waits on; else at the end.
    const next = succ.length ? Math.min(...succ) : pred.length ? sections.find((l) => l > Math.max(...pred)) : undefined;
    if (next !== undefined) lines.splice(next - 1, 0, ...(lines[next - 2] === "" ? block : ["", ...block]));
    else {
      const end = lastLine(lines);
      const tail = block[block.length - 1] === "" ? block.slice(0, -1) : block;
      lines.splice(end + 1, 0, ...(lines[end] === "" ? tail : ["", ...tail]));
    }
  }
  addToChart(plan, lines, chart, [...after, ...before], [`${id}["${label}"]`, ...after.map((a) => `${a.id} --> ${id}`), ...before.map((b) => `${id} --> ${b.id}`)]);
  return lines.join("\n");
}

/** Add the arrow X --> Y (Y waits on X), one arrow on its own line. */
export function addArrow(text: string, file: string, from: string, to: string): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const a = nodeOf(plan, from);
  const b = nodeOf(plan, to);
  if (a === b) refuse("an arrow goes from one node to another");
  if (plan.edges.some((e) => e.from === a.code && e.to === b.code)) refuse(`the arrow ${a.code} --> ${b.code} is already in the chart`);
  if (b.done) refuse(`${b.code} is ${DONE}: a ${DONE} node does not get a new wait`);
  const loop = path(plan, b.code, a.code);
  if (loop) refuse(`the arrow makes a cycle: ${[...loop, b.code].join(" → ")}`);
  const chart = [...charts(plan)].reverse().find((c) => labelsOf(plan, lines, b.id, c).length) ?? charts(plan).at(-1) ?? refuse(`${plan.file} has no mermaid chart`);
  addToChart(plan, lines, chart, [a, b], [`${a.id} --> ${b.id}`]);
  return lines.join("\n");
}

/** Remove the arrow X --> Y. A label on its line stays, on a line of its own. */
export function removeArrow(text: string, file: string, from: string, to: string): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const a = nodeOf(plan, from);
  const b = nodeOf(plan, to);
  if (b.done) refuse(`${b.code} is ${DONE}: the arrows into a ${DONE} node stay (they are the record)`);
  const hits: number[] = [];
  for (const c of charts(plan))
    for (let i = c.start; i < c.end - 1; i++) {
      const p = parseChartLine(lines[i]);
      if (!p.edges.some(([x, y]) => x.id === a.id && y.id === b.id)) continue;
      if (p.edges.length > 1) refuse(`line ${i + 1} holds ${p.edges.length} arrows: write one arrow on each line first`);
      hits.push(i);
    }
  if (!hits.length) refuse(`the chart has no arrow ${a.code} --> ${b.code}`);
  for (const i of hits.reverse()) {
    const p = parseChartLine(lines[i]);
    const indent = /^\s*/.exec(lines[i])![0];
    lines.splice(i, 1, ...p.refs.filter((r) => r.label !== null).map((r) => `${indent}${lines[i].slice(r.start, r.end)}`));
  }
  return lines.join("\n");
}

/**
 * Tick a node: ✅ on its labels and its heading, and its section compressed to one line
 * `- [x] <summary>（<date>，`sha`）`. In `index.md`: ✅ on the labels and on the first cell of the row of the issue.
 */
export function markDone(text: string, file: string, code: string, o: { commit?: string; summary?: string; date: string }): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const n = nodeOf(plan, code);
  if (n.done) refuse(`${n.code} is already ${DONE}`);
  if (plan.kind === "index") {
    tickLabels(plan, lines, n);
    const num = /^I(\d+)$/.exec(n.code)?.[1];
    const row = num ? plan.rows.find((r) => r.issue === Number(num)) : undefined;
    if (row && !row.done) {
      const i = row.line - 1;
      const at = lines[i].indexOf("|") + 1;
      const end = lines[i].indexOf("|", at);
      lines[i] = `${lines[i].slice(0, at)}${lines[i].slice(at, end).replace(/\s*$/, "")} ${DONE} ${lines[i].slice(end)}`;
    }
    return lines.join("\n");
  }
  sectionOf(plan, n);
  if (n.kind === "D") refuse(`${n.code} is a D: record the answer with plan.ts answer`);
  const open = n.items.filter((it) => !it.checked);
  if (open.length)
    refuse(`${n.code} has ${open.length} open item(s): ${open.map((it) => it.id ?? `line ${it.line}`).join(", ")}. Check each one (plan.ts item --check) or strike it (plan.ts item --drop) first`);
  if (n.kind === "A" && !o.commit) refuse(`${n.code} is an A node: give the commit of its work (--commit <sha>)`);
  const summary = (o.summary ?? gist(n.label)).trim().replace(/[。.]$/, "");
  tickHeading(lines, n);
  setBody(lines, n, [`- [x] ${summary}${paren(plan, [o.date, ...(o.commit ? [`\`${o.commit}\``] : [])])}`]);
  tickLabels(plan, lines, n);
  return lines.join("\n");
}

/** Check an item: `[ ]` -> `[x]`, with the date and the evidence at its end. */
export function checkItem(text: string, file: string, code: string, o: { which: string; evidence?: string; date: string }): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const n = nodeOf(plan, code);
  sectionOf(plan, n);
  if (n.done) refuse(`${n.code} is ${DONE}: its items do not change`);
  const it = itemOf(n, o.which);
  if (it.checked) refuse(`the item ${it.id ?? o.which} is already checked`);
  const open = childrenOf(n, it).filter((c) => !c.checked);
  if (open.length) refuse(`the item ${it.id ?? o.which} has ${open.length} open sub-item(s): check or strike them first`);
  const i = it.line - 1;
  lines[i] = `${lines[i].replace("[ ]", "[x]").replace(/\s+$/, "")}${paren(plan, [o.date, ...(o.evidence ? [o.evidence] : [])])}`;
  return lines.join("\n");
}

/** Add an open item at the end of the items of a node; an A node's item gets the next code (`**A3.4**`). */
export function addItem(text: string, file: string, code: string, o: { text: string }): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const n = nodeOf(plan, code);
  const s = sectionOf(plan, n);
  if (n.done) refuse(`${n.code} is ${DONE}: add a new node for new work`);
  let t = o.text.trim();
  if (n.kind === "A" && !t.startsWith("**")) {
    const max = Math.max(0, ...n.items.map((it) => (it.id?.startsWith(`${n.code}.`) ? Number(it.id.split(".")[1]) : 0)));
    t = `**${n.code}.${max + 1}** ${t}`;
  }
  const item = `- [ ] ${t}`;
  const top = n.items.filter((x) => x.depth === 0).at(-1);
  if (top) {
    let i = top.line; // the line after the item, from 0
    while (i < s.endLine && /^\s+\S/.test(lines[i])) i++;
    lines.splice(i, 0, item);
  } else {
    let i = s.endLine - 1;
    while (i >= s.line && !lines[i].trim()) i--;
    lines.splice(i + 1, 0, "", item);
  }
  return lines.join("\n");
}

/** Strike an open item: `- [x] ~~text~~ 不用做了（date）：reason`, and its open sub-items. */
export function dropItem(text: string, file: string, code: string, o: { which: string; reason: string; date: string }): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const n = nodeOf(plan, code);
  sectionOf(plan, n);
  if (n.done) refuse(`${n.code} is ${DONE}: its items do not change`);
  const it = itemOf(n, o.which);
  if (it.checked) refuse(`the item ${it.id ?? o.which} is checked: done work is not struck`);
  for (const c of childrenOf(n, it)) if (!c.checked) lines[c.line - 1] = strike(lines[c.line - 1]);
  const why = plan.lang === "zh" ? ` 不用做了（${o.date}）：${o.reason}` : ` not needed (${o.date}): ${o.reason}`;
  lines[it.line - 1] = `${strike(lines[it.line - 1])}${why}`;
  return lines.join("\n");
}

/** Strike a node (「不做了的划掉，不删」): a first line `- [x] ~~**<label>**~~ 不用做了（date）：reason`, each open item struck, ✅ on the heading and the labels. */
export function dropNode(text: string, file: string, code: string, o: { reason: string; date: string }): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const n = nodeOf(plan, code);
  if (plan.kind === "index") refuse(`${n.code} is a node of the graph of open work: a closed issue gets ${DONE} (plan.ts done)`);
  sectionOf(plan, n);
  if (n.done) refuse(`${n.code} is ${DONE}: a ${DONE} node is not struck`);
  for (const it of n.items) if (!it.checked) lines[it.line - 1] = strike(lines[it.line - 1]);
  const why = plan.lang === "zh" ? ` 不用做了（${o.date}）：${o.reason}` : ` not needed (${o.date}): ${o.reason}`;
  lines.splice(n.section!.line, 0, "", `- [x] ~~**${n.label}**~~${why}`);
  tickHeading(lines, n);
  tickLabels(plan, lines, n);
  return lines.join("\n");
}

/** The recommended option of a D: the text after 「推荐：」 or "Recommended:" on the first option that has it. */
function recommended(n: PlanNode): string | null {
  for (const line of n.section!.body.split("\n")) {
    const m = /(?:推荐|Recommended|recommended)\s*[：:]\s*(.+?)(?:\*\*|[。.](?:\s|$)|$)/.exec(line);
    if (m && /^\s*(?:[-*+]|\d+[.)])\s/.test(line)) return m[1].trim().replace(/[。.，,；;]+$/, "");
  }
  return null;
}

/**
 * Record the answer of a D, and tick it. The owner's answer: the section becomes one line
 * 「owner 定的（date，「quote」）：option」. A skipped D keeps its text, under the line
 * 「Agent decided (date)：<the recommended option>，因为这个 D 被跳过了。」
 */
export function answerD(text: string, file: string, code: string, o: { option?: string; quote?: string; skipped?: boolean; date: string }): string {
  const plan = parsePlan(text, file);
  const lines = text.split("\n");
  const n = nodeOf(plan, code);
  sectionOf(plan, n);
  if (n.kind !== "D") refuse(`${n.code} is not a D`);
  if (n.done) refuse(`${n.code} is already ${DONE}`);
  const zh = plan.lang === "zh";
  if (o.skipped) {
    const rec = recommended(n) ?? (zh ? "推荐的那一个" : "the recommended option");
    tickHeading(lines, n);
    lines.splice(n.section!.line, 0, "", zh ? `Agent decided (${o.date})：${rec}，因为这个 D 被跳过了。` : `Agent decided (${o.date}): ${rec}, because the owner skipped this D.`);
  } else {
    if (!o.option || !o.quote) refuse("give the option (--option) and the owner's words (--quote), or --skipped");
    tickHeading(lines, n);
    setBody(lines, n, [zh ? `owner 定的（${o.date}，「${o.quote}」）：${o.option}` : `Owner decided (${o.date}, "${o.quote}"): ${o.option}`]);
  }
  tickLabels(plan, lines, n);
  return lines.join("\n");
}

/** Set the `Now:` line of `index.md`; with no such line, add `> **Now:** …` under the title. */
export function setNow(text: string, file: string, now: string): string {
  const plan = parsePlan(text, file);
  if (plan.kind !== "index") refuse(`${plan.file} is not the graph of open work (knowledge/plan/index.md)`);
  const lines = text.split("\n");
  const value = now.trim().replace(/\s*\n\s*/g, " ");
  if (plan.nowLine) {
    const i = plan.nowLine - 1;
    lines[i] = lines[i].replace(NOW, (_m, prefix: string) => `${prefix}${value}`);
  } else {
    const code = fenced(lines);
    const title = lines.findIndex((l, i) => !code[i] && /^#[ \t]/.test(l));
    lines.splice(title + 1, 0, "", `> **Now:** ${value}`);
  }
  return lines.join("\n");
}

// ---------- the check of an edit ----------

const key = (f: PlanFinding) => `${f.kind}\u0000${f.text}`;

/** The findings of `after` that `before` does not have (by kind and text), and the transition findings. */
export function newFindings(before: string | null, after: string, file: string): PlanFinding[] {
  const a = parsePlan(after, file);
  const fa = checkPlan(a, after);
  if (before === null) return fa;
  const b = parsePlan(before, file);
  const count = new Map<string, number>();
  for (const f of checkPlan(b, before)) count.set(key(f), (count.get(key(f)) ?? 0) + 1);
  const fresh = fa.filter((f) => {
    const c = count.get(key(f)) ?? 0;
    if (c) count.set(key(f), c - 1);
    return c === 0;
  });
  return [...fresh, ...checkTransition(b, a)];
}

/** Apply an edit and check it: `ok` is false when the edit adds a problem; then nothing must be written. */
export function applyEdit(before: string, file: string, edit: (text: string) => string) {
  const text = edit(before);
  const findings = newFindings(before, text, file);
  return { text, findings, ok: !findings.some((f) => f.kind === "problem") };
}

/** The lines that the command prints: problems, then questions, then the count. */
export function format(findings: PlanFinding[]): string[] {
  const problems = findings.filter((f) => f.kind === "problem");
  const questions = findings.filter((f) => f.kind === "question");
  return [...problems.map((f) => `problem ${f.where}: ${f.text}`), ...questions.map((f) => `question ${f.where}: ${f.text}`), `${problems.length} problem(s), ${questions.length} question(s).`];
}

// ---------- the command ----------

/** The Markdown files under `knowledge/plan/` of a repo, from its root. */
function planFiles(root: string, dir = "knowledge/plan"): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .flatMap((name) => (statSync(join(full, name)).isDirectory() ? planFiles(root, `${dir}/${name}`) : name.endsWith(".md") ? [`${dir}/${name}`] : []))
    .sort();
}

/** The text of a file at a git ref, or null when it is not there. */
function atRef(root: string, ref: string, path: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

/** The short sha of a commit of the repo, or a refusal. */
function commitOf(root: string, sha: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "--verify", "--quiet", `${sha}^{commit}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return refuse(`the commit ${sha} is not in the repo at ${root}`);
  }
}

/** The verbs, for `plan.ts help` and for a call with no verb. */
export const USAGE = [
  "plan.ts <verb> [--cwd <repo>] … (knowledge's references/spec-and-plan.md; L3-loop-dev §4)",
  "  check [<file>…] [--against <ref>] [--new]",
  '  add <file> --code A7 --label "agent：…" [--after X…] [--before Y…] [--body-file f | --item "…"…]',
  "  arrow <file> X Y | unarrow <file> X Y",
  '  done <file> <code> [--commit <sha>] [--summary "…"]',
  '  item <file> <code> --check <id or text> [--evidence "…"] | --add "…" | --drop <id or text> --reason "…"',
  '  drop <file> <code> --reason "…"',
  '  answer <file> <D code> --option "…" --quote "…" | --skipped',
  '  now <index.md> "…"',
  "  json <file>",
  "  Each edit takes --date YYYY-MM-DD (default: today).",
];

export function main(argv: string[], out: (line: string) => void = console.log): number {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      cwd: { type: "string" },
      against: { type: "string" },
      new: { type: "boolean" },
      code: { type: "string" },
      label: { type: "string" },
      after: { type: "string", multiple: true },
      before: { type: "string", multiple: true },
      "body-file": { type: "string" },
      item: { type: "string", multiple: true },
      commit: { type: "string" },
      summary: { type: "string" },
      check: { type: "string" },
      evidence: { type: "string" },
      add: { type: "string" },
      drop: { type: "string" },
      reason: { type: "string" },
      option: { type: "string" },
      quote: { type: "string" },
      skipped: { type: "boolean" },
      date: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const root = resolve(v.cwd ?? process.cwd());
  const [verb, ...args] = positionals;
  if (!verb || verb === "help" || v.help) {
    for (const line of USAGE) out(line);
    return verb || v.help ? 0 : 1;
  }
  const rel = (p: string) => relative(root, resolve(root, p)).split(sep).join("/");
  const date = v.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    out(`refused: --date ${date} is not YYYY-MM-DD`);
    return 1;
  }
  try {
    if (verb === "check") {
      const files = args.length ? args.map(rel) : planFiles(root);
      const findings: PlanFinding[] = [];
      for (const file of files) {
        if (!existsSync(join(root, file))) refuse(`${file} is not there`);
        const text = readFileSync(join(root, file), "utf8");
        if (v.against) {
          const before = atRef(root, v.against, file);
          if (v.new) findings.push(...newFindings(before, text, file));
          else {
            const plan = parsePlan(text, file);
            findings.push(...checkPlan(plan, text));
            if (before !== null) findings.push(...checkTransition(parsePlan(before, file), plan));
          }
        } else findings.push(...checkPlan(parsePlan(text, file), text));
      }
      for (const line of format(findings)) out(line);
      return findings.some((f) => f.kind === "problem") ? 1 : 0;
    }
    if (verb === "json") {
      const file = rel(args[0] ?? refuse("give a file"));
      out(JSON.stringify(parsePlan(readFileSync(join(root, file), "utf8"), file), null, 2));
      return 0;
    }
    const file = rel(args[0] ?? refuse(`give a file: plan.ts ${verb ?? "<verb>"} <file> …`));
    const path = join(root, file);
    if (!existsSync(path)) refuse(`${file} is not there`);
    const need = (value: string | undefined, name: string) => value ?? refuse(`${verb} needs ${name}`);
    let edit: (text: string) => string;
    switch (verb) {
      case "add": {
        const body = v["body-file"] !== undefined ? readFileSync(resolve(root, v["body-file"]), "utf8") : undefined;
        edit = (t) => addNode(t, file, { code: need(v.code, "--code"), label: need(v.label, "--label"), after: v.after, before: v.before, body, items: v.item });
        break;
      }
      case "arrow":
      case "unarrow": {
        const [x, y] = [args[1], args[2]];
        if (!x || !y) refuse(`${verb} needs two codes: plan.ts ${verb} <file> X Y`);
        edit = (t) => (verb === "arrow" ? addArrow(t, file, x, y) : removeArrow(t, file, x, y));
        break;
      }
      case "done": {
        const commit = v.commit ? commitOf(root, v.commit) : undefined;
        edit = (t) => markDone(t, file, need(args[1], "a code"), { commit, summary: v.summary, date });
        break;
      }
      case "item": {
        const code = need(args[1], "a code");
        if ([v.check, v.add, v.drop].filter((x) => x !== undefined).length !== 1) refuse("item needs one of --check, --add, --drop");
        if (v.check !== undefined) edit = (t) => checkItem(t, file, code, { which: v.check!, evidence: v.evidence, date });
        else if (v.add !== undefined) edit = (t) => addItem(t, file, code, { text: v.add! });
        else edit = (t) => dropItem(t, file, code, { which: v.drop!, reason: need(v.reason, "--reason"), date });
        break;
      }
      case "drop":
        edit = (t) => dropNode(t, file, need(args[1], "a code"), { reason: need(v.reason, "--reason"), date });
        break;
      case "answer":
        edit = (t) => answerD(t, file, need(args[1], "a code"), { option: v.option, quote: v.quote, skipped: v.skipped, date });
        break;
      case "now":
        edit = (t) => setNow(t, file, need(args[1], 'the text: plan.ts now <index.md> "…"'));
        break;
      default:
        return refuse(`unknown verb "${verb ?? ""}": check, add, arrow, unarrow, done, item, drop, answer, now, json`);
    }
    const before = readFileSync(path, "utf8");
    const r = applyEdit(before, file, edit);
    if (!r.ok) {
      out(`not written: the edit adds a problem to ${file}`);
      for (const line of format(r.findings)) out(line);
      return 1;
    }
    if (r.text !== before) writeFileSync(path, r.text);
    out(`wrote ${file}`);
    for (const line of format(r.findings)) out(line);
    return 0;
  } catch (e) {
    if (!(e instanceof EditError)) throw e;
    out(`refused: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exit(main(process.argv.slice(2)));
