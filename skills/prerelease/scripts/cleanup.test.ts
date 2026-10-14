import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { cleanup, planState } from "./cleanup.ts";
import { brokenLinks, linksOf } from "./links.mjs";

/** The plan of #36 with four open nodes. */
const PLAN_36 = readFileSync(new URL("./fixtures/36-issue-life.txt", import.meta.url), "utf8");
/** The same plan when its last four nodes are done too. */
const PLAN_36_DONE = PLAN_36.replace(/^(## .*) ⬜$/gm, "$1 ✅");

test("a plan is finished when each ## heading outside code ends with ✅; open items under ✅ are warnings", () => {
  const open = planState(PLAN_36);
  assert.equal(open.finished, false, "the #36 plan still has open nodes");
  assert.deepEqual(open.open.map((h) => h.split(" ")[0]), ["O2", "O3", "A10", "C1"]);

  const done = planState(PLAN_36_DONE);
  assert.equal(done.finished, true);
  assert.ok(done.warnings.some((w) => w.line === 27 && w.text.startsWith("- [ ] The owner reads the full change")), "O1 ✅ has an open item");
  assert.ok(done.warnings.some((w) => w.line === 47), "an indented open item under A9 ✅");

  assert.equal(planState("# 45\n\nNo node yet.\n").finished, false, "no node heading: not finished");
  assert.equal(planState("# p\n\n```text\n## A2 Agent: in code ⬜\n```\n\n## A1 Agent: x ✅\n### A1.1 sub ⬜\n").finished, true, "code and ### do not count");
  assert.equal(planState("# p\n\n## A1 Agent: x ✅\n## A2 Agent: y ⬜\n").finished, false);
});

test("links: inline, images and definitions; not in fenced code or inline code", () => {
  const text = "a [x](p.md#h) `[c](q.md)` ![i](img.png \"t\")\n\n````md\n```\n[f](r.md)\n```\n````\n[id]: s.md\n";
  assert.deepEqual(
    linksOf(text).map((l) => [l.line, l.target]),
    [
      [0, "p.md#h"],
      [0, "img.png"],
      [7, "s.md"],
    ],
  );
});

// ---------- a real repo ----------

const OPEN_44 = `# acme #44 plan

\`\`\`mermaid
flowchart TB
  A1["A1 Agent: y ⬜"]
\`\`\`

## D1 Owner decides: x ✅

## A1 Agent: y ⬜

- [ ] **A1.1** The work.
`;

const INDEX = `# Knowledge base index

- [The spec of x](spec/L2-x.md).

## Reference (\`reference/\`)

| Page | Summary |
|------|---------|
| [reference/work-loop-sources.md](reference/work-loop-sources.md) | Evidence. |
| [reference/deep-verify-2026-09-01-36.md](reference/deep-verify-2026-09-01-36.md) | Round 0 of #36. |
| [reference/deep-verify-2026-09-03-36.md](reference/deep-verify-2026-09-03-36.md) | Round 1 of #36 ([plan](plan/36-issue-life.md#a1-x)). |
| [reference/deep-verify-2026-10-20-44.md](reference/deep-verify-2026-10-20-44.md) | Round 1 of #44; [the one before](reference/deep-verify-2026-09-02-40.md). |
`;

const SPEC = `# L2-x

- Measured ([deep-verify §3.3](../reference/deep-verify-2026-09-01-36.md#33-claude-code-reads)) and [the plan](../plan/36-issue-life.md "the plan").
- At main: [A8](https://github.com/acme/app/blob/main/knowledge/plan/36-issue-life.md#a8-agent) and <https://github.com/Acme/App/blob/main/knowledge/reference/deep-verify-2026-09-01-36.md>.
- Another repo: [x](https://github.com/acme/other/blob/main/knowledge/plan/36-issue-life.md).
- Kept: [report 44](../reference/deep-verify-2026-10-20-44.md), [old plan](../plan/release.md).
- In code: \`[c](../plan/36-issue-life.md)\`.

\`\`\`text
[f](../plan/36-issue-life.md)
\`\`\`
`;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.dev");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/acme/app.git");
  const files: Record<string, string> = {
    "knowledge/plan/36-issue-life.md": PLAN_36_DONE,
    "knowledge/plan/44-open-plan.md": OPEN_44,
    "knowledge/plan/45-no-nodes.md": "# acme #45 plan\n\nNo node yet.\n",
    "knowledge/plan/release.md": "# release plan\n\n## A1 Agent: z ✅\n",
    "knowledge/reference/deep-verify-2026-09-01-36.md": "# deep-verify 2026-09-01, #36\n\n## 3.3 Claude Code reads\n",
    "knowledge/reference/deep-verify-2026-09-02-40.md": "# deep-verify 2026-09-02, #40\n",
    "knowledge/reference/deep-verify-2026-09-03-36.md": "# deep-verify 2026-09-03, #36\n",
    "knowledge/reference/deep-verify-2026-10-20-44.md": "# deep-verify 2026-10-20, #44\n",
    "knowledge/reference/deep-verify-2026-10-21.md": "# deep-verify 2026-10-21, with no number\n",
    "knowledge/reference/work-loop-sources.md": "# Sources\n",
    "knowledge/index.md": INDEX,
    "knowledge/spec/L2-x.md": SPEC,
    "skills/start/SKILL.md": "---\nname: start\ndescription: old\n---\n\nSee [the report](../../knowledge/reference/deep-verify-2026-09-03-36.md#2-findings).\n",
    "AGENTS.md": "# acme\n\nRead [the plan of #36](knowledge/plan/36-issue-life.md).\n",
    "scripts/check.sh": "# knowledge/plan/36-issue-life.md was the plan\n",
  };
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "the work of #36 and #44");
  return { dir, git, read: (f: string) => readFileSync(join(dir, f), "utf8"), sha: git("rev-parse", "HEAD") };
}

