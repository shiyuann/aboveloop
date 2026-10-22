/**
 * The Claude Code hook of the plans (`hooks/hooks.json`, PostToolUse on Edit, Write and MultiEdit; L2-plugin §2,
 * L3-loop-dev §4). It reads the hook input (JSON) on stdin. When the tool wrote a Markdown file under
 * `knowledge/plan/`, it runs `plan.ts check <file> --against HEAD --new` in the repo of that file. When that
 * prints a problem, it writes the output to stderr and exits 2: Claude Code then gives the text to the agent.
 * In all other cases it prints nothing and exits 0: another file, no file, bad JSON, a Node with no
 * `--experimental-strip-types`, a check that could not run.
 *
 * Plain JavaScript: it must start on any Node, and it stops before the TypeScript check when the file is not a plan.
 *
 *   node <this folder>/plan-hook.mjs < hook-input.json
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The repo root and the repo path of a plan file, or null when the path is not a Markdown file under `knowledge/plan/`. */
export function planPath(path) {
  const m = /^(.*?)[\\/]knowledge[\\/]plan[\\/](.+\.md)$/.exec(path);
  return m ? { root: m[1] || "/", file: `knowledge/plan/${m[2].replace(/\\/g, "/")}` } : null;
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const raw = input?.tool_input?.file_path;
  if (typeof raw !== "string") return 0;
  const abs = resolve(typeof input.cwd === "string" ? input.cwd : process.cwd(), raw);
  const plan = planPath(abs);
  if (!plan || !existsSync(abs)) return 0;
  const script = join(dirname(fileURLToPath(import.meta.url)), "plan.ts");
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, "check", plan.file, "--cwd", plan.root, "--against", "HEAD", "--new"], {
    encoding: "utf8",
    timeout: 20000,
  });
  if (r.status !== 1 || !/^problem /m.test(r.stdout ?? "")) return 0;
  process.stderr.write(
    `${plan.file} breaks the rules of a plan (knowledge's references/spec-and-plan.md). Repair it, or make the change with plan.ts (node --experimental-strip-types --no-warnings ${script} help):\n${r.stdout}`,
  );
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) process.exitCode = main();
