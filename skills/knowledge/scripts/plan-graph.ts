/**
 * The graph of a plan in `knowledge/plan/`: one strict parser, and the rules of `knowledge`'s
 * `references/spec-and-plan.md` that a script can decide (L3-loop-dev §4). Pure: strings in, objects out;
 * no file, no process. `plan.ts` (the edits and the command), `knowledge-check.ts`, the hook `plan-hook.mjs`
 * and `prerelease`'s `cleanup.ts` use it; a viewer can send a `Plan` as JSON unchanged.
 *
 * Three kinds of plan file, by name: `plan/index.md` (the graph of open work), `plan/<N>-<words>.md` (the plan
 * of one issue) and `plan/<name>.md` (the plan of a milestone).
 *
 * - The charts: each mermaid block before the first `##` heading. A mermaid block inside a `##` section is
 *   the small chart of that node: its nodes are `###` subsections, not nodes of the plan (`Plan.charts`).
 * - A node: a mermaid id with a label, in any shape (`ID["text"]`, `ID("text")`, `ID{"text"}`, …). Its code is
 *   the first word of the label in a plan of an issue or a milestone (`A3`, `O3–O4`), and the id in
 *   `index.md` (`I42`, `alphaO15`). An arrow goes from code to code.
 * - A section: a `##` heading outside code, with the lines up to the next `#` or `##` heading. Its code is
 *   the first word of its title.
 */
import { fenced, fences } from "../../prerelease/scripts/markdown.mjs";

/** A = agent, D = owner decides, O = owner step, E = external event, M = milestone,
 *  I = an issue node of plan/index.md (`I<N>`), X = any other code (e.g. `alphaO15`). */
export type PlanNodeKind = "A" | "D" | "O" | "E" | "M" | "I" | "X";

export interface PlanItem {
  /** "A3.2" when the item text starts with a bold code, else null. */
  id: string | null;
  text: string; // the item line after the checkbox, raw markdown
  checked: boolean; // - [x]
  dropped: boolean; // - [x] ~~…~~ 不用做了 / struck through
  depth: number; // 0 = top-level list item
  line: number; // 1-based line in the file
}

export interface PlanSection {
  line: number; // the `##` heading, 1-based
  endLine: number; // the last line of the section (blank lines before the next heading too)
  title: string; // the heading text after `## `, with its mark
  body: string; // the lines after the heading, to endLine
}

export interface PlanNode {
  code: string; // "A3", "O3–O4", "I42", "alphaO15"
  kind: PlanNodeKind;
  label: string; // the mermaid label without the trailing " ✅"
  done: boolean; // ✅ in the label (index.md) or on the ## heading (issue / milestone plan)
  dropped: boolean; // every item struck through, or heading/label struck through
  /** The `##` section of the node, or null (index.md nodes have none). */
  section: PlanSection | null;
  items: PlanItem[];
  chartLine: number; // line of the first labelled appearance in a mermaid block
  // Added to the contract:
  id: string; // the mermaid id: "A3", "O3" of "O3–O4", "I42"
  /** The shape of the first labelled appearance: its opening bracket, with `"` when the label is quoted (`["`). */
  shape: string;
  /** The mark at the end of the `##` heading, or null (no mark, or no section). */
  mark: "✅" | "⬜" | null;
  /** Each line where a chart gives the node a label (a node drawn again in a second chart). */
  labelLines: number[];
}

export interface PlanEdge {
  from: string;
  to: string;
  line: number;
}

/** A mermaid block (added to the contract). */
export interface PlanChart {
  start: number; // the opening fence, 1-based
  end: number; // the closing fence
  direction: string | null; // "TB", "LR", …
  /** null for a chart of the plan; the code of the `##` section that holds a small chart. */
  section: string | null;
}

/** A `##` section (added to the contract): each one, also one with no node. */
export interface PlanHeading extends PlanSection {
  code: string | null;
  mark: "✅" | "⬜" | null;
}

/** A table row of `index.md` (added to the contract). */
export interface PlanRow {
  line: number;
  first: string; // the first cell
  done: boolean; // the first cell ends with ✅
  issue: number | null; // the first `#N` of the first cell
}

export interface Plan {
  file: string; // as passed in, repo-relative
  kind: "index" | "issue" | "milestone"; // plan/index.md, plan/<N>-*.md, plan/<name>.md
  title: string; // the `#` heading
  update: string | null; // the `> **更新 …**` / `> **Updated …**` line, raw
  now: string | null; // the `Now:` text (index.md), else null
  log: string[]; // the `> - ` record lines under the update line
  notes: string; // the prose under the chart(s), before the first `##`
  nodes: PlanNode[]; // in chart order
  edges: PlanEdge[];
  // Added to the contract:
  lang: "zh" | "en"; // the labels use 「：」 (Chinese) or ": " (English)
  charts: PlanChart[];
  sections: PlanHeading[];
  rows: PlanRow[]; // index.md only
  nowLine: number | null; // the line of the `Now:` text (index.md)
}