const LEAVE = [
  "knowledge/plan/36-issue-life.md",
  "knowledge/reference/deep-verify-2026-09-01-36.md",
  "knowledge/reference/deep-verify-2026-09-02-40.md",
  "knowledge/reference/deep-verify-2026-09-03-36.md",
];

test("the dry run lists what leaves, the rows, the links and the mentions, and changes nothing", () => {
  const r = repo();
  const out = cleanup(r.dir, true);
  assert.equal(out.stop, null);
  assert.equal(out.commit, r.sha);
  assert.deepEqual(out.remove, [
    { path: "knowledge/plan/36-issue-life.md", why: "the plan of #36: each node is ✅" },
    { path: "knowledge/reference/deep-verify-2026-09-01-36.md", why: "a report of #36, whose plan leaves" },
    { path: "knowledge/reference/deep-verify-2026-09-02-40.md", why: "a report of #40, which has no plan on main" },
    { path: "knowledge/reference/deep-verify-2026-09-03-36.md", why: "a report of #36, whose plan leaves" },
  ]);
  assert.deepEqual(out.kept, [
    { path: "knowledge/plan/44-open-plan.md", open: 1 },
    { path: "knowledge/plan/45-no-nodes.md", open: 0 },
  ]);
  assert.deepEqual(out.rows.map((x) => [x.line, x.path]), [
    [10, "knowledge/reference/deep-verify-2026-09-01-36.md"],
    [11, "knowledge/reference/deep-verify-2026-09-03-36.md"],
  ]);
  assert.deepEqual(out.changed, ["AGENTS.md", "knowledge/index.md", "knowledge/spec/L2-x.md", "skills/start/SKILL.md"]);
  assert.deepEqual(
    out.links.map((l) => `${l.file}:${l.line} ${l.from}`),
    [
      "AGENTS.md:3 knowledge/plan/36-issue-life.md",
      "knowledge/index.md:12 reference/deep-verify-2026-09-02-40.md",
      "knowledge/spec/L2-x.md:3 ../reference/deep-verify-2026-09-01-36.md#33-claude-code-reads",
      "knowledge/spec/L2-x.md:3 ../plan/36-issue-life.md",
      "knowledge/spec/L2-x.md:4 https://github.com/acme/app/blob/main/knowledge/plan/36-issue-life.md#a8-agent",
      "knowledge/spec/L2-x.md:4 https://github.com/Acme/App/blob/main/knowledge/reference/deep-verify-2026-09-01-36.md",
      "skills/start/SKILL.md:6 ../../knowledge/reference/deep-verify-2026-09-03-36.md#2-findings",
    ],
  );
  assert.deepEqual(
    out.mentions.map((m) => `${m.file}:${m.line}`),
    ["knowledge/spec/L2-x.md:5", "knowledge/spec/L2-x.md:7", "knowledge/spec/L2-x.md:10", "scripts/check.sh:1"],
    "another repo, inline code, fenced code, a file that is not Markdown",
  );
  assert.ok(out.warnings.some((w) => w.startsWith("knowledge/plan/36-issue-life.md:27: an open item under a ✅ heading")));
  assert.ok(out.warnings.includes("knowledge/reference/deep-verify-2026-10-21.md: a report with no issue number stays; each report names its issue"));
  assert.equal(out.removed_by_version, null, "no version commit yet");
  assert.equal(r.git("status", "--porcelain"), "", "the dry run changes nothing");
});

