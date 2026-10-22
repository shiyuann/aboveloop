/**
 * The session digest (L2-plugin §2): copies the block between `<!-- digest:begin -->` and `<!-- digest:end -->`
 * of `entry`'s `SKILL.md` to `skills/entry/digest.md`. The SessionStart hook in `hooks/hooks.json` prints that
 * file. The copy is plain: the script reads no other part of the skill, and a person writes the block.
 *
 *   node --experimental-strip-types --no-warnings skills/entry/scripts/digest.ts           writes digest.md
 *   node --experimental-strip-types --no-warnings skills/entry/scripts/digest.ts --check   writes nothing; exit 1 when digest.md is not a fresh build
 *
 * Exit 2 when the markers are missing, doubled or in the wrong order. `make validate` runs `--check`.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const BEGIN = "<!-- digest:begin -->";
export const END = "<!-- digest:end -->";
export const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SKILL = join(ENTRY, "SKILL.md");
export const DIGEST = join(ENTRY, "digest.md");
const REBUILD = "node --experimental-strip-types --no-warnings skills/entry/scripts/digest.ts";

/** The text between the two marker lines, with one final newline. Throws when the markers are wrong. */
export function extract(text: string): string {
  const lines = text.split("\n");
  const begins = lines.flatMap((l, i) => (l.trim() === BEGIN ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === END ? [i] : []));
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(`the skill must have one ${BEGIN} line and one ${END} line (found ${begins.length} and ${ends.length})`);
  }
  if (begins[0] > ends[0]) throw new Error(`the markers are in the wrong order: ${END} comes before ${BEGIN}`);
  return `${lines
    .slice(begins[0] + 1, ends[0])
    .join("\n")
    .replace(/^\n+|\n+$/g, "")}\n`;
}

/** True when `out` holds a fresh build of the block in `skill`. */
export function isFresh(skill = SKILL, out = DIGEST): boolean {
  let current: string | null = null;
  try {
    current = readFileSync(out, "utf8");
  } catch {
    current = null;
  }
  return current === extract(readFileSync(skill, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { values } = parseArgs({ options: { check: { type: "boolean" } } });
  try {
    if (values.check) {
      if (!isFresh()) {
        console.error(`digest: skills/entry/digest.md is not a fresh build of the block in SKILL.md. Rebuild it: ${REBUILD}`);
        process.exit(1);
      }
      console.log("digest: skills/entry/digest.md equals the block in SKILL.md");
    } else {
      writeFileSync(DIGEST, extract(readFileSync(SKILL, "utf8")));
      console.log("digest: wrote skills/entry/digest.md");
    }
  } catch (e) {
    console.error(`digest: ${(e as Error).message}`);
    process.exit(2);
  }
}