export interface PlanFinding {
  kind: "problem" | "question";
  where: string /* file:line */;
  text: string;
}

export const DONE = "✅";
export const OPEN = "⬜";

/** A code of a node in a plan of an issue or a milestone: `A3`, `O3–O4` (also `O3-O4`, `O3–4`). */
const CODE = /^([A-Z])(\d+)(?:[–-]([A-Z]?)(\d+))?$/;

/** True when a word is the code of a node in a plan of an issue or a milestone (`A3`, `O3–O4`). */
export const isCode = (word: string) => CODE.test(word);

/** The `Now:` line of `index.md`: its prefix (`> **Now:** `) and its text. */
export const NOW = /^((?:>\s*)?(?:[-*]\s+)?(?:\*\*)?Now[:：](?:\*\*)?\s*)(.*)$/;

/** The codes that a code holds: `O3–O4` -> `O3`, `O4`; `A3` -> `A3`; any other code -> itself. */
export function codesOf(code: string): string[] {
  const m = CODE.exec(code);
  if (!m || !m[4]) return [code];
  const out: string[] = [];
  const letter = m[3] || m[1];
  if (letter !== m[1]) return [code];
  for (let n = Number(m[2]); n <= Number(m[4]) && out.length < 50; n++) out.push(`${m[1]}${n}`);
  return out.length ? out : [code];
}

/** The kind of a code. */
export function kindOf(code: string, file: "index" | "issue" | "milestone"): PlanNodeKind {
  if (file === "index" && /^I\d+$/.test(code)) return "I";
  const m = /^([ADOEM])\d+(?:[–-][A-Z]?\d+)?$/.exec(code);
  return m ? (m[1] as PlanNodeKind) : "X";
}

/** The kind of a plan file, from its path. */
export function planKind(file: string): Plan["kind"] {
  const name = file.split(/[\\/]/).pop() ?? file;
  if (name === "index.md") return "index";
  return /^\d+-/.test(name) ? "issue" : "milestone";
}

// ---------- the mermaid charts ----------

/** One node reference on a chart line. `start`/`end`: the whole reference; `labelStart`/`labelEnd`: the label text. */
export interface ChartRef {
  id: string;
  label: string | null;
  shape: string; // the opening bracket, with `"` when quoted; "" for a bare id
  start: number;
  end: number;
  labelStart: number;
  labelEnd: number;
}

/** One line of a chart: its node references, its arrows (as pairs of references), and what could not be read. */
export interface ChartLine {
  refs: ChartRef[];
  edges: [ChartRef, ChartRef][];
  /** A statement that holds no node: `flowchart`, `style`, `classDef`, `subgraph`, `end`, a comment, an empty line. */
  other: boolean;
  /** The text after the last part that the parser could read; "" when it read the whole line. */
  rest: string;
}

const OPENERS: [string, string][] = [
  ["(((", ")))"],
  ["([", "])"],
  ["[[", "]]"],
  ["[(", ")]"],
  ["((", "))"],
  ["{{", "}}"],
  ["[/", "/]"],
  ["[\\", "\\]"],
  ["[", "]"],
  ["(", ")"],
  ["{", "}"],
  [">", "]"],
];
const KEYWORD = /^(flowchart|graph|subgraph|end|direction|style|classDef|class|linkStyle|click)\b/;
const ID = /[A-Za-z_][A-Za-z0-9_]*/y;
/** An arrow, with an optional `|text|`; or a text arrow such as `-- text -->`. */
const ARROW = /(?:<|o|x)?(?:-{2,}|={2,}|-\.+-|~{3,})(?:>|o|x)?(?:\s*\|[^|]*\|)?/y;
const TEXT_ARROW = /(?:--|==|-\.)\s+[^|>]+?\s+(?:-{2,}>?|={2,}>?|\.+->?)/y;