test("it removes and stages; each link becomes permanent at HEAD with its anchor; a second run changes nothing", () => {
  const r = repo();
  // The version change is staged before it runs, as in step 4 (here the version command changes a line of a SKILL.md).
  writeFileSync(join(r.dir, "skills/start/SKILL.md"), r.read("skills/start/SKILL.md").replace("description: old", "description: new"));
  r.git("add", "skills/start/SKILL.md");

  const out = cleanup(r.dir);
  assert.equal(out.stop, null);
  for (const f of LEAVE) assert.ok(!existsSync(join(r.dir, f)), `${f} is gone`);
  assert.equal(r.git("diff", "--name-only"), "", "all is staged");
  assert.deepEqual(r.git("diff", "--cached", "--name-status").split("\n"), [
    "M\tAGENTS.md",
    "M\tknowledge/index.md",
    "D\tknowledge/plan/36-issue-life.md",
    "D\tknowledge/reference/deep-verify-2026-09-01-36.md",
    "D\tknowledge/reference/deep-verify-2026-09-02-40.md",
    "D\tknowledge/reference/deep-verify-2026-09-03-36.md",
    "M\tknowledge/spec/L2-x.md",
    "M\tskills/start/SKILL.md",
  ]);

  const at = `https://github.com/acme/app/blob/${r.sha}`;
  assert.equal(r.read("AGENTS.md"), `# acme\n\nRead [the plan of #36](${at}/knowledge/plan/36-issue-life.md).\n`);
  assert.equal(
    r.read("skills/start/SKILL.md"),
    `---\nname: start\ndescription: new\n---\n\nSee [the report](${at}/knowledge/reference/deep-verify-2026-09-03-36.md#2-findings).\n`,
  );
  const spec = r.read("knowledge/spec/L2-x.md").split("\n");
  assert.equal(spec[2], `- Measured ([deep-verify §3.3](${at}/knowledge/reference/deep-verify-2026-09-01-36.md#33-claude-code-reads)) and [the plan](${at}/knowledge/plan/36-issue-life.md "the plan").`);
  assert.equal(spec[3], `- At main: [A8](${at}/knowledge/plan/36-issue-life.md#a8-agent) and <${at}/knowledge/reference/deep-verify-2026-09-01-36.md>.`);
  assert.equal(spec.slice(4).join("\n"), SPEC.split("\n").slice(4).join("\n"), "another repo, a kept file, code: as they were");
  const index = r.read("knowledge/index.md");
  assert.ok(!index.includes("deep-verify-2026-09-01") && !index.includes("deep-verify-2026-09-03-36"), "their rows are gone");
  assert.ok(index.includes(`| Round 1 of #44; [the one before](${at}/knowledge/reference/deep-verify-2026-09-02-40.md). |`));
  assert.deepEqual(brokenLinks(r.dir), [], "the link check passes");

  const staged = r.git("diff", "--cached");
  const again = cleanup(r.dir);
  assert.equal(again.stop, null);
  assert.deepEqual(again.remove, out.remove, "the same files leave");
  assert.deepEqual([again.rows, again.links, again.changed], [[], [], []], "nothing more to change");
  assert.deepEqual(again.mentions, out.mentions);
  assert.equal(r.git("diff", "--cached"), staged);
  assert.equal(r.git("diff", "--name-only"), "");
});

test("it stops and changes nothing when a file that it must change has changes that are not committed or staged", () => {
  const r = repo();
  writeFileSync(join(r.dir, "AGENTS.md"), `${r.read("AGENTS.md")}\nHalf-done work.\n`);
  const out = cleanup(r.dir);
  assert.match(out.stop ?? "", /AGENTS\.md \(not staged\)/);
  assert.match(out.stop ?? "", /; stage the version change first$/, "the way out is to stage the version change; step 2 commits nothing");
  assert.equal(r.git("status", "--porcelain"), "M AGENTS.md");
  r.git("checkout", "--", "AGENTS.md");

  writeFileSync(join(r.dir, "knowledge/reference/deep-verify-2026-09-01-36.md"), "# edited\n");
  r.git("add", "knowledge/reference/deep-verify-2026-09-01-36.md");
  const out2 = cleanup(r.dir);
  assert.match(out2.stop ?? "", /deep-verify-2026-09-01-36\.md \(not committed\)/, "a staged change of a file that leaves is not at HEAD");
  assert.equal(r.git("status", "--porcelain"), "M  knowledge/reference/deep-verify-2026-09-01-36.md");
});

