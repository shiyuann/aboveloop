/**
 * Step 4 of prerelease (L2-release §1, §2.8): remove the finished plans and their deep-verify reports,
 * and make each link to them a permanent link at HEAD, the commit before the version commit.
 * Step 6 runs it again after the merge of origin/main: then it also repairs new links to the files that
 * the version commit removed, at the parent of the version commit.
 *
 *   node --experimental-strip-types --no-warnings cleanup.ts [--dry-run] [--cwd <repo>]
 *
 * What leaves, decided from the files at HEAD:
 * - A plan `knowledge/plan/<N>-<slug>.md` whose `##` headings (outside fenced code) all end with ✅.
 *   A plan with no `##` heading is not finished. A `- [ ]` under a ✅ heading is a warning, not a stop.
 *   A plan with no number (the plan of a milestone) stays.
 * - A report `knowledge/reference/deep-verify-<date>-<N>.md` of an issue whose plan leaves, or of an
 *   issue that has no plan at HEAD (its plan left before, or never came to main).
 * - A report with no number stays, with a warning: each report names its issue.
 *
 * The ✅ items of the graph of open work `knowledge/plan/index.md` (L2-loop-dev §4, L3-loop-dev §2) leave too: in its mermaid
 * chart, each node `ID["… ✅"]` and each line that names one; each table row whose first cell ends with ✅.
 *
 * Then:
 * - The table rows of `knowledge/index.md` whose first cell links to a file that leaves go.
 * - In each Markdown file that git tracks, each relative link to a file that leaves, and each link to it at
 *   `blob/main` of this repo, becomes `https://github.com/<repo>/blob/<commit>/<path>#<anchor>`.
 * - Other mentions of the files (a bare path, a file that is not Markdown, code) are listed, not changed.
 *
 * After the version commit (`version: <VERSION>` on the first-parent line of HEAD, for example under the
 * merge of step 6), the files that it removed count too, with their links at its parent.
 *
 * It stages what it does (`git rm`, `git add`): in step 4 the index is the version commit. It stops and
 * changes nothing when a file that leaves has changes that are not committed, or when a file that it must
 * change has changes that are not staged (stage the version change before it runs). Run again, it changes
 * nothing more. `--dry-run` only prints.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fenced, linksOf, relativePath } from "./links.mjs";
import { repoOf, run } from "./scope.ts";

const PLAN = /^knowledge\/plan\/(\d+)-[a-z0-9-]+\.md$/;
const REPORT = /^knowledge\/reference\/deep-verify-\d{4}-\d{2}-\d{2}(?:-(\d+))?\.md$/;
const INDEX = "knowledge/index.md";
const GRAPH = "knowledge/plan/index.md";
const DONE = "✅";

/** A plan is finished when it has a `##` heading and each one ends with ✅. Open items under a ✅ heading are warnings. */
export function planState(text: string) {
  const lines = text.split("\n");
  const code = fenced(lines);
  const open: string[] = [];
  const warnings: { line: number; text: string }[] = [];
  let headings = 0;
  let done = false;
  lines.forEach((line, i) => {
    if (code[i]) return;
    const h = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (h) {
      headings++;
      done = h[1].endsWith(DONE);
      if (!done) open.push(h[1]);
    } else if (done && /^\s*[-*+][ \t]+\[ \][ \t]/.test(line)) warnings.push({ line: i + 1, text: line.trim().slice(0, 120) });
  });
  return { finished: headings > 0 && open.length === 0, open, warnings };
}

/** A node of a mermaid chart in the graph: `ID["label"]` (the format in knowledge's spec-and-plan.md). */
const NODE = /([A-Za-z_]\w*)\["([^"]*)"\]/g;

/**
 * The ✅ items of the graph of open work (L2-loop-dev §4, L3-loop-dev §2): in a mermaid chart, each node whose label ends with ✅,
 * and each line that names one by its id; outside code, each table row whose first cell ends with ✅. A line that
 * goes keeps, on a line of its own, the label of each node that stays and has no label on a line that stays.
 * `to` is that text, or null. A line with more than one arrow goes whole: a warning. Lines from 1.
 */
