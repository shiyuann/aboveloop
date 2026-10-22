/**
 * The links of Markdown files, and the link check of prerelease (L2-release §1 step 4 and step 6, §2.8):
 * no relative link in a Markdown file of the repo points to a file that is not there.
 * External links are not fetched. Zero dependencies, plain JavaScript: `scripts/validate-skill-links.mjs`
 * of aboveloop runs it with no flags, and `cleanup.ts` finds the links with the same code.
 *
 *   node <this folder>/links.mjs [--cwd <repo>] [--anchors]
 *
 * The files: each `*.md` that git tracks or that is new and not ignored (`git ls-files --cached --others
 * --exclude-standard`), and that is on disk. A link: `[text](target)`, `![alt](target)`, or a reference
 * definition `[id]: target`, outside fenced code and inline code. Not examined: `#anchor`, `/path`,
 * a URL with a scheme (`https:`, `mailto:`), and a target with `<` (a placeholder such as `<项目根>/…`).
 * With no option, the anchor of a link is not examined, so `prerelease` in each project checks only that the files are there.
 *
 * `--anchors` also examines the anchor of each relative link to a Markdown file of the repo, and of each
 * `#anchor` link to the same file. The anchors of a file are its headings in the GitHub form
 * (`anchorsOf`) and the `id`/`name` of its HTML tags. A target that is not Markdown, or that is not there,
 * gives no anchor finding: the file check reports a missing file. `scripts/validate-skill-links.mjs` of
 * aboveloop and the knowledge check of `knowledge` (`knowledge-check.ts`) run the anchor check too.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fenced, maskCode } from "./markdown.mjs";

// The fence parser is shared with the TypeScript scripts: one copy, in `markdown.mjs`.
export { fenced, maskCode } from "./markdown.mjs";

const INLINE = /!?\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*([^\s()<>]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/dg;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*([^\s<>]+)/d;

/**
 * Each link of a Markdown text, outside fenced code and inline code: the line index (from 0),
 * the target, and where the target is in the line ([start, end)).
 */
export function linksOf(text) {
  const lines = text.split("\n");
  const code = fenced(lines);
  const out = [];
  lines.forEach((line, i) => {
    if (code[i]) return;
    const prose = maskCode(line);
    for (const m of prose.matchAll(INLINE)) out.push({ line: i, target: m[1], start: m.indices[1][0], end: m.indices[1][1] });
    const d = DEFINITION.exec(prose);
    if (d) out.push({ line: i, target: d[1], start: d.indices[1][0], end: d.indices[1][1] });
  });
  return out;
}

/** A target that names a file of the repo by a relative path: the path part, else null. */
export function relativePath(target) {
  if (target.startsWith("#") || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes("<")) return null;
  const path = target.split("#", 1)[0].split("?", 1)[0];
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The Markdown files of the repo in `root` (paths from `root`): tracked, or new and not ignored; on disk. */
export function markdownFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  return [...new Set(out.split("\0").filter(Boolean))].filter((f) => existsSync(join(root, f))).sort();
}

/** Each relative link to a file that is not there: `file:line -> target`. */
export function brokenLinks(root, files = markdownFiles(root)) {
  const broken = [];
  for (const file of files) {
    const full = join(root, file);
    for (const l of linksOf(readFileSync(full, "utf8"))) {
      const path = relativePath(l.target);
      if (path !== null && !existsSync(resolve(dirname(full), path))) broken.push(`${relative(root, full)}:${l.line + 1} -> ${l.target}`);
    }
  }
  return broken;
}

/**
 * The anchor of a heading, in the GitHub form (github-slugger): the text that GitHub shows (no link targets,
 * no HTML tags, no emphasis marks) in lower case; letters of any script with their marks, digits, `_`
 * (connector punctuation), `-` and spaces stay; other punctuation and symbols (`§`, `✅`, `` ` ``) go out;
 * each space becomes `-`. No trim: a heading that ends with ` ✅` gives an anchor that ends with `-`.
 */
