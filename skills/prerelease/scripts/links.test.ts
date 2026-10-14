import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { anchorsOf, brokenAnchors, slug } from "./links.mjs";

test("slug: the GitHub anchor of a heading", () => {
  assert.equal(slug("2.3 The graph of open work"), "23-the-graph-of-open-work", "digits stay, the dot goes");
  assert.equal(slug("A1 Agent: the spec on main ✅"), "a1-agent-the-spec-on-main-", "no trim: ✅ at the end leaves a trailing -");
  assert.equal(slug("D1 Owner decides what step 2 commits ✅"), "d1-owner-decides-what-step-2-commits-");
  assert.equal(slug("§2.8 A release removes `finished` plans 🔶"), "28-a-release-removes-finished-plans-", "§, backticks and 🔶 go out");
  assert.equal(slug("第 3 节：一个 issue 的 spec review（之前）"), "第-3-节一个-issue-的-spec-review之前", "Chinese letters stay, its punctuation goes");
  assert.equal(slug("The [link text](other.md#x) and **bold** and snake_case"), "the-link-text-and-bold-and-snake_case", "link targets and emphasis go, _ in a word stays");
});

test("anchorsOf: duplicates get -1, -2; headings in fenced code do not count; HTML ids count", () => {
  const text = ["# Title", "## x", "## x", "## x", "```md", "## In code", "```", '<a id="kept-id"></a>', "Setext", "---", "### Closing ###"].join("\n");
  assert.deepEqual([...anchorsOf(text)], ["title", "x", "x-1", "x-2", "kept-id", "setext", "closing"]);
});

/** A git repo in a temp folder with the given files (path from the root -> text). */
function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "links-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("brokenAnchors: a missing anchor fails, a present one passes, #anchor to the same file is examined", () => {
  const root = repo({
    "a.md": "# A ✅\n\n## Two\n\n[ok](b/c.md#23-the-graph-of-open-work) [bad](b/c.md#no-such) [self](#two) [self-bad](#three) [top](#a-)\n",
    "b/c.md": "### 2.3 The graph of open work\n\n[up](../a.md#Two) [code](../x.ts#L3) [gone](../none.md#x) [dir](../b#x)\n",
    "x.ts": "",
  });
  assert.deepEqual(brokenAnchors(root), ["a.md:5 -> b/c.md#no-such", "a.md:5 -> #three"]);
});