/** Parse one line inside a mermaid block. It never throws: a part that it cannot read is in `rest`. */
export function parseChartLine(line: string): ChartLine {
  const out: ChartLine = { refs: [], edges: [], other: false, rest: "" };
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("%%") || KEYWORD.test(trimmed)) {
    out.other = true;
    return out;
  }
  let pos = 0;
  const ws = () => {
    while (pos < line.length && /\s/.test(line[pos])) pos++;
  };
  const ref = (): ChartRef | null => {
    ws();
    ID.lastIndex = pos;
    const m = ID.exec(line);
    if (!m) return null;
    const start = pos;
    pos = ID.lastIndex;
    const r: ChartRef = { id: m[0], label: null, shape: "", start, end: pos, labelStart: pos, labelEnd: pos };
    for (const [open, close] of OPENERS) {
      if (!line.startsWith(open, pos)) continue;
      let p = pos + open.length;
      let quoted = false;
      let labelStart = p;
      let labelEnd: number;
      if (line[p] === '"') {
        const q = line.indexOf('"', p + 1);
        if (q < 0) return r;
        quoted = true;
        labelStart = p + 1;
        labelEnd = q;
        p = q + 1;
        if (!line.startsWith(close, p)) return r;
      } else {
        const c = line.indexOf(close, p);
        if (c < 0) return r;
        labelEnd = c;
        p = c;
      }
      r.label = line.slice(labelStart, labelEnd);
      r.shape = open + (quoted ? '"' : "");
      r.labelStart = labelStart;
      r.labelEnd = labelEnd;
      pos = p + close.length;
      r.end = pos;
      break;
    }
    const cls = /:::[\w-]+/y;
    cls.lastIndex = pos;
    if (cls.exec(line)) pos = cls.lastIndex;
    return r;
  };
  const group = (): ChartRef[] | null => {
    const first = ref();
    if (!first) return null;
    const g = [first];
    for (;;) {
      const save = pos;
      ws();
      if (line[pos] !== "&") {
        pos = save;
        return g;
      }
      pos++;
      const next = ref();
      if (!next) {
        pos = save;
        return g;
      }
      g.push(next);
    }
  };
  let prev = group();
  if (!prev) {
    out.rest = line.trim();
    return out;
  }
  out.refs.push(...prev);
  for (;;) {
    const save = pos;
    ws();
    let matched = false;
    for (const re of [TEXT_ARROW, ARROW]) {
      re.lastIndex = pos;
      if (re.exec(line)) {
        pos = re.lastIndex;
        matched = true;
        break;
      }
    }
    if (!matched) {
      pos = save;
      break;
    }
    const next = group();
    if (!next) {
      pos = save;
      break;
    }
    out.refs.push(...next);
    for (const a of prev) for (const b of next) out.edges.push([a, b]);
    prev = next;
  }
  const rest = line.slice(pos).trim();
  out.rest = rest.startsWith(";") ? rest.slice(1).trim() : rest;
  return out;
}

/** The mermaid blocks of the lines (indices from 0): the fence lines and the info. */
function mermaidBlocks(lines: string[]) {
  return (fences(lines) as { start: number; end: number; info: string }[]).filter((b) => b.info.split(/\s/)[0] === "mermaid");
}

/** For each line: true when it is inside a mermaid block (not a fence line). */
export function chartMask(lines: string[]): boolean[] {
  const out = lines.map(() => false);
  for (const b of mermaidBlocks(lines)) for (let i = b.start + 1; i < b.end; i++) out[i] = true;
  return out;
}

// ---------- the plan ----------

const ITEM = /^(\s*)[-*+][ \t]+\[([ xX])\](?:[ \t]+(.*))?$/;
const ITEM_ID = /^(?:~~)?\*\*([A-Z]\d+(?:\.\d+)*)\b/;
const MARK = /\s*(✅|⬜)\s*$/;

/** The title of a heading or a label with no mark at its end. */
export const unmarked = (s: string) => s.replace(MARK, "").trim();

/** The items of the lines `from`..`to` (indices from 0), outside fenced code. */
function itemsOf(lines: string[], code: boolean[], from: number, to: number): PlanItem[] {
  const out: PlanItem[] = [];
  const stack: number[] = [];
  for (let i = from; i <= to; i++) {
    if (code[i]) continue;
    const m = ITEM.exec(lines[i]);
    if (!m) {
      if (/^\S/.test(lines[i])) stack.length = 0;
      continue;
    }
    const indent = m[1].replace(/\t/g, "    ").length;
    while (stack.length && stack[stack.length - 1] >= indent) stack.pop();
    const depth = stack.length;
    stack.push(indent);
    const text = (m[3] ?? "").trim();
    out.push({ id: ITEM_ID.exec(text)?.[1] ?? null, text, checked: m[2] !== " ", dropped: text.startsWith("~~"), depth, line: i + 1 });
  }
  return out;
}

