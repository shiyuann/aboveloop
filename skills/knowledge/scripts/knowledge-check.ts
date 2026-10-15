/**
 * The knowledge check: the mechanical items of a deep-verify (L2-loop-builder §7). It reads
 * `knowledge/` of the project in `--cwd` and prints one line for each problem, with `file:line`. It examines
 * only the form of each item; the reviewers keep the items of judgement (each ✅ part is in the code, each
 * part not built has a ⬜ mark and a node, "Builds on" is complete and correct).
 *
 *   node --experimental-strip-types --no-warnings <this folder>/knowledge-check.ts [--cwd <repo>] [--offline]
 *
 * The checks:
 * - Anchors: each relative link to a Markdown file of the repo, and each `#anchor` link, names a heading of
 *   its target in the GitHub form (`links.mjs`, the one Markdown parser of the link checks).
 * - "Builds on": the table of `knowledge/index.md` with the header "Builds on" or 「建立在」. The names of a
 *   cell are split on `,` and 「、」 after `(…)` and `（…）` go out. Each name is a page of the table (the file
 *   name with no `.md`). A name with a link to another repo is skipped and counted. A page builds on no page
 *   of a lower level (L1 is the highest); a row with no level (a plan) gets no level rule. With no such table,
 *   or no `knowledge/spec/`, one line says so and the check is skipped.
 * - ⬜ marks in `knowledge/spec/`: each issue reference (`#N`, `[#N](…)`, a GitHub issue or PR link) from the
 *   ⬜ to the end of its sentence or table cell (or the next ⬜). Each issue is open in this repo, or has a plan
 *   `knowledge/plan/N-*.md` with a `##` node that is not ✅. Not examined: the update records (lines that start
 *   with `> - `), quoted examples (in `"…"`, `“…”`, 「…」 or backticks), a ⬜ that the text names as a word
 *   ("a ⬜ names…", "marked ⬜", "⬜ not built"), and a mark of another repo (`other-app#80`), which is counted.
 *   A mark that names only nodes of a plan with no number ("alpha plan A30") passes when the plan is on disk
 *   and each node is in it and not ✅. A mark that names a plan that is not on disk, or a node that is ✅
 *   or not there ("sync plan D4", "⬜ A12"), or no issue in its sentence, is a question. An issue with an open
 *   plan on disk passes with no `gh` call. The states come from `gh api repos/{owner}/{repo}/issues/N`, one call for each issue, with the
 *   cwd of `--cwd`; a failed call prints "could not read #N" and that mark counts as offline, not as a problem.
 *   `--offline` skips the states, and says so.
 * - Plans in `knowledge/plan/` (not `index.md`): a `##` heading with ✅ has no `- [ ]` under it; a `##`
 *   heading with ⬜ whose items are all `- [x]` is a question; the mermaid label of each node has ✅ when its
 *   heading has ✅, and only then.
 * - Deep-verify reports `knowledge/reference/deep-verify-<date>*.md` (the owner's choice): the small
 *   part (a heading, an item or a table row that names the small findings, and each sentence that counts small
 *   ones) holds only counts and IDs, no problem and no repair of each (`checkReport`). A report whose file
 *   name gives a date before `SMALL_RULE_FROM` is counted, not examined; a report with no date is examined.
 *
 * It exits 1 when it prints a problem. A question does not make it fail.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { planState } from "../../prerelease/scripts/cleanup.ts";
import { brokenAnchors, fenced, markdownFiles, maskCode } from "../../prerelease/scripts/links.mjs";
import { repoOf, run } from "../../prerelease/scripts/scope.ts";

export type Kind = "problem" | "question";
export interface Finding {
  kind: Kind;
  where: string; // file:line, from the root of the repo
  text: string;
}
export interface Result {
  findings: Finding[];
  notes: string[];
}

/** The state of one issue of this repo. It throws when it cannot read it (no login, a rate limit, no repo). */
export type IssueState = (n: number) => "open" | "closed";

const DONE = "✅";
const OPEN = "⬜";
const EXTERNAL = "\u0000external\u0000";

/** The cells of a table row, with no outer pipes. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** The level of a page name (`L2-loops` -> 2), or null (a plan). */
function levelOf(name: string): number | null {
  const m = /^L(\d)\b/.exec(name);
  return m ? Number(m[1]) : null;
}