test("a tracked symlink to a directory is not read: .claude/skills -> ../skills", () => {
  const r = repo();
  mkdirSync(join(r.dir, ".claude"));
  symlinkSync("../skills", join(r.dir, ".claude/skills"));
  r.git("add", ".claude/skills");
  r.git("commit", "-q", "-m", "the skills of Claude Code are the skills");
  assert.match(r.git("ls-files", "-s", ".claude/skills"), /^120000 /);
  const sha = r.git("rev-parse", "HEAD");

  const dry = cleanup(r.dir, true);
  assert.equal(dry.stop, null);
  assert.ok(dry.changed.includes("skills/start/SKILL.md") && !dry.changed.some((f) => f.startsWith(".claude/")), "the files behind the link are read once, by their own path");
  assert.ok(!dry.links.some((l) => l.file.startsWith(".claude/")));

  const out = cleanup(r.dir);
  assert.equal(out.stop, null);
  assert.ok(r.read("skills/start/SKILL.md").includes(`https://github.com/acme/app/blob/${sha}/knowledge/reference/deep-verify-2026-09-03-36.md#2-findings`));
  assert.equal(r.git("diff", "--cached", "--name-status", "--", ".claude"), "", "the link itself does not change");
});

test("nothing finished: it lists the open plans and changes nothing", () => {
  const r = repo();
  r.git("rm", "-q", "knowledge/plan/36-issue-life.md", "knowledge/reference/deep-verify-2026-09-01-36.md", "knowledge/reference/deep-verify-2026-09-02-40.md", "knowledge/reference/deep-verify-2026-09-03-36.md");
  r.git("commit", "-q", "-m", "gone");
  const out = cleanup(r.dir);
  assert.deepEqual([out.remove, out.changed, out.stop], [[], [], null]);
  assert.equal(out.kept.length, 2);
});

test("step 6: after the merge of origin/main, a new link to a file that the version commit removed becomes permanent at its parent", () => {
  const r = repo();
  writeFileSync(join(r.dir, "VERSION"), "20261101.1\n");
  r.git("add", "VERSION");
  assert.equal(cleanup(r.dir).stop, null);
  r.git("commit", "-q", "-m", "version: 20261101.1");
  const version = r.git("rev-parse", "HEAD");
  const before = cleanup(r.dir, true);
  assert.deepEqual([before.changed, before.remove.length], [[], 0], "at the version commit: nothing to do");
  assert.deepEqual(before.removed_by_version, { commit: version, links_at: r.sha, paths: LEAVE });

  // origin/main moved: a PR from before the release links to a removed plan and a removed report.
  r.git("checkout", "-q", "-b", "side", r.sha);
  mkdirSync(join(r.dir, "knowledge/spec"), { recursive: true });
  writeFileSync(join(r.dir, "knowledge/spec/L3-new.md"), "# L3-new\n\nSee [the plan](../plan/36-issue-life.md#a8-agent) and [the report](https://github.com/acme/app/blob/main/knowledge/reference/deep-verify-2026-09-01-36.md).\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "A new page");
  r.git("checkout", "-q", "main");
  r.git("merge", "-q", "--no-ff", "-m", "Merge origin/main", "side");
  assert.deepEqual(brokenLinks(r.dir), ["knowledge/spec/L3-new.md:3 -> ../plan/36-issue-life.md#a8-agent"]);

  const out = cleanup(r.dir);
  assert.equal(out.stop, null);
  assert.deepEqual([out.remove, out.changed], [[], ["knowledge/spec/L3-new.md"]]);
  const at = `https://github.com/acme/app/blob/${r.sha}`;
  assert.equal(r.read("knowledge/spec/L3-new.md"), `# L3-new\n\nSee [the plan](${at}/knowledge/plan/36-issue-life.md#a8-agent) and [the report](${at}/knowledge/reference/deep-verify-2026-09-01-36.md).\n`);
  assert.deepEqual(brokenLinks(r.dir), []);
  assert.equal(r.git("diff", "--cached", "--name-only"), "knowledge/spec/L3-new.md", "staged for the commit Merge follow-up: links");
  r.git("commit", "-q", "-m", "Merge follow-up: links");
  assert.deepEqual(cleanup(r.dir).changed, [], "a second run changes nothing");
});