/** The cells of a table row, with no outer pipes. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** Parse one plan file. Never throws on content: malformed parts become findings of checkPlan. */
export function parsePlan(text: string, file: string): Plan {
  const lines = text.split("\n");
  const last = lines.length > 1 && lines[lines.length - 1] === "" ? lines.length - 2 : lines.length - 1;
  const code = fenced(lines);
  const kind = planKind(file);
  const heads: { i: number; level: number; text: string }[] = [];
  lines.forEach((line, i) => {
    const h = code[i] ? null : /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(line);
    if (h) heads.push({ i, level: h[1].length, text: h[2] });
  });
  const firstH2 = heads.find((h) => h.level === 2)?.i ?? lines.length;
  const title = heads.find((h) => h.level === 1)?.text ?? "";
  const update = lines.find((l, i) => !code[i] && /^>\s*\*\*(?:更新|Updated)(?=[\s*]|$)/.test(l)) ?? null;
  const log = lines.flatMap((l, i) => (!code[i] && i < firstH2 && /^>\s*- /.test(l) ? [l.replace(/^>\s*- /, "")] : []));
  let now: string | null = null;
  let nowLine: number | null = null;
  if (kind === "index")
    for (let i = 0; i < lines.length && now === null; i++) {
      const m = code[i] ? null : NOW.exec(lines[i]);
      if (m) [now, nowLine] = [m[2].trim(), i + 1];
    }

  // The sections.
  const sections: PlanHeading[] = [];
  heads.forEach((h, k) => {
    if (h.level !== 2 || kind === "index") return;
    const next = heads.slice(k + 1).find((n) => n.level <= 2);
    const end = next ? next.i - 1 : last;
    const word = h.text.split(/\s+/)[0] ?? "";
    const mark = MARK.exec(h.text)?.[1] as "✅" | "⬜" | undefined;
    sections.push({
      line: h.i + 1,
      endLine: end + 1,
      title: h.text,
      body: lines.slice(h.i + 1, end + 1).join("\n"),
      code: CODE.test(word) ? word : null,
      mark: mark ?? null,
    });
  });
  const sectionAt = (i: number) => sections.find((s) => s.line - 1 <= i && i <= s.endLine - 1) ?? null;

  // The charts.
  const charts: PlanChart[] = [];
  const nodes: PlanNode[] = [];
  const byId = new Map<string, PlanNode>();
  const firstSeen: string[] = [];
  const edgesById: { from: string; to: string; line: number }[] = [];
  for (const b of mermaidBlocks(lines)) {
    const top = b.start < firstH2;
    const dir = /^\s*(?:flowchart|graph)\s+(\w+)/.exec(lines.slice(b.start + 1, b.end).find((l) => l.trim()) ?? "");
    charts.push({ start: b.start + 1, end: b.end + 1, direction: dir ? dir[1] : null, section: top ? null : (sectionAt(b.start)?.code ?? null) });
    if (!top) continue;
    for (let i = b.start + 1; i < b.end; i++) {
      const parsed = parseChartLine(lines[i]);
      for (const r of parsed.refs) {
        if (!firstSeen.includes(r.id)) firstSeen.push(r.id);
        if (r.label === null) continue;
        const known = byId.get(r.id);
        if (known) {
          known.labelLines.push(i + 1);
          continue;
        }
        const raw = r.label;
        const label = raw.replace(/\s*✅\s*$/, "").trim();
        const word = label.split(/\s+/)[0] ?? "";
        const nodeCode = kind === "index" ? r.id : CODE.test(word) ? word : r.id;
        const n: PlanNode = {
          code: nodeCode,
          kind: kindOf(nodeCode, kind),
          label,
          done: raw.trim().endsWith(DONE),
          dropped: label.includes("~~"),
          section: null,
          items: [],
          chartLine: i + 1,
          id: r.id,
          shape: r.shape,
          mark: null,
          labelLines: [i + 1],
        };
        byId.set(r.id, n);
      }
      for (const [a, c] of parsed.edges) edgesById.push({ from: a.id, to: c.id, line: i + 1 });
    }
  }
  for (const id of firstSeen) {
    const n = byId.get(id);
    if (n) nodes.push(n);
  }
  for (const n of nodes) {
    const s = sections.find((x) => x.code === n.code);
    if (!s) continue;
    n.section = { line: s.line, endLine: s.endLine, title: s.title, body: s.body };
    n.mark = s.mark;
    n.done = s.mark === DONE;
    n.items = itemsOf(lines, code, s.line, s.endLine - 1);
    const top = n.items.filter((it) => it.depth === 0);
    const head = codesOf(n.code)[0];
    n.dropped =
      n.dropped ||
      s.title.includes("~~") ||
      (top.length > 0 && top.every((it) => it.dropped)) ||
      (top[0]?.dropped === true && new RegExp(`^~~\\*\\*(?:${escape(n.code)}|${escape(head)})\\b`).test(top[0].text));
  }
  const codeOf = (id: string) => byId.get(id)?.code ?? id;
  const edges = edgesById.map((e) => ({ from: codeOf(e.from), to: codeOf(e.to), line: e.line }));

  // The notes: the prose after the last chart of the plan, before the first `##`.
  const lastTop = charts.filter((c) => c.section === null).at(-1);
  const notes = lastTop ? lines.slice(lastTop.end, Math.min(firstH2, last + 1)).join("\n").trim() : "";

  // The table rows of index.md.
  const rows: PlanRow[] = [];
  if (kind === "index")
    lines.forEach((line, i) => {
      if (code[i] || !line.trimStart().startsWith("|")) return;
      const row = cells(line);
      if (row.every((c) => /^:?-+:?$/.test(c))) return;
      const next = lines[i + 1] ?? "";
      if (next.trimStart().startsWith("|") && cells(next).every((c) => /^:?-+:?$/.test(c))) return; // a header
      const first = row[0] ?? "";
      const issue = /#(\d+)/.exec(first);
      rows.push({ line: i + 1, first, done: first.endsWith(DONE), issue: issue ? Number(issue[1]) : null });
    });

  const labels = nodes.map((n) => n.label);
  const lang = labels.some((l) => l.includes("：")) || (!labels.some((l) => /: /.test(l)) && /[一-鿿]/.test(labels.join(""))) ? "zh" : "en";
  return { file, kind, title, update, now, log, notes, nodes, edges, lang, charts, sections, rows, nowLine };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- the rules ----------

/** The role words of a label, after its code: 「A3 agent：…」, "A3 Agent: …". */
const ROLES: Record<string, RegExp> = {
  A: /^(?:agent|Agent)(?=[\s：:]|$)/,
  D: /^(?:owner 拍板|Owner decides)(?=[\s：:]|$)/,
  O: /^(?:owner|Owner)(?=[\s：:]|$)/,
  E: /^(?:外部事件|Event)(?=[\s：:]|$)/,
};

/** True when a node is a release step or a milestone node: the end of the critical path of a milestone plan. */
const isEnd = (n: PlanNode) => n.kind === "M" || (n.kind === "O" && /发版|release/i.test(n.label));

/** The rules of spec-and-plan.md that a script can decide. `text` is the text that `plan` came from. */
export function checkPlan(plan: Plan, text: string): PlanFinding[] {
  const out: PlanFinding[] = [];
  const at = (line: number) => `${plan.file}:${line}`;
  const problem = (line: number, t: string) => out.push({ kind: "problem", where: at(line), text: t });
  const question = (line: number, t: string) => out.push({ kind: "question", where: at(line), text: t });
  const lines = text.split("\n");
  const tops = plan.charts.filter((c) => c.section === null);
  const isIndex = plan.kind === "index";

  // The charts: one arrow on a line, a label at the first appearance, known ids, the same label each time.
  const labelled = new Map<string, string>();
  for (const c of tops)
    for (let i = c.start; i < c.end - 1; i++) {
      for (const r of parseChartLine(lines[i]).refs)
        if (r.label !== null) {
          const prev = labelled.get(r.id);
          if (prev !== undefined && prev.replace(/\s*✅\s*$/, "") !== r.label.replace(/\s*✅\s*$/, ""))
            problem(i + 1, `the id ${r.id} has two labels: "${prev}" and "${r.label}"`);
          else if (prev !== undefined && prev.trim().endsWith(DONE) !== r.label.trim().endsWith(DONE))
            problem(i + 1, `the id ${r.id} has ${DONE} in one label and not in the other`);
          if (prev === undefined) labelled.set(r.id, r.label);
        }
    }
  if (!tops.length && !isIndex) problem(1, "the plan has no mermaid chart before its first ## section");
  if (!tops.length && isIndex) problem(1, "the graph has no mermaid chart");
  for (const c of tops) {
    const seen = new Set<string>();
    for (let i = c.start; i < c.end - 1; i++) {
      const parsed = parseChartLine(lines[i]);
      if (parsed.rest) question(i + 1, `the chart line has a part that the script cannot read: "${parsed.rest}"`);
      if (parsed.edges.length > 1) problem(i + 1, `the chart line has ${parsed.edges.length} arrows: write one arrow on each line`);
      for (const r of parsed.refs) {
        if (!labelled.has(r.id)) {
          if (!seen.has(r.id)) problem(i + 1, `the chart names ${r.id}, which has no label in a chart`);
        } else if (!seen.has(r.id) && r.label === null) problem(i + 1, `${r.id} comes before its label in this chart: write the line with ${r.id}["…"] first`);
        seen.add(r.id);
        if (r.label !== null && r.shape !== '["') (isIndex ? problem : question)(i + 1, `${r.id} is not in the form ID["text"]`);
      }
    }
  }

  // The codes.
  const byCode = new Map<string, PlanNode[]>();
  for (const n of plan.nodes) for (const c of codesOf(n.code)) byCode.set(c, [...(byCode.get(c) ?? []), n]);
  for (const [c, list] of byCode) if (list.length > 1) problem(list[1].chartLine, `two nodes have the code ${c}: ${list.map((n) => n.id).join(", ")}`);
  if (!isIndex) {
    for (const n of plan.nodes) {
      const word = n.label.split(/\s+/)[0] ?? "";
      if (!CODE.test(word)) {
        problem(n.chartLine, `the label of ${n.id} does not start with its code: "${n.label}"`);
        continue;
      }
      if (codesOf(n.code)[0] !== n.id) question(n.chartLine, `the id of ${n.code} is ${n.id}: write ${codesOf(n.code)[0]}["…"]`);
      const role = ROLES[n.kind];
      const after = n.label.slice(word.length).trim();
      if (role && !role.test(after))
        question(n.chartLine, `the label of ${n.code} does not name who does it: ${plan.lang === "zh" ? `「${n.code} ${{ A: "agent", D: "owner 拍板", O: "owner", E: "外部事件" }[n.kind]}：…」` : `"${n.code} ${{ A: "Agent", D: "Owner decides", O: "Owner", E: "Event" }[n.kind]}: …"`}`);
      if (n.kind === "M" && plan.kind === "issue") problem(n.chartLine, `${n.code}: the plan of an issue has no M node`);
    }
    const numbers = new Map<string, number[]>();
    for (const c of byCode.keys()) {
      const m = /^([A-Z])(\d+)$/.exec(c);
      if (m) numbers.set(m[1], [...(numbers.get(m[1]) ?? []), Number(m[2])]);
    }
    for (const [letter, ns] of numbers) {
      const max = Math.max(...ns);
      const gaps = [];
      for (let k = 1; k <= max; k++) if (!ns.includes(k)) gaps.push(`${letter}${k}`);
      if (gaps.length) question(byCode.get(`${letter}${max}`)![0].chartLine, `the ${letter} codes skip ${gaps.join(", ")}: number each kind 1, 2, 3, … in the plan`);
    }
  }

  // The arrows: no cycle.
  const next = new Map<string, string[]>();
  for (const e of plan.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const cycle = findCycle(plan.nodes.map((n) => n.code), next);
  if (cycle) {
    const e = plan.edges.find((x) => x.from === cycle[0] && x.to === cycle[1]);
    problem(e?.line ?? 1, `the chart has a cycle: ${cycle.join(" → ")}`);
  }

  if (isIndex) {
    checkIndex(plan, problem, question);
    return out;
  }

  // The sections.
  if (!plan.update) question(1, 'the plan has no update line ("> **更新 …**" or "> **Updated …**")');
  const seenCodes = new Set<string>();
  for (const s of plan.sections) {
    if (!s.code || !plan.nodes.some((n) => n.code === s.code)) {
      problem(s.line, `the section "## ${s.title}" is not a node of the chart`);
      continue;
    }
    if (seenCodes.has(s.code)) problem(s.line, `two sections have the code ${s.code}`);
    seenCodes.add(s.code);
  }
  for (const n of plan.nodes) {
    const s = n.section;
    if (!s) {
      problem(n.chartLine, `the node ${n.code} has no "## " section`);
      continue;
    }
    if (unmarked(s.title) !== n.label) problem(s.line, `the heading of ${n.code} is not its chart label "${n.label}"`);
    if (!n.mark) problem(s.line, `the heading of ${n.code} has no ${DONE} or ${OPEN} at its end`);
    const labelDone = n.labelLines.length > 0 && (labelled.get(n.id) ?? "").trim().endsWith(DONE);
    if (n.mark && labelDone !== n.done)
      problem(n.chartLine, `the label of ${n.code} ${labelDone ? "has" : "has no"} ${DONE}, and its heading ${n.done ? "has" : "has no"} ${DONE}`);
    for (const it of n.items) if (!it.checked && it.text.startsWith("~~")) problem(it.line, `a struck item has "- [ ]": strike only a "- [x]" item`);
    if (n.mark === OPEN && n.items.length > 0 && n.items.every((it) => it.checked))
      question(s.line, `the heading has ${OPEN} and each of its ${n.items.length} item(s) is "- [x]": done?`);
    if (n.done && !n.dropped && n.kind !== "D") {
      const body = s.body.split("\n").filter((l) => l.trim());
      if (body.length > 2) question(s.line, `the ${DONE} node ${n.code} has ${body.length} lines: compress it to one or two lines in the commit that ticks it`);
      if (n.kind === "A" && !/`[0-9a-f]{7,40}`/.test(s.body)) question(s.line, `the ${DONE} node ${n.code} names no commit (a short sha in backticks)`);
    }
    if (n.kind === "D" && n.mark === OPEN && !n.dropped) checkDecision(n, problem, question);
    const own = codesOf(n.code).map((c) => c.split(".")[0]);
    for (const it of n.items) if (it.id && !own.includes(it.id.split(".")[0])) question(it.line, `the item ${it.id} is in the section of ${n.code}`);
    checkSmallCharts(plan, n, lines, problem);
  }
  for (const w of openUnderDone(plan, text)) problem(w.line, `a "- [ ]" under a ${DONE} heading: ${w.text}`);
  const itemIds = new Map<string, number>();
  for (const n of plan.nodes)
    for (const it of n.items) {
      if (!it.id || !it.id.includes(".")) continue;
      if (itemIds.has(it.id)) problem(it.line, `the item ${it.id} is in the plan two times (line ${itemIds.get(it.id)})`);
      else itemIds.set(it.id, it.line);
    }

  // The order of the sections, and done nodes that wait on open nodes.
  const node = (c: string) => plan.nodes.find((n) => n.code === c);
  for (const e of plan.edges) {
    const a = node(e.from);
    const b = node(e.to);
    if (!a?.section || !b?.section) continue;
    if (a.section.line > b.section.line) question(a.section.line, `the section of ${a.code} comes after the section of ${b.code}, which waits on it: put ${a.code} first`);
    if (b.done && !b.dropped && !a.done && !a.dropped) question(b.section.line, `${b.code} is ${DONE}, and ${a.code}, which it waits on, is not`);
  }

  // The critical path of a milestone plan: each open node has a path to a release O or an M.
  if (plan.kind === "milestone") {
    const ends = new Set(plan.nodes.filter(isEnd).map((n) => n.code));
    const reaches = (c: string, seen = new Set<string>()): boolean => {
      if (ends.has(c)) return true;
      if (seen.has(c)) return false;
      seen.add(c);
      return (next.get(c) ?? []).some((d) => reaches(d, seen));
    };
    for (const n of plan.nodes)
      if (!n.done && !n.dropped && !ends.has(n.code) && !reaches(n.code))
        problem(n.chartLine, `${n.code} has no path to a release O or an M node: draw an arrow to the next open node of the critical path, or ask a D (future work or out of scope)`);
  }
  return out;
}

/**
 * Each `- [ ]` line under a `##` heading that ends with ✅, outside fenced code (lines from 1). `prerelease`'s
 * `cleanup.ts` prints them as warnings; `checkPlan` makes each one a problem.
 */
export function openUnderDone(plan: Plan, text: string): { line: number; text: string }[] {
  const lines = text.split("\n");
  const code = fenced(lines);
  const out: { line: number; text: string }[] = [];
  for (const s of plan.sections)
    if (s.mark === DONE)
      for (let i = s.line; i < s.endLine; i++) if (!code[i] && /^\s*[-*+][ \t]+\[ \][ \t]/.test(lines[i])) out.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
  return out;
}

/** A cycle of the arrows, as a list of codes from its start back to its start; null when there is none. */
function findCycle(codes: string[], next: Map<string, string[]>): string[] | null {
  const state = new Map<string, number>();
  const path: string[] = [];
  const visit = (c: string): string[] | null => {
    state.set(c, 1);
    path.push(c);
    for (const d of next.get(c) ?? []) {
      if (state.get(d) === 1) return [...path.slice(path.indexOf(d)), d];
      if (!state.has(d)) {
        const found = visit(d);
        if (found) return found;
      }
    }
    path.pop();
    state.set(c, 2);
    return null;
  };
  for (const c of [...codes, ...next.keys()]) if (!state.has(c)) {
    const found = visit(c);
    if (found) return found;
  }
  return null;
}

/** The parts of an open D section: 背景, 问题, 例子, and the options with the recommended one first. */
function checkDecision(n: PlanNode, _problem: (l: number, t: string) => void, question: (l: number, t: string) => void) {
  const s = n.section!;
  const body = s.body.split("\n");
  const has = (zh: string, en: string) => body.some((l) => new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?(?:${zh}|${en})(?:\\*\\*)?\\s*[：:。.]`, "i").test(l));
  for (const [zh, en] of [
    ["背景", "Context"],
    ["问题", "Question"],
    ["例子", "Example"],
  ])
    if (!has(zh, en)) question(s.line, `the ${OPEN} D node ${n.code} has no ${zh} (${en}) part`);
  const options = body.filter((l) => /^(?:[-*+]|\d+[.)])\s+(?!\[[ xX]\])/.test(l));
  const inline = body.find((l) => /^\s*(?:\*\*)?(?:选项|Options)/i.test(l));
  const recommended = /推荐|recommend/i;
  if (inline && recommended.test(inline)) return;
  if (options.length < 2) question(s.line, `the ${OPEN} D node ${n.code} has no list of two or more options`);
  else if (!recommended.test(options[0])) question(s.line, `the first option of ${n.code} is not the recommended one (推荐 / Recommended)`);
}

/** A small chart in a section: each of its labelled nodes is a `###` subsection with the label as its title. */
function checkSmallCharts(plan: Plan, n: PlanNode, lines: string[], problem: (l: number, t: string) => void) {
  const s = n.section!;
  const code = fenced(lines);
  const subs = new Set<string>();
  for (let i = s.line; i < s.endLine; i++) {
    const h = code[i] ? null : /^###[ \t]+(.*?)[ \t]*$/.exec(lines[i]);
    if (h) subs.add(unmarked(h[1]));
  }
  for (const c of plan.charts.filter((x) => x.section === n.code && x.start > s.line && x.end <= s.endLine))
    for (let i = c.start; i < c.end - 1; i++)
      for (const r of parseChartLine(lines[i]).refs)
        if (r.label !== null && !subs.has(r.label.replace(/\s*✅\s*$/, "").trim()))
          problem(i + 1, `the small chart of ${n.code} has "${r.label}", and the section has no "### " subsection with that title`);
}

/** The rules of `index.md`: the `Now:` line and the ✅ of the table. */
function checkIndex(plan: Plan, problem: (l: number, t: string) => void, question: (l: number, t: string) => void) {
  if (plan.now === null) problem(1, 'the graph has no "Now:" line');
  for (const n of plan.nodes) {
    if (n.kind !== "I") continue;
    const num = Number(n.code.slice(1));
    if (!n.label.startsWith(`#${num}`)) problem(n.chartLine, `the label of ${n.code} does not start with #${num}`);
    const row = plan.rows.find((r) => r.issue === num);
    if (!row) {
      if (!n.done) question(n.chartLine, `the open issue #${num} has no row in the table`);
      continue;
    }
    if (row.done !== n.done) problem(row.line, `the label of ${n.code} ${n.done ? "has" : "has no"} ${DONE}, and the first cell of its row ${row.done ? "has" : "has no"} ${DONE}`);
  }
  if (plan.now)
    for (const m of plan.now.matchAll(/#(\d+)/g)) {
      const n = plan.nodes.find((x) => x.code === `I${m[1]}`);
      if (n?.done) question(plan.nowLine ?? 1, `"Now:" names #${m[1]}, which is ${DONE}`);
    }
}

/** The `before` → `after` rules: a ✅ node is never removed, un-ticked or renamed; codes are not used again. */
export function checkTransition(before: Plan, after: Plan): PlanFinding[] {
  const out: PlanFinding[] = [];
  const problem = (line: number, t: string) => out.push({ kind: "problem", where: `${after.file}:${line}`, text: t });
  const isIndex = after.kind === "index";
  const now = new Map(after.nodes.map((n) => [n.code, n]));
  const body = (n: PlanNode) => (n.section?.body ?? "").replace(/\s+$/, "");
  for (const b of before.nodes) {
    const a = now.get(b.code);
    if (!a) {
      if (b.done && !isIndex) problem(1, `the ${DONE} node ${b.code} is removed: a ${DONE} node stays`);
      else if (!b.done) problem(1, `the node ${b.code} is removed: strike it through (plan.ts drop), do not remove it`);
      continue;
    }
    if (b.dropped && !a.dropped) problem(a.section?.line ?? a.chartLine, `the struck node ${b.code} is not struck now`);
    if (!b.done) {
      if (a.done) continue; // the commit that ticks it may compress it
      for (const it of b.items) {
        if (!it.id || !it.checked) continue;
        const it2 = a.items.find((x) => x.id === it.id);
        if (!it2) problem(a.section?.line ?? a.chartLine, `the "- [x]" item ${it.id} is removed`);
        else if (!it2.checked) problem(it2.line, `the item ${it.id} went back from "- [x]" to "- [ ]"`);
      }
      continue;
    }
    if (!a.done) problem(a.section?.line ?? a.chartLine, `the ${DONE} node ${b.code} lost its ${DONE}`);
    if (a.label !== b.label) problem(a.chartLine, `the ${DONE} node ${b.code} has a new label: "${b.label}" → "${a.label}"`);
    if (!isIndex && body(a) !== body(b)) problem(a.section?.line ?? a.chartLine, `the section of the ${DONE} node ${b.code} changed: a ${DONE} node does not change`);
  }
  // The arrows into a ✅ node stay, and no arrow comes into one.
  const key = (e: PlanEdge) => `${e.from}\u0000${e.to}`;
  const beforeEdges = new Set(before.edges.map(key));
  const afterEdges = new Set(after.edges.map(key));
  const doneBefore = new Set(before.nodes.filter((n) => n.done).map((n) => n.code));
  for (const e of before.edges)
    if (doneBefore.has(e.to) && now.has(e.to) && !afterEdges.has(key(e))) problem(now.get(e.to)!.chartLine, `the arrow ${e.from} --> ${e.to} into the ${DONE} node ${e.to} is removed`);
  for (const e of after.edges)
    if (!beforeEdges.has(key(e)) && doneBefore.has(e.to)) problem(e.line, `the new arrow ${e.from} --> ${e.to} goes into the ${DONE} node ${e.to}`);
  // A new code takes the next number of its kind.
  if (!isIndex) {
    const max = new Map<string, number>();
    for (const n of before.nodes)
      for (const c of codesOf(n.code)) {
        const m = /^([A-Z])(\d+)$/.exec(c);
        if (m) max.set(m[1], Math.max(max.get(m[1]) ?? 0, Number(m[2])));
      }
    const old = new Set(before.nodes.flatMap((n) => codesOf(n.code)));
    for (const n of after.nodes)
      for (const c of codesOf(n.code)) {
        const m = /^([A-Z])(\d+)$/.exec(c);
        if (!m || old.has(c)) continue;
        if (Number(m[2]) <= (max.get(m[1]) ?? 0)) problem(n.chartLine, `the new node ${n.code} uses a code at or below ${m[1]}${max.get(m[1])}: a code is not used again; take ${m[1]}${(max.get(m[1]) ?? 0) + 1}`);
      }
  }
  return out;
}