/** The page name of a cell: the file name with no `.md` of its first link, else its text. */
function pageName(cell: string): string {
  const m = /\[[^\]]*\]\(([^)\s]+)/.exec(cell);
  const text = m ? m[1].split("#", 1)[0] : cell.replace(/[*`]/g, "").trim();
  return basename(text).replace(/\.md$/i, "");
}

/** The "Builds on" check of `knowledge/index.md` (its text, from the root of the repo `file`). */
export function checkBuildsOn(text: string, file = "knowledge/index.md"): Result {
  const lines = text.split("\n");
  const code = fenced(lines);
  const findings: Finding[] = [];
  const notes: string[] = [];
  let skipped = 0;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (code[i] || !/^\s*\|/.test(lines[i])) continue;
    const header = cells(lines[i]);
    const col = header.findIndex((c) => c === "Builds on" || c === "建立在");
    if (col < 0) continue;
    found = true;
    const rows: { line: number; page: string; deps: string }[] = [];
    for (let j = i + 1; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const row = cells(lines[j]);
      if (row.every((c) => /^:?-+:?$/.test(c))) continue;
      rows.push({ line: j + 1, page: pageName(row[0] ?? ""), deps: row[col] ?? "" });
      i = j;
    }
    const pages = new Set(rows.map((r) => r.page));
    for (const r of rows) {
      // A link first becomes its page name, or EXTERNAL for a link to another repo, so that `(…)` takes no URL.
      let deps = r.deps.replace(/!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*([^\s()]+)[^)]*\)/g, (_m, _label: string, target: string) =>
        /^[a-z][a-z0-9+.-]*:/i.test(target) ? EXTERNAL : pageName(`[](${target})`),
      );
      for (let prev = ""; prev !== deps; ) {
        prev = deps;
        deps = deps.replace(/\([^()]*\)/g, "").replace(/（[^（）]*）/g, "");
      }
      for (const raw of deps.split(/[,，、]/)) {
        const item = raw.trim();
        if (!item || /^[—–-]+$/.test(item)) continue;
        if (item.includes(EXTERNAL) || /https?:\/\//.test(item)) {
          skipped++;
          continue;
        }
        const name = pageName(item);
        if (!pages.has(name)) {
          findings.push({ kind: "problem", where: `${file}:${r.line}`, text: `"Builds on" of ${r.page} names "${name}", which is not a page of the table` });
          continue;
        }
        const a = levelOf(r.page);
        const b = levelOf(name);
        if (a !== null && b !== null && b > a)
          findings.push({ kind: "problem", where: `${file}:${r.line}`, text: `${r.page} (L${a}) builds on ${name}, a page of a lower level (L${b})` });
      }
    }
  }
  if (!found) notes.push(`"Builds on": ${file} has no table with the header "Builds on" or 「建立在」; skipped.`);
  else if (skipped) notes.push(`"Builds on": ${skipped} name(s) with a link to another repo, not examined.`);
  return { findings, notes };
}

/** One ⬜ mark: where it is, the issues of this repo that it names, and what else it names. */
export interface Mark {
  line: number; // from 1
  issues: number[];
  otherRepo: number;
  oldPlan: string | null;
  nodes: PlanNode[];
  text: string;
}

/** A node of a plan with no number that a mark names: "alpha plan A30", "sync plan D4" -> {plan, node}. */
export interface PlanNode {
  plan: string;
  node: string;
}

/** The repo part of a ref: `owner/repo` or `repo` -> the repo name in lower case. */
const repoName = (r: string) => r.split("/").pop()!.toLowerCase();

/**
 * The ⬜ marks of a spec page that the check examines, and the issue references of each (`repo` is
 * `owner/repo` of this repo, for the links and for `repo#N`).
 */
export function marksOf(text: string, repo: string): Mark[] {
  const lines = text.split("\n");
  const code = fenced(lines);
  const out: Mark[] = [];
  lines.forEach((line, i) => {
    if (code[i] || /^\s*> - /.test(line) || !line.includes(OPEN)) return;
    const prose = maskCode(line).replace(/"[^"\n]*"|“[^”\n]*”|「[^」\n]*」/g, (m) => " ".repeat(m.length));
    let at = prose.indexOf(OPEN);
    while (at >= 0) {
      const next = prose.indexOf(OPEN, at + OPEN.length);
      const before = prose.slice(0, at);
      const rest = prose.slice(at + OPEN.length, next < 0 ? undefined : next);
      const end = /[.。!?！？](?=\s|$)|\|/.exec(rest);
      const range = end ? rest.slice(0, end.index) : rest;
      const shown = line.slice(at + OPEN.length, at + OPEN.length + range.length).trim();
      const word = /\b(a|an|the|each|every|marked|missing|last|its|one)\s*$/i.test(before) || /^\s*(not built|未做|没做|未实现)/.test(rest) || !range.trim();
      if (!word) out.push({ line: i + 1, ...refsOf(range, repo), text: shown.length > 90 ? `${shown.slice(0, 90)}…` : shown });
      at = next;
    }
  });
  return out;
}

/** The issue references of a piece of a sentence. */
export function refsOf(range: string, repo: string): { issues: number[]; otherRepo: number; oldPlan: string | null; nodes: PlanNode[] } {
  const issues: number[] = [];
  let otherRepo = 0;
  const self = repo.toLowerCase();
  let rest = range.replace(/!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*([^\s()]+)[^)]*\)/g, (_m, label: string, target: string) => {
    const gh = /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/i.exec(target);
    if (!gh) return label;
    if (gh[1].toLowerCase() === self) issues.push(Number(gh[2]));
    else otherRepo++;
    return " ";
  });
  rest = rest.replace(/(^|[^\w/&#-])(?:([A-Za-z][\w.-]*(?:\/[A-Za-z][\w.-]*)?))?#(\d+)(?![\w-])/g, (_m, pre: string, r: string | undefined, n: string) => {
    if (!r || repoName(r) === repoName(self)) issues.push(Number(n));
    else otherRepo++;
    return pre;
  });
  const nodes: PlanNode[] = [];
  const NODE = "[A-Z]\\d+(?:\\.\\d+)?";
  for (const m of rest.matchAll(new RegExp(`([A-Za-z][\\w-]*) ?(?:plan|施工单) ?(${NODE}(?:\\s*[,、，]\\s*${NODE}(?![\\w.]))*)`, "g")))
    for (const node of m[2].split(/\s*[,、，]\s*/)) nodes.push({ plan: m[1], node });
  const plan = /\b(?:[A-Za-z][\w-]* ?)?(?:plan|施工单) ?[A-Z]\d+(?:\.\d+)?/.exec(rest) ?? /^\W*([ADOCEM]\d+(?:\.\d+)?)\b/.exec(rest);
  return { issues: [...new Set(issues)], otherRepo, oldPlan: plan ? (plan[1] ?? plan[0]).trim() : null, nodes };
}

/** The `##` nodes of a plan: the code of each heading (`A3`) -> true when the heading ends with ✅. */
export function nodesOf(text: string): Map<string, boolean> {
  const lines = text.split("\n");
  const code = fenced(lines);
  const out = new Map<string, boolean>();
  lines.forEach((line, i) => {
    const h = code[i] ? null : /^##[ \t]+(([A-Z]\d+(?:\.\d+)?)\b.*?)[ \t]*$/.exec(line);
    if (h) out.set(h[2], h[1].endsWith(DONE));
  });
  return out;
}

/** The plan checks of one plan file. */
export function checkPlan(text: string, file: string): Result {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  const code = fenced(lines);
  for (const w of planState(text).warnings) findings.push({ kind: "problem", where: `${file}:${w.line}`, text: `a "- [ ]" under a ${DONE} heading: ${w.text}` });
  const headings = nodesOf(text);
  let current: { line: number; text: string; items: number; checked: number } | null = null;
  const close = () => {
    if (current && current.text.includes(OPEN) && current.items > 0 && current.items === current.checked)
      findings.push({ kind: "question", where: `${file}:${current.line}`, text: `the heading has ${OPEN} and each of its ${current.items} item(s) is "- [x]": done?` });
  };
  lines.forEach((line, i) => {
    if (code[i]) return;
    const h = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h) {
      close();
      current = { line: i + 1, text: h[1], items: 0, checked: 0 };
      return;
    }
    const item = /^\s*[-*+][ \t]+\[([ xX])\][ \t]/.exec(line);
    if (item && current) {
      current.items++;
      if (item[1] !== " ") current.checked++;
    }
  });
  close();
  let mermaid = false;
  lines.forEach((line, i) => {
    if (/^ {0,3}(`{3,}|~{3,})\s*mermaid\b/.test(line)) mermaid = true;
    else if (mermaid && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) mermaid = false;
    else if (mermaid)
      for (const m of line.matchAll(/\b([A-Z]\d+(?:\.\d+)?)\s*(?:\[\[|\[\(|\(\(|\{\{|[[({>])\s*"([^"]*)"/g)) {
        const done = headings.get(m[1]);
        if (done === undefined) continue;
        const label = m[2].includes(DONE);
        if (label !== done)
          findings.push({ kind: "problem", where: `${file}:${i + 1}`, text: `the mermaid label of ${m[1]} ${label ? "has" : "has no"} ${DONE}, and its heading ${done ? "has" : "has no"} ${DONE}` });
      }
  });
  return { findings, notes: [] };
}

/**
 * The first day of the rule on the small findings of a report. A report with an older date in its
 * file name was written by older rules, and the check does not examine it.
 */
export const SMALL_RULE_FROM = "2026-10-14";

/** A word that names the small findings: "small", 「小发现」「小的」「小问题」. */
const namesSmall = (s: string) => /\bsmall\b/i.test(s) || /小(?:发现|的|问题)/.test(s);
/** A count of small findings or problems: "12 distinct small", "Small: 16", 「4 条小」, 「小的 18 条」. */
const SMALL_COUNT = [/\b\d+\s+(?:(?:distinct|new|more|raw|other)\s+)*small\b/i, /\bsmall(?:\s+(?:findings?|problems?|points?|ones))?\s*[:：(（]?\s*\d/i, /\d+\s*条(?:新的?)?小/, /小(?:的|发现|问题)\s*[:：]?\s*\d/];
const IMPORTANT = /important|blocking|重要|挡路/i;
const countsSmall = (s: string) => SMALL_COUNT.some((r) => r.test(s));
/** The part of a sentence from its count of small ones to its end: "6 small." of "The second look found 9 problems: 3 important, 6 small." */
const fromCount = (s: string) => s.slice(Math.min(...SMALL_COUNT.map((r) => r.exec(s)?.index ?? s.length)));
/** An item that gives one finding and calls it small: "**P2 (small).** …". */
const SMALL_ITEM = /^\s*\**\s*[A-Za-z][\w/-]*\d[\w/-]*\s*\**\s*[(（]\s*(?:small|小)\s*[)）]/i;

/** The words that a count may have: what it counts, the result, and a pointer. Anything else is a description. */
const COUNT_WORDS = new Set(
  (
    "small findings finding problems problem points point ones id ids distinct raw new more other repaired repair needed all both each every " +
    "not none no only in part partly hold holds held does do is are was were of the a an second look looks round rounds first third last " +
    "left stay stays open came step commit next fixed listed and or with also to from by for at plan node under below above see owner decision decisions count counts " +
    "important blocking except solo panel goes go deep-verify issue total zero one two three four five six seven eight nine ten"
  ).split(" "),
);
/** The same in Chinese, longest first: a text with no spaces is cut out piece by piece. */
const COUNT_WORDS_ZH = (
  "小发现 小问题 小的 都修了 修好了 修了 没修 未修 不修 不成立 成立 部分 一半 只给数 复查 第二轮 第一轮 其中 还剩 剩下 写在 进了 拍板 重要 挡路 " +
  "新的 全部 上面 下面 不用 发现 问题 小 条 个 处 修 只 给 数 轮 第 和 与 及 另 剩 留 进 里 下 新 的 都 全 共 见 一 两 也 了"
).split(" ");

/** The words of a text that are not a count, an ID, a commit or a separator; none for "11 repaired, 1 not repaired (C-11)". */
export function notCounts(text: string): string[] {
  let t = text
    .replace(/!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\([^)]*\)/g, " $1 ")
    .replace(/`[0-9a-f]{7,40}`/g, " ")
    .replace(/\*\*|__|\*|~~/g, " ");
  for (const w of COUNT_WORDS_ZH) t = t.split(w).join(" ");
  const out: string[] = [];
  for (const raw of t.split(/[\s,;:.()（）、，；：。=+&→–—|「」“”"]+/)) {
    const tok = raw.replace(/^-+|-+$/g, "");
    if (!tok || /^[/~]+$/.test(tok)) continue;
    if (/^[#§]?\d+%?$/.test(tok)) continue; // a count, an issue, a section
    if (/^#?[A-Za-z][A-Za-z0-9]*(?:[-/][A-Za-z0-9]+)*$/.test(tok) && /\d/.test(tok)) continue; // an ID: C-4, A/B-2, solo-6, S1, E2b-1
    if (COUNT_WORDS.has(tok.toLowerCase())) continue;
    out.push(raw);
  }
  return out;
}

/** The sentences of a text, split at `.`, `;` and their Chinese forms outside parentheses. */
function clauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ("(（[「“".includes(c)) depth++;
    else if (")）]」”".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (";；。".includes(c) || (c === "." && (i + 1 === text.length || /\s/.test(text[i + 1]))))) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) out.push(text.slice(start));
  return out;
}

/** The text before the first `:` outside parentheses, when it is short: "Small findings" of "Small findings: 6 (…)". */
function labelOf(text: string): string | null {
  let depth = 0;
  for (let i = 0; i < text.length && i <= 60; i++) {
    const c = text[i];
    if ("(（".includes(c)) depth++;
    else if (")）".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ":" || c === "：")) return text.slice(0, i).replace(/[*_]/g, "");
  }
  return null;
}

/**
 * The form of the small findings in a deep-verify report (deep-verify-knowledge.md, section 7, items 4 and 5).
 * The small part is a section under a heading that names the small findings ("## Small findings", 「## 小发现」),
 * an item or a table row whose label names them ("Small: 16; …", "- The small findings, repaired: …", 「小的 4 条：」),
 * with the lines under the item, and each sentence elsewhere that counts small ones ("10 small, all repaired.",
 * "3 important and 1 small new problems, all repaired: …"). The small part holds only counts, IDs, commits and
 * the words of a count (`COUNT_WORDS`): no problem and no repair of each.
 */
export function checkReport(text: string, file: string): Result {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  const code = fenced(lines);
  let section: number | null = null; // the level of a heading that names the small findings
  let under: number | null = null; // the indent of a small item: the lines under it are small too (-1: the list after a paragraph)
  const fail = (i: number, part: string, bad: string[]) => {
    const shown = part.trim().length > 90 ? `${part.trim().slice(0, 90)}…` : part.trim();
    findings.push({ kind: "problem", where: `${file}:${i + 1}`, text: `the small findings of a deep-verify report give more than counts and IDs (${bad.slice(0, 4).join(" ")}): "${shown}"` });
  };
  const whole = (i: number, part: string) => {
    const bad = notCounts(part);
    if (bad.length) fail(i, part, bad);
  };
  lines.forEach((line, i) => {
    if (code[i] || !line.trim() || /^\s*>/.test(line)) return;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      under = null;
      if (namesSmall(h[2]) && !IMPORTANT.test(h[2])) section = h[1].length;
      else if (section !== null && h[1].length <= section) section = null;
      return;
    }
    const indent = /^\s*/.exec(line)![0].length;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (under !== null && (under < 0 ? !item : indent <= under)) under = null;
    const body = item ? item[1] : line.trim();
    if (/^\|/.test(line.trim())) {
      const row = cells(line);
      if (row.every((c) => /^:?-+:?$/.test(c))) return;
      if (section !== null) return row.forEach((c) => whole(i, c));
      if (namesSmall(row[0] ?? "") && (row[0] ?? "").length <= 30) return row.slice(1).forEach((c) => whole(i, c));
      for (const c of row) for (const s of clauses(c)) if (countsSmall(s)) whole(i, fromCount(s));
      return;
    }
    if (section !== null || under !== null) return whole(i, body);
    const label = labelOf(body);
    if ((label !== null && namesSmall(label) && !IMPORTANT.test(label)) || SMALL_ITEM.test(body)) {
      whole(i, body);
      if (item) under = indent;
      return;
    }
    const parts = clauses(body);
    for (const s of parts) if (countsSmall(s)) whole(i, fromCount(s));
    // The list after ":" is small when the sentence that ends with ":" counts small ones, or counts nothing and the
    // text before it counts only small ones. "10 small, all repaired. The important ones:" introduces important ones.
    const last = parts.at(-1)?.trim() ?? "";
    if (last.endsWith(":") && !IMPORTANT.test(last) && (countsSmall(last) || (!IMPORTANT.test(body) && parts.some(countsSmall)))) under = item ? indent : -1;
  });
  return { findings, notes: [] };
}

/** The Markdown files under a folder of the repo (paths from the root), sorted. */
function mdUnder(root: string, dir: string): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    const path = join(full, name);
    if (statSync(path).isDirectory()) out.push(...mdUnder(root, join(dir, name)));
    else if (name.endsWith(".md")) out.push(join(dir, name));
  }
  return out.sort();
}

/** The issue numbers whose plan `knowledge/plan/N-*.md` has a `##` node that is not ✅. */
function openPlans(root: string): Set<number> {
  const out = new Set<number>();
  for (const file of mdUnder(root, "knowledge/plan")) {
    const m = /^(\d+)-.*\.md$/.exec(basename(file));
    if (m && !planState(readFileSync(join(root, file), "utf8")).finished) out.add(Number(m[1]));
  }
  return out;
}

/** The ⬜ check of `knowledge/spec/`. `state` is null with `--offline`. */
export function checkMarks(root: string, repo: string, state: IssueState | null): Result {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const specs = mdUnder(root, "knowledge/spec");
  if (!specs.length) return { findings, notes: ["⬜ marks: no knowledge/spec/; skipped."] };
  const plans = openPlans(root);
  const states = new Map<number, "open" | "closed" | "unread">();
  let other = 0;
  let offline = 0;
  let planMarks = 0;
  let marks = 0;
  const nodeCache = new Map<string, Map<string, boolean> | null>();
  for (const file of specs) {
    for (const mark of marksOf(readFileSync(join(root, file), "utf8"), repo)) {
      marks++;
      const where = `${file}:${mark.line}`;
      other += mark.otherRepo;
      if (!mark.issues.length) {
        if (mark.otherRepo) continue;
        const why = mark.nodes.length ? nodeProblem(root, mark.nodes, nodeCache) : null;
        if (mark.nodes.length && !why) {
          planMarks++;
          continue;
        }
        findings.push({
          kind: "question",
          where,
          text: why ? `${OPEN} names ${why}, and no issue: "${mark.text}"` : mark.oldPlan ? `${OPEN} names a plan (${mark.oldPlan}) and no issue: "${mark.text}"` : `${OPEN} names no issue in its sentence: "${mark.text}"`,
        });
        continue;
      }
      for (const n of mark.issues) {
        if (plans.has(n)) continue;
        if (!state) {
          offline++;
          continue;
        }
        if (!states.has(n)) {
          try {
            states.set(n, state(n));
          } catch {
            states.set(n, "unread");
            notes.push(`could not read #${n}`);
          }
        }
        const s = states.get(n);
        if (s === "unread") offline++;
        else if (s === "closed") findings.push({ kind: "problem", where, text: `${OPEN} #${n}: the issue is closed, and no plan knowledge/plan/${n}-*.md has a node that is not ${DONE}` });
      }
    }
  }
  const read = [...states.values()].filter((s) => s !== "unread").length;
  notes.push(`⬜ marks: ${marks} mark(s) in ${specs.length} page(s); ${read} issue state(s) read${state ? " with gh" : ""}.`);
  if (!state) notes.push(`⬜ marks: --offline, the states of the issues are not read (${offline} reference(s) not examined).`);
  else if (offline) notes.push(`⬜ marks: ${offline} reference(s) not examined (could not read the issue).`);
  if (other) notes.push(`⬜ marks: ${other} reference(s) to another repo, not examined.`);
  if (planMarks) notes.push(`⬜ marks: ${planMarks} mark(s) name only nodes of a plan with no number; each node is in its plan on disk and not ${DONE}.`);
  return { findings, notes };
}

/**
 * Why the plan nodes of a mark do not hold, or null when each one is a `##` node of `knowledge/plan/<plan>.md`
 * on disk that is not ✅ (`A6.7` counts as `A6`).
 */
function nodeProblem(root: string, nodes: PlanNode[], cache: Map<string, Map<string, boolean> | null>): string | null {
  for (const { plan, node } of nodes) {
    if (!cache.has(plan)) {
      const file = join(root, "knowledge/plan", `${plan}.md`);
      cache.set(plan, existsSync(file) ? nodesOf(readFileSync(file, "utf8")) : null);
    }
    const map = cache.get(plan);
    const done = map?.get(node) ?? map?.get(node.split(".")[0]);
    if (!map) return `a plan that is not on disk (${plan} ${node}; knowledge/plan/${plan}.md is not there)`;
    if (done === undefined) return `${plan} ${node}, which is not a node of knowledge/plan/${plan}.md`;
    if (done) return `${plan} ${node}, whose heading is ${DONE}`;
  }
  return null;
}

/** `gh api` for the state of an issue, run in `cwd`. It throws when gh fails. */
export const ghState =
  (cwd: string): IssueState =>
  (n) => {
    const s = run("gh", ["api", `repos/{owner}/{repo}/issues/${n}`, "--jq", ".state"], cwd);
    if (s !== "open" && s !== "closed") throw new Error(`unexpected state of #${n}: ${s}`);
    return s;
  };

/** The whole check of the repo in `root`. */
export function knowledgeCheck(root: string, opts: { state: IssueState | null; repo?: string }): Result {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const add = (r: Result) => {
    findings.push(...r.findings);
    notes.push(...r.notes);
  };
  const files = markdownFiles(root);
  for (const b of brokenAnchors(root, files) as string[]) {
    const [where, target] = b.split(" -> ");
    findings.push({ kind: "problem", where, text: `the anchor of ${target} is not in its file` });
  }
  notes.push(`Anchors: ${files.length} Markdown files examined.`);
  const index = join(root, "knowledge/index.md");
  if (!existsSync(join(root, "knowledge/spec"))) notes.push(`"Builds on": no knowledge/spec/; skipped.`);
  else if (!existsSync(index)) notes.push(`"Builds on": no knowledge/index.md; skipped.`);
  else add(checkBuildsOn(readFileSync(index, "utf8")));
  let repo = opts.repo;
  if (!repo)
    try {
      repo = repoOf(run("git", ["remote", "get-url", "origin"], root));
    } catch {
      repo = "";
    }
  add(checkMarks(root, repo, opts.state));
  for (const file of mdUnder(root, "knowledge/plan").filter((f) => basename(f) !== "index.md")) add(checkPlan(readFileSync(join(root, file), "utf8"), file));
  const reports = mdUnder(root, "knowledge/reference").filter((f) => /^deep-verify-/.test(basename(f)));
  // Only a date that the file name gives skips a report; a report with no date in its name is examined.
  const older = reports.filter((f) => {
    const date = /^deep-verify-(\d{4}-\d{2}-\d{2})/.exec(basename(f))?.[1];
    return date !== undefined && date < SMALL_RULE_FROM;
  });
  for (const file of reports.filter((f) => !older.includes(f))) add(checkReport(readFileSync(join(root, file), "utf8"), file));
  notes.push(`Reports: ${reports.length - older.length} deep-verify report(s) examined${older.length ? `; ${older.length} dated before ${SMALL_RULE_FROM}, not examined` : ""}.`);
  return { findings, notes };
}

/** The lines that the command prints: problems, then questions, then notes, then the count. */
export function format(r: Result): string[] {
  const problems = r.findings.filter((f) => f.kind === "problem");
  const questions = r.findings.filter((f) => f.kind === "question");
  return [
    ...problems.map((f) => `problem ${f.where}: ${f.text}`),
    ...questions.map((f) => `question ${f.where}: ${f.text}`),
    ...r.notes,
    `${problems.length} problem(s), ${questions.length} question(s).`,
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { values } = parseArgs({ options: { cwd: { type: "string" }, offline: { type: "boolean" } } });
  const root = values.cwd ?? process.cwd();
  const result = knowledgeCheck(root, { state: values.offline ? null : ghState(root) });
  for (const line of format(result)) console.log(line);
  process.exit(result.findings.some((f) => f.kind === "problem") ? 1 : 0);
}
