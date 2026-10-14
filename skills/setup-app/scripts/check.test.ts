/**
 * check.sh against a fake `gh` on PATH: only the line of `.agents/dev.md` is examined here. Nothing here
 * uses the network: each other call of the fake fails, and check.sh goes on.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("./check.sh", import.meta.url));

/** The line of `.agents/dev.md` that check.sh prints, with a fake gh whose `.agents/dev.md` is `devMd` (null: HTTP 404, "error": HTTP 502). */
function devLine(devMd: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "check-"));
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const dev = ${JSON.stringify(devMd)};
if (args[0] === "api" && args.at(-1) === "repos/o/app/contents/.agents/dev.md") {
  if (dev === null) { process.stderr.write("gh: Not Found (HTTP 404)\\n"); process.exit(1); }
  if (dev === "error") { process.stderr.write("gh: Server Error (HTTP 502)\\n"); process.exit(1); }
  process.stdout.write(dev);
  process.exit(0);
}
process.stderr.write("gh: not in the fake\\n");
process.exit(1);
`,
    { mode: 0o755 },
  );
  const run = spawnSync("bash", [CHECK, "o/app"], { encoding: "utf8", env: { PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: dir }, timeout: 60_000 });
  const line = run.stdout.split("\n").find((l) => l.includes(".agents/dev.md"));
  assert.ok(line, run.stdout + run.stderr);
  return line.trim().replace(/\s+/g, " ");
}

test("check.sh reads .agents/dev.md: no file is the default rank; a file that cannot be read is a ✗", () => {
  assert.equal(devLine(null), "· .agents/dev.md default rank");
  assert.equal(devLine("# dev: app\n\n## Rank\n\n### Urgent\n\n- `bug`\n"), "✓ .agents/dev.md on the default branch: dev reads its ## Rank");
  assert.equal(devLine("error"), "✗ .agents/dev.md cannot be read: gh: Server Error (HTTP 502)");
});