export function slug(heading) {
  const text = heading
    .replace(/!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[e])
    .replace(/(^|[^\p{L}\p{N}_])(_{1,2})(?=\S)(.+?)(?<=\S)\2(?![\p{L}\p{N}_])/gu, "$1$3");
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/**
 * The anchors of a Markdown text: one for each heading outside fenced code (ATX `#`…`######`, and setext
 * `===`/`---` under a line of text), in the order of the file; a second heading with the same anchor gets
 * `-1`, a third `-2`. Also the `id` and `name` of each HTML tag outside fenced code.
 */
export function anchorsOf(text) {
  const lines = text.split("\n");
  const code = fenced(lines);
  const count = new Map(); // as github-slugger: each anchor given, and how many times its text came again
  const out = new Set();
  const add = (base) => {
    let id = base;
    if (count.has(base))
      do {
        count.set(base, count.get(base) + 1);
        id = `${base}-${count.get(base)}`;
      } while (count.has(id));
    count.set(id, 0);
    out.add(id);
  };
  lines.forEach((line, i) => {
    if (code[i]) return;
    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) add(slug((atx[1] ?? "").trim()));
    else if (i > 0 && !code[i - 1] && /^ {0,3}(=+|-+)[ \t]*$/.test(line) && setextText(lines[i - 1])) add(slug(lines[i - 1].trim()));
    for (const m of maskCode(line).matchAll(/<[a-z][^>]*?\s(?:id|name)\s*=\s*["']([^"']+)["']/gi)) out.add(m[1]);
  });
  return out;
}

/** A line that a setext underline makes into a heading: text, not a list item, table row, quote or heading. */
function setextText(line) {
  return /\S/.test(line) && !/^ {0,3}([-*+>|#]|\d+[.)]|`{3}|~{3})/.test(line) && !/^ {4}/.test(line);
}

/**
 * Each link whose anchor is not in its target: a relative link to a Markdown file that is there, and a
 * `#anchor` link to the same file. `file:line -> target`. An anchor matches as it is, URL-decoded, or in
 * lower case.
 */
export function brokenAnchors(root, files = markdownFiles(root)) {
  const cache = new Map();
  const anchors = (path) => {
    if (!cache.has(path)) cache.set(path, anchorsOf(readFileSync(path, "utf8")));
    return cache.get(path);
  };
  const broken = [];
  for (const file of files) {
    const full = join(root, file);
    for (const l of linksOf(readFileSync(full, "utf8"))) {
      const hash = l.target.indexOf("#");
      if (hash < 0 || hash === l.target.length - 1) continue;
      let target;
      if (hash === 0) target = full;
      else {
        const path = relativePath(l.target);
        if (path === null) continue;
        target = resolve(dirname(full), path);
      }
      if (!/\.md$/i.test(target) || !existsSync(target) || !statSync(target).isFile()) continue;
      const raw = l.target.slice(hash + 1);
      let anchor = raw;
      try {
        anchor = decodeURIComponent(raw);
      } catch {}
      const set = anchors(target);
      if (![raw, anchor, anchor.toLowerCase()].some((a) => set.has(a))) broken.push(`${relative(root, full)}:${l.line + 1} -> ${l.target}`);
    }
  }
  return broken;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { values } = parseArgs({ options: { cwd: { type: "string" }, anchors: { type: "boolean" } } });
  const root = values.cwd ?? process.cwd();
  const files = markdownFiles(root);
  const broken = brokenLinks(root, files);
  const anchors = values.anchors ? brokenAnchors(root, files) : [];
  if (broken.length) {
    console.error(`Relative links to files that are not there (${broken.length}):`);
    for (const b of broken) console.error(`- ${b}`);
  }
  if (anchors.length) {
    console.error(`Links to anchors that are not in their file (${anchors.length}):`);
    for (const b of anchors) console.error(`- ${b}`);
  }
  if (broken.length || anchors.length) process.exit(1);
  console.log(`The links of ${files.length} Markdown files point to files that are there${values.anchors ? ", and their anchors are in those files" : ""}.`);
}