export function finishedItems(text: string) {
  const lines = text.split("\n");
  const code = fenced(lines);
  const chart: boolean[] = [];
  let fence: string | null = null;
  let mermaid = false;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null;
      chart.push(fence !== null && mermaid);
    } else {
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) [fence, mermaid] = [m[1], m[2].trim() === "mermaid"];
      chart.push(false);
    }
  }
  const nodes: string[] = [];
  lines.forEach((line, i) => {
    if (chart[i]) for (const m of line.matchAll(NODE)) if (m[2].trim().endsWith(DONE) && !nodes.includes(m[1])) nodes.push(m[1]);
  });
  const ids = new RegExp(`(?<![\\w])(?:${nodes.join("|") || "(?!)"})(?![\\w])`);
  const bare = (line: string) => line.replace(NODE, "$1").replace(/\|[^|]*\|/g, "");
  const goes = lines.map((line, i) =>
    chart[i]
      ? ids.test(bare(line))
      : !code[i] && line.trimStart().startsWith("|") && line.trim().slice(1).split("|")[0].trim().endsWith(DONE),
  );
  const labelled = new Set(lines.flatMap((line, i) => (chart[i] && !goes[i] ? [...line.matchAll(NODE)].map((m) => m[1]) : [])));
  const out: { line: number; text: string; to: string | null }[] = [];
  const warnings: { line: number; text: string }[] = [];
  lines.forEach((line, i) => {
    if (!goes[i]) return;
    const keep: string[] = [];
    if (chart[i])
      for (const m of line.matchAll(NODE))
        if (!nodes.includes(m[1]) && !labelled.has(m[1])) {
          labelled.add(m[1]);
          keep.push(`${/^\s*/.exec(line)![0]}${m[0]}`);
        }
    if (chart[i] && (bare(line).match(/-->|---|==>|-\.->/g) ?? []).length + (bare(line).includes("&") ? 1 : 0) > 1)
      warnings.push({ line: i + 1, text: line.trim() });
    out.push({ line: i + 1, text: line.trim().slice(0, 160), to: keep.length ? keep.join("\n") : null });
  });
  const to = new Map(out.map((o) => [o.line, o.to]));
  const result = lines.flatMap((line, i) => (!to.has(i + 1) ? [line] : to.get(i + 1) === null ? [] : [to.get(i + 1)!]));
  return { nodes, lines: out, warnings, text: result.join("\n") };
}

export interface Leave {
  path: string;
  why: string;
}

/** The files that leave, from the paths at HEAD and a reader of their text. */
export function classify(paths: string[], read: (path: string) => string) {
  const plans = new Map<number, { path: string; state: ReturnType<typeof planState> }[]>();
  for (const path of paths) {
    const m = PLAN.exec(path);
    if (m) plans.set(Number(m[1]), [...(plans.get(Number(m[1])) ?? []), { path, state: planState(read(path)) }]);
  }
  const leave: Leave[] = [];
  const kept: { path: string; open: number }[] = [];
  const warnings: string[] = [];
  for (const [n, list] of plans)
    for (const p of list) {
      if (!p.state.finished) {
        kept.push({ path: p.path, open: p.state.open.length });
        continue;
      }
      leave.push({ path: p.path, why: `the plan of #${n}: each node is ${DONE}` });
      for (const w of p.state.warnings) warnings.push(`${p.path}:${w.line}: an open item under a ${DONE} heading: ${w.text}`);
    }
  const finished = (n: number) => plans.get(n)?.every((p) => p.state.finished) ?? false;
  for (const path of paths) {
    const m = REPORT.exec(path);
    if (!m) continue;
    const n = m[1] ? Number(m[1]) : null;
    if (n === null) warnings.push(`${path}: a report with no issue number stays; each report names its issue`);
    else if (!plans.has(n)) leave.push({ path, why: `a report of #${n}, which has no plan on main` });
    else if (finished(n)) leave.push({ path, why: `a report of #${n}, whose plan leaves` });
  }
  leave.sort((a, b) => a.path.localeCompare(b.path));
  kept.sort((a, b) => a.path.localeCompare(b.path));
  return { leave, kept, warnings };
}

