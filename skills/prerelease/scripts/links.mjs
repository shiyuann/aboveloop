/**
 * The links of Markdown files, and the link check of prerelease (L2-release §1 step 4 and step 6, §2.8):
 * no relative link in a Markdown file of the repo points to a file that is not there.
 * External links are not fetched. Zero dependencies, plain JavaScript: `scripts/validate-skill-links.mjs`
 * of aboveloop runs it with no flags, and `cleanup.ts` finds the links with the same code.
 *
 *   node <this folder>/links.mjs [--cwd <repo>]
 *
 * The files: each `*.md` that git tracks or that is new and not ignored (`git ls-files --cached --others
 * --exclude-standard`), and that is on disk. A link: `[text](target)`, `![alt](target)`, or a reference
 * definition `[id]: target`, outside fenced code and inline code. Not examined: `#anchor`, `/path`,
 * a URL with a scheme (`https:`, `mailto:`), and a target with `<` (a placeholder such as `<项目根>/…`).
 * The anchor of a relative link is not examined.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** For each line of a Markdown text: true when it is a fence line or inside fenced code. */
export function fenced(lines) {
  const out = [];
  let open = null; // the fence that opened the block: its character and length
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      out.push(true);
      if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = null;
    } else if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      out.push(true);
      open = m[1];
    } else out.push(false);
  }
  return out;
}

/** The line with each inline code span made into spaces; the length and the positions stay. */
export function maskCode(line) {
  return line.replace(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (m) => " ".repeat(m.length));
}

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

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const root = parseArgs({ options: { cwd: { type: "string" } } }).values.cwd ?? process.cwd();
  const files = markdownFiles(root);
  const broken = brokenLinks(root, files);
  if (broken.length) {
    console.error(`Relative links to files that are not there (${broken.length}):`);
    for (const b of broken) console.error(`- ${b}`);
    process.exit(1);
  }
  console.log(`The links of ${files.length} Markdown files point to files that are there.`);
}
