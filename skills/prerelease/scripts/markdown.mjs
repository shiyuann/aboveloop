/**
 * The fenced code of a Markdown text: the one fence parser of the scripts. Pure, zero dependencies, plain
 * JavaScript: `links.mjs` (run with no flags) and the TypeScript scripts (`cleanup.ts`, `knowledge`'s
 * `plan-graph.ts`) import it. It reads no file.
 */

/**
 * The fenced code blocks of the lines of a Markdown text: the index of the fence line that opens each block
 * (from 0), of the line that closes it (the last line when no fence closes it), its fence and its info string.
 */
export function fences(lines) {
  const out = [];
  let open = null;
  lines.forEach((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2].trim()) {
        out.push({ ...open, end: i });
        open = null;
      }
    } else if (m && !(m[1][0] === "`" && m[2].includes("`"))) open = { start: i, fence: m[1], info: m[2].trim() };
  });
  if (open) out.push({ ...open, end: lines.length - 1 });
  return out;
}

/** For each line of a Markdown text: true when it is a fence line or inside fenced code. */
export function fenced(lines) {
  const out = lines.map(() => false);
  for (const b of fences(lines)) for (let i = b.start; i <= b.end; i++) out[i] = true;
  return out;
}

/** The line with each inline code span made into spaces; the length and the positions stay. */
export function maskCode(line) {
  return line.replace(/(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (m) => " ".repeat(m.length));
}