/** The repo path that a link target in `file` names, or null (another repo, a URL, outside the repo). */
function targetPath(file: string, target: string, blobMain: RegExp): string | null {
  const rel = relativePath(target);
  if (rel !== null) {
    const path = posix.normalize(posix.join(posix.dirname(file), rel));
    return path.startsWith("../") ? null : path;
  }
  const m = blobMain.exec(target);
  return m ? decodeURIComponent(m[1]) : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blobMainOf = (repo: string) => new RegExp(`^https://github\\.com/${escape(repo)}/blob/main/([^#?\\s]+)`, "i");
const permanent = (repo: string, sha: string, path: string, anchor: string) => `https://github.com/${repo}/blob/${sha}/${path}${anchor}`;

/** The table rows of `knowledge/index.md` whose first cell links to a file that leaves (line numbers from 1). */
export function indexRows(text: string, file: string, leaving: Map<string, string>, repo: string) {
  const lines = text.split("\n");
  const code = fenced(lines);
  const blobMain = blobMainOf(repo);
  const rows: { file: string; line: number; path: string }[] = [];
  lines.forEach((line, i) => {
    if (code[i] || !line.trimStart().startsWith("|")) return;
    const first = line.trim().slice(1).split("|")[0];
    const path = linksOf(first)
      .map((l) => targetPath(file, l.target, blobMain))
      .find((p) => p && leaving.has(p));
    if (path) rows.push({ file, line: i + 1, path });
  });
  return rows;
}

/**
 * The text with each link to a file that leaves made permanent at the commit that `leaving` gives for it;
 * the anchor stays. The lines stay.
 */
export function permanentLinks(text: string, file: string, leaving: Map<string, string>, repo: string) {
  const lines = text.split("\n");
  const blobMain = blobMainOf(repo);
  const found: { line: number; col: number; from: string; to: string }[] = [];
  for (const l of linksOf(text).sort((a, b) => a.line - b.line || b.start - a.start)) {
    const path = targetPath(file, l.target, blobMain);
    const sha = path && leaving.get(path);
    if (!path || !sha) continue;
    const hash = l.target.indexOf("#");
    const to = permanent(repo, sha, path, hash >= 0 ? l.target.slice(hash) : "");
    lines[l.line] = lines[l.line].slice(0, l.start) + to + lines[l.line].slice(l.end);
    found.push({ line: l.line + 1, col: l.start, from: l.target, to });
  }
  // A bare URL or an autolink `<…>` at blob/main, outside code.
  const code = fenced(lines);
  const bare = new RegExp(`https://github\\.com/${escape(repo)}/blob/main/([^#?\\s)>\\]]+)(#[^\\s)>\\]]*)?`, "gi");
  lines.forEach((line, i) => {
    if (code[i]) return;
    lines[i] = line.replace(bare, (url, path: string, anchor: string | undefined, at: number) => {
      const p = decodeURIComponent(path);
      const sha = leaving.get(p);
      if (!sha || insideCode(line, at)) return url;
      const to = permanent(repo, sha, p, anchor ?? "");
      found.push({ line: i + 1, col: at, from: url, to });
      return to;
    });
  });
  found.sort((a, b) => a.line - b.line || a.col - b.col);
  return { text: lines.join("\n"), links: found.map(({ line, from, to }) => ({ file, line, from, to })) };
}

/** True when position `at` of a line is inside an inline code span. */
function insideCode(line: string, at: number): boolean {
  for (const m of line.matchAll(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g)) if (at >= (m.index ?? 0) && at < (m.index ?? 0) + m[0].length) return true;
  return false;
}

/** The lines of a text that still name a file that leaves, after the permanent links of this repo are taken out. */
export function mentionsIn(text: string, file: string, leaving: string[], repo: string) {
  const stems = leaving.map((p) => posix.basename(p, ".md"));
  const url = `https://github\\.com/${escape(repo)}/blob/[0-9a-f]{40}/[^\\s)>\\]]*`;
  const linked = new RegExp(`!?\\[[^\\]]*\\]\\(${url}[^)]*\\)|${url}`, "gi");
  const out: { file: string; line: number; text: string }[] = [];
  text.split("\n").forEach((line, i) => {
    const rest = line.replace(linked, "");
    if (stems.some((s) => rest.includes(s))) out.push({ file, line: i + 1, text: line.trim().slice(0, 160) });
  });
  return out;
}

/**
 * The version commit of VERSION on the first-parent line of HEAD (HEAD itself, or under the merge of
 * step 6), with the plans and reports that it removed; null before the version commit.
 */
function versionCommit(cwd: string, git: (...a: string[]) => string) {
  const file = join(cwd, "VERSION");
  if (!existsSync(file)) return null;
  const subject = `version: ${readFileSync(file, "utf8").trim()}`;
  const line = git("log", "--first-parent", "-n", "50", "--format=%H%x09%s", "HEAD")
    .split("\n")
    .find((l) => l.slice(l.indexOf("\t") + 1) === subject);
  if (!line) return null;
  const commit = line.slice(0, line.indexOf("\t"));
  const removed = git("diff", "--name-only", "--diff-filter=D", "-z", `${commit}^`, commit, "--", "knowledge/plan", "knowledge/reference")
    .split("\0")
    .filter((p) => PLAN.test(p) || REPORT.test(p));
  return { commit, parent: git("rev-parse", `${commit}^`), removed };
}

export function cleanup(cwd: string, dryRun = false) {
  const git = (...a: string[]) => run("git", a, cwd);
  const list = (cmd: string, ...a: string[]) => git(cmd, "-z", ...a).split("\0").filter(Boolean);
  const sha = git("rev-parse", "HEAD");
  const atHead = list("ls-tree", "-r", "--name-only", "HEAD", "--", "knowledge/plan", "knowledge/reference");
  const { leave, kept, warnings } = classify(atHead, (p) => git("show", `HEAD:${p}`));
  const version = versionCommit(cwd, git);
  const result = {
    commit: sha,
    dry_run: dryRun,
    remove: leave,
    kept,
    removed_by_version: version?.removed.length ? { commit: version.commit, links_at: version.parent, paths: version.removed } : null,
    rows: [] as ReturnType<typeof indexRows>,
    graph: [] as { file: string; line: number; text: string; to: string | null }[],
    links: [] as ReturnType<typeof permanentLinks>["links"],
    changed: [] as string[],
    mentions: [] as ReturnType<typeof mentionsIn>,
    warnings,
    stop: null as string | null,
  };
  // Each file that leaves now, at HEAD; each file that the version commit removed, at its parent.
  const leaving = new Map<string, string>([...(version?.removed ?? []).map((p): [string, string] => [p, version!.parent]), ...leave.map((l): [string, string] => [l.path, sha])]);
  // Only regular files: a tracked symlink (for example `.claude/skills -> ../.agents/skills`) or a submodule is a directory to
  // `readFileSync`, which stops with EISDIR; the files behind a symlink are tracked, and read, by their own paths.
  const regular = (f: string) => lstatSync(join(cwd, f), { throwIfNoEntry: false })?.isFile() === true;
  const graphDone = regular(GRAPH) && finishedItems(readFileSync(join(cwd, GRAPH), "utf8")).lines.length > 0;
  if (!leaving.size && !graphDone) return result;

  const repo = leaving.size ? repoOf(git("remote", "get-url", "origin")) : "";
  const paths = leave.map((l) => l.path);
  const onDisk = (f: string) => existsSync(join(cwd, f));
  const tracked = list("ls-files").filter((f) => !leaving.has(f) && regular(f));
  const next = new Map<string, string>();
  for (const file of tracked.filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(cwd, file), "utf8");
    const rows = file === INDEX ? indexRows(text, file, leaving, repo) : [];
    const graph = file === GRAPH ? finishedItems(text) : null;
    const to = new Map(graph?.lines.map((g) => [g.line, g.to]));
    const gone = new Set([...rows.map((r) => r.line), ...to.keys()]);
    const p = permanentLinks(text, file, leaving, repo);
    const out = p.text
      .split("\n")
      .flatMap((line, i) => (!gone.has(i + 1) ? [line] : to.get(i + 1) ? [to.get(i + 1)!] : []))
      .join("\n");
    result.rows.push(...rows);
    result.graph.push(...(graph?.lines ?? []).map((g) => ({ file, ...g })));
    for (const w of graph?.warnings ?? []) result.warnings.push(`${file}:${w.line}: a chart line with more than one arrow went whole: ${w.text}`);
    result.links.push(...p.links.filter((l) => !gone.has(l.line)));
    if (out !== text) next.set(file, out);
  }
  result.changed = [...next.keys()];
  for (const file of tracked) {
    const text = next.get(file) ?? readFileSync(join(cwd, file), "utf8");
    if (!text.includes("\0")) result.mentions.push(...mentionsIn(text, file, [...leaving.keys()], repo));
  }

  const differs = (...a: string[]) => {
    try {
      git("diff", "--quiet", ...a);
      return false;
    } catch {
      return true;
    }
  };
  const dirty = [
    ...paths.filter((f) => onDisk(f) && differs("HEAD", "--", f)).map((f) => `${f} (not committed)`),
    ...result.changed.filter((f) => differs("--", f)).map((f) => `${f} (not staged)`),
  ];
  if (dirty.length)
    result.stop = `files that it must change have changes that are not in the version commit: ${dirty.join(", ")}; stage the version change first`;
  if (dryRun || result.stop) return result;

  for (const [file, text] of next) writeFileSync(join(cwd, file), text);
  if (result.changed.length) git("add", "--", ...result.changed);
  if (paths.length) git("rm", "-q", "--ignore-unmatch", "--", ...paths);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const a = parseArgs({ options: { "dry-run": { type: "boolean" }, cwd: { type: "string" } } }).values;
  try {
    const out = cleanup(a.cwd ?? process.cwd(), a["dry-run"] ?? false);
    console.log(JSON.stringify(out, null, 2));
    if (out.stop) process.exit(1);
  } catch (e) {
    console.log(JSON.stringify({ stop: (e instanceof Error ? e.message : String(e)).split("\n")[0] }, null, 2));
    process.exit(1);
  }
}
