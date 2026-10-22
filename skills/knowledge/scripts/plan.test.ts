import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { addArrow, addItem, addNode, answerD, applyEdit, checkItem, dropItem, dropNode, EditError, main, markDone, removeArrow, setNow } from "./plan.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const EXAMPLE = fixture("42-export.txt");
const ENGLISH = fixture("7-english.txt");
const INDEX = fixture("index.txt");
const ISSUE = "knowledge/plan/42-export.md";
const EN = "knowledge/plan/7-english.md";
const GRAPH = "knowledge/plan/index.md";
const D = "2026-10-22";
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** The text with each [from, to] replaced once; each `from` must be in the text. The rest stays byte for byte. */
function patch(text: string, ...pairs: [string, string][]): string {
  for (const [a, b] of pairs) {
    assert.ok(text.includes(a), `not in the text: ${a}`);
    text = text.replace(a, b);
  }
  return text;
}

/** The edit gives exactly `expected`, and adds no problem. */
function edits(before: string, file: string, edit: (t: string) => string, expected: string) {
  const r = applyEdit(before, file, edit);
  assert.equal(r.text, expected);
  assert.deepEqual(
    r.findings.filter((f) => f.kind === "problem"),
    [],
  );
  return r;
}

const refuses = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof EditError && re.test(e.message));

test("add: the labelled line and one arrow on each line at the end of the chart; the section before the node that waits on it", () => {
  const r = edits(
    EXAMPLE,
    ISSUE,
    (t) => addNode(t, ISSUE, { code: "A7", label: "agent：导出的文档", after: ["A3"], before: ["O5"], items: ["写 README 一节", "**A7.2 例子**"] }),
    patch(
      EXAMPLE,
      ['  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n  A7["A7 agent：导出的文档"]\n  A3 --> A7\n  A7 --> O5\n'],
      ["## O5 owner：发版 ⬜", "## A7 agent：导出的文档 ⬜\n\n- [ ] **A7.1** 写 README 一节\n- [ ] **A7.2 例子**\n\n## O5 owner：发版 ⬜"],
    ),
  );
  assert.deepEqual(r.findings, []);
});

test("add: after its last predecessor when nothing waits on it; at the end of the file; a body file; an index node", () => {
  edits(
    EXAMPLE,
    ISSUE,
    (t) => addNode(t, ISSUE, { code: "A7", label: "A7 agent：截图", after: ["A6"] }),
    patch(EXAMPLE, ['  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n  A7["A7 agent：截图"]\n  A6 --> A7\n'], ["## O3–O4 owner", "## A7 agent：截图 ⬜\n\n## O3–O4 owner"]),
  );
  edits(
    EXAMPLE,
    ISSUE,
    (t) => addNode(t, ISSUE, { code: "D3", label: "owner 拍板：开关的名字", before: ["A5"], body: "背景：A5 的开关。\n\n问题：叫什么？\n\n例子：……\n\n- **推荐：export。** agent 做。\n- dump：agent 做。\n" }),
    patch(
      EXAMPLE,
      ['  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n  D3["D3 owner 拍板：开关的名字"]\n  D3 --> A5\n'],
      ["## A5 agent：打开线上的开关 ⬜", "## D3 owner 拍板：开关的名字 ⬜\n\n背景：A5 的开关。\n\n问题：叫什么？\n\n例子：……\n\n- **推荐：export。** agent 做。\n- dump：agent 做。\n\n## A5 agent：打开线上的开关 ⬜"],
    ),
  );
  edits(
    EXAMPLE,
    ISSUE,
    (t) => addNode(t, ISSUE, { code: "A7", label: "agent：收尾", after: ["A5"] }),
    `${patch(EXAMPLE, ['  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n  A7["A7 agent：收尾"]\n  A5 --> A7\n'])}\n## A7 agent：收尾 ⬜\n`,
  );
  edits(
    INDEX,
    GRAPH,
    (t) => addNode(t, GRAPH, { code: "I60", label: "export：agent", after: ["I44"] }),
    patch(INDEX, ['  alphaO15["alpha O15 sign the contract：owner"] --> I53\n', '  alphaO15["alpha O15 sign the contract：owner"] --> I53\n  I60["#60 export：agent"]\n  I44 --> I60\n']),
  );
});

test("add: refusals", () => {
  refuses(() => addNode(EXAMPLE, ISSUE, { code: "A6", label: "agent：x" }), /already has A6: a code is not used again/);
  refuses(() => addNode(EXAMPLE, ISSUE, { code: "O4", label: "owner：x" }), /already has O4/);
  refuses(() => addNode(EXAMPLE, ISSUE, { code: "A7", label: "agent：x", before: ["O1"] }), /O1 is ✅: a ✅ node does not wait on a new node/);
  refuses(() => addNode(EXAMPLE, ISSUE, { code: "a7", label: "agent：x" }), /is not a code/);
  refuses(() => addNode(EXAMPLE, ISSUE, { code: "A7", label: "agent：x", after: ["Z1"] }), /has no node Z1/);
});

test("add: an edit that adds a problem is not written (an M node in the plan of an issue)", () => {
  const r = applyEdit(EXAMPLE, ISSUE, (t) => addNode(t, ISSUE, { code: "M1", label: "发布", after: ["A5"] }));
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.kind === "problem" && /M1: the plan of an issue has no M node/.test(f.text)));
});

test("arrow and unarrow: one arrow on its own line; a done node drawn again in the open chart; a label stays on its line", () => {
  edits(EXAMPLE, ISSUE, (t) => addArrow(t, ISSUE, "A6", "A5"), patch(EXAMPLE, ['  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n  A6 --> A5\n']));
  edits(ENGLISH, EN, (t) => addArrow(t, EN, "A1", "E1"), patch(ENGLISH, ['  A2 --> E1["E1 Event: the store accepts the app"]\n', '  A2 --> E1["E1 Event: the store accepts the app"]\n  A1["A1 Agent: one ✅"]\n  A1 --> E1\n']));
  edits(EXAMPLE, ISSUE, (t) => removeArrow(t, ISSUE, "A3", "A6"), patch(EXAMPLE, ['  A3 --> A6["A6 agent：导出一份测试数据"]\n', '  A6["A6 agent：导出一份测试数据"]\n']));
  edits(EXAMPLE, ISSUE, (t) => removeArrow(t, ISSUE, "A2", "O2"), patch(EXAMPLE, ["  A2 --> O2\n", ""]));
  refuses(() => addArrow(EXAMPLE, ISSUE, "A5", "A3"), /the arrow makes a cycle: A3 → A4 → O5 → A5 → A3/);
  refuses(() => addArrow(EXAMPLE, ISSUE, "A2", "A1"), /A1 is ✅: a ✅ node does not get a new wait/);
  refuses(() => addArrow(EXAMPLE, ISSUE, "A3", "A4"), /already in the chart/);
  refuses(() => removeArrow(EXAMPLE, ISSUE, "A1", "O1"), /O1 is ✅: the arrows into a ✅ node stay/);
  refuses(() => removeArrow(patch(EXAMPLE, ["  A2 --> O2\n", "  O1 --> A2 --> O2\n"]), ISSUE, "A2", "O2"), /holds 2 arrows/);
  refuses(() => removeArrow(EXAMPLE, ISSUE, "A6", "A5"), /no arrow A6 --> A5/);
});

test("item: check with the date and the evidence; add with the next code; strike with the reason and the open sub-items", () => {
  edits(EXAMPLE, ISSUE, (t) => checkItem(t, ISSUE, "A2", { which: "A2.1", evidence: "报告链接", date: D }), patch(EXAMPLE, ["- [ ] **A2.1 ……**", "- [x] **A2.1 ……**（2026-10-22，报告链接）"]));
  edits(EXAMPLE, ISSUE, (t) => checkItem(t, ISSUE, "O3–O4", { which: "O4", date: D }), patch(EXAMPLE, ["- [ ] **O4 建一把只能写这个桶的 token。** ……", "- [x] **O4 建一把只能写这个桶的 token。** ……（2026-10-22）"]));
  edits(EXAMPLE, ISSUE, (t) => addItem(t, ISSUE, "A3", { text: "截图" }), patch(EXAMPLE, ["  - 过：导出的用例在 `make test` 里通过。\n", "  - 过：导出的用例在 `make test` 里通过。\n- [ ] **A3.3** 截图\n"]));
  edits(EXAMPLE, ISSUE, (t) => addItem(t, ISSUE, "O5", { text: "叫 `prerelease`" }), patch(EXAMPLE, ["- 做完的样子：带这个 PR 的 tag 在 origin 上。\n", "- 做完的样子：带这个 PR 的 tag 在 origin 上。\n\n- [ ] 叫 `prerelease`\n"]));
  edits(
    EXAMPLE,
    ISSUE,
    (t) => dropItem(t, ISSUE, "A3", { which: "A3.2", reason: "owner 说不导出", date: D }),
    patch(EXAMPLE, ["- [ ] **A3.2 导出成文件**（`src/export.ts`）。等 D2。", "- [x] ~~**A3.2 导出成文件**（`src/export.ts`）。等 D2。~~ 不用做了（2026-10-22）：owner 说不导出"], ["  - [ ] 等 D2 的子项", "  - [x] ~~等 D2 的子项~~"]),
  );
  refuses(() => checkItem(EXAMPLE, ISSUE, "A3", { which: "A3.2", date: D }), /has 1 open sub-item/);
  refuses(() => checkItem(EXAMPLE, ISSUE, "A3", { which: "A3.1", date: D }), /already checked/);
  refuses(() => checkItem(EXAMPLE, ISSUE, "A1", { which: "做完", date: D }), /A1 is ✅: its items do not change/);
  refuses(() => dropItem(EXAMPLE, ISSUE, "A3", { which: "A3.1", reason: "x", date: D }), /checked: done work is not struck/);
  refuses(() => addItem(EXAMPLE, ISSUE, "O1", { text: "x" }), /O1 is ✅: add a new node for new work/);
});

test("done: ✅ on the labels and the heading, the section in one line with the date and the commit; refused with open items", () => {
  refuses(() => markDone(EXAMPLE, ISSUE, "A2", { commit: "abc1234", date: D }), /A2 has 1 open item\(s\): A2\.1/);
  const checked = patch(EXAMPLE, ["- [ ] **A2.1 ……**", "- [x] **A2.1 ……**（2026-10-22，报告）"]);
  edits(
    checked,
    ISSUE,
    (t) => markDone(t, ISSUE, "A2", { commit: "abc1234", date: D }),
    patch(checked, ['A2["A2 agent：deep-verify（后台）"]', 'A2["A2 agent：deep-verify（后台） ✅"]'], ["## A2 agent：deep-verify（后台） ⬜\n\n- [x] **A2.1 ……**（2026-10-22，报告）\n", "## A2 agent：deep-verify（后台） ✅\n\n- [x] deep-verify（后台）（2026-10-22，`abc1234`）\n"]),
  );
  edits(
    EXAMPLE,
    ISSUE,
    (t) => markDone(t, ISSUE, "E1", { summary: "商店审核通过了", date: D }),
    patch(EXAMPLE, ['E1["E1 外部事件：商店审核通过"]', 'E1["E1 外部事件：商店审核通过 ✅"]'], ["## E1 外部事件：商店审核通过 ⬜\n\n等什么；怎么知道到了。到了：做 A5。\n", "## E1 外部事件：商店审核通过 ✅\n\n- [x] 商店审核通过了（2026-10-22）\n"]),
  );
  edits(
    ENGLISH,
    EN,
    (t) => markDone(t, EN, "E1", { date: D }),
    patch(ENGLISH, ['E1["E1 Event: the store accepts the app"]', 'E1["E1 Event: the store accepts the app ✅"]'], ["## E1 Event: the store accepts the app ⬜\n\nThe store sends a mail. Then: nothing waits.\n", "## E1 Event: the store accepts the app ✅\n\n- [x] the store accepts the app (2026-10-22)\n"]),
  );
  const a6 = patch(EXAMPLE, ["- [ ] 跑 `make export`", "- [x] 跑 `make export`"]);
  refuses(() => markDone(a6, ISSUE, "A6", { date: D }), /A6 is an A node: give the commit/);
  refuses(() => markDone(EXAMPLE, ISSUE, "D2", { date: D }), /record the answer with plan.ts answer/);
  refuses(() => markDone(EXAMPLE, ISSUE, "A1", { commit: "abc1234", date: D }), /A1 is already ✅/);
  edits(
    INDEX,
    GRAPH,
    (t) => markDone(t, GRAPH, "I43", { date: D }),
    patch(INDEX, ['I43["#43 live runs：agent"]', 'I43["#43 live runs：agent ✅"]'], ["| #43 | Live runs", "| #43 ✅ | Live runs"]),
  );
});

test("drop: a first struck line with the reason, each open item struck, ✅ on the heading and the labels; the node stays", () => {
  edits(
    EXAMPLE,
    ISSUE,
    (t) => dropNode(t, ISSUE, "A6", { reason: "owner 说不要测试数据", date: D }),
    patch(
      EXAMPLE,
      ['A6["A6 agent：导出一份测试数据"]', 'A6["A6 agent：导出一份测试数据 ✅"]'],
      [
        "## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑 `make export`，数文件的行数。过：和库里的行数一样。",
        "## A6 agent：导出一份测试数据 ✅\n\n- [x] ~~**A6 agent：导出一份测试数据**~~ 不用做了（2026-10-22）：owner 说不要测试数据\n\n- [x] ~~跑 `make export`，数文件的行数。过：和库里的行数一样。~~",
      ],
    ),
  );
  refuses(() => dropNode(EXAMPLE, ISSUE, "A1", { reason: "x", date: D }), /A1 is ✅: a ✅ node is not struck/);
  refuses(() => dropNode(INDEX, GRAPH, "I43", { reason: "x", date: D }), /a closed issue gets ✅/);
});

test("answer: the owner's words in one line; a skipped D keeps its text under the line of the recommended option", () => {
  edits(
    EXAMPLE,
    ISSUE,
    (t) => answerD(t, ISSUE, "D2", { option: "CSV", quote: "用 CSV", date: D }),
    patch(
      EXAMPLE,
      ['D2["D2 owner 拍板：文件格式"]', 'D2["D2 owner 拍板：文件格式 ✅"]'],
      [EXAMPLE.slice(EXAMPLE.indexOf("## D2 owner 拍板：文件格式 ⬜"), EXAMPLE.indexOf("## A3 agent")), "## D2 owner 拍板：文件格式 ✅\n\nowner 定的（2026-10-22，「用 CSV」）：CSV\n\n"],
    ),
  );
  edits(
    EXAMPLE,
    ISSUE,
    (t) => answerD(t, ISSUE, "D2", { skipped: true, date: D }),
    patch(EXAMPLE, ['D2["D2 owner 拍板：文件格式"]', 'D2["D2 owner 拍板：文件格式 ✅"]'], ["## D2 owner 拍板：文件格式 ⬜\n", "## D2 owner 拍板：文件格式 ✅\n\nAgent decided (2026-10-22)：CSV，因为这个 D 被跳过了。\n"]),
  );
  edits(
    ENGLISH,
    EN,
    (t) => answerD(t, EN, "D1", { option: "CSV", quote: "csv is fine", date: D }),
    patch(
      ENGLISH,
      ['D1["D1 Owner decides: the format"]', 'D1["D1 Owner decides: the format ✅"]'],
      [ENGLISH.slice(ENGLISH.indexOf("## D1"), ENGLISH.indexOf("## A2 Agent")), '## D1 Owner decides: the format ✅\n\nOwner decided (2026-10-22, "csv is fine"): CSV\n\n'],
    ),
  );
  refuses(() => answerD(EXAMPLE, ISSUE, "A3", { option: "x", quote: "y", date: D }), /A3 is not a D/);
  refuses(() => answerD(EXAMPLE, ISSUE, "D2", { option: "x", date: D }), /give the option \(--option\) and the owner's words/);
});

test("now: the text after Now: changes; with no line, one goes under the title; only index.md", () => {
  edits(INDEX, GRAPH, (t) => setNow(t, GRAPH, "#53 A2: the agent can do it now."), patch(INDEX, ["> **Now:** #44 A1: the agent can do it now. #45 waits on E1.", "> **Now:** #53 A2: the agent can do it now."]));
  const none = INDEX.replace("> **Now:** #44 A1: the agent can do it now. #45 waits on E1.\n\n", "");
  edits(none, GRAPH, (t) => setNow(t, GRAPH, "#44 A1."), patch(none, ["# Open work of my-app\n", "# Open work of my-app\n\n> **Now:** #44 A1.\n"]));
  refuses(() => setNow(EXAMPLE, ISSUE, "x"), /is not the graph of open work/);
});

// ---------- the command ----------

/** A git repo in a temp folder with the given files, committed. */
function repo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "plan-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git("add", "-A");
  git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "plans");
  return { root, git, read: (p: string) => readFileSync(join(root, p), "utf8"), write: (p: string, t: string) => writeFileSync(join(root, p), t) };
}

const run = (...args: string[]) => {
  const out: string[] = [];
  const status = main(args, (l) => out.push(l));
  return { status, out: out.join("\n") };
};

test("the command: check (also --against and --new), an edit that writes, an edit that adds a problem and is not written, done --commit, json", () => {
  const r = repo({ [ISSUE]: EXAMPLE, [GRAPH]: INDEX, [EN]: ENGLISH });
  let c = run("check", "--cwd", r.root);
  assert.equal(c.status, 0, c.out);
  assert.match(c.out, /^question knowledge\/plan\/42-export\.md:30: the ✅ node A1 names no commit/m);

  r.write(ISSUE, patch(EXAMPLE, ["## A1 agent：调研导出格式 ✅\n\n- [x] 做完的节点压成一两行（日期、commit）。\n\n", ""], ['A1["A1 agent：调研导出格式 ✅"] --> O1["O1 owner：spec review ✅"]', 'O1["O1 owner：spec review ✅"]']));
  c = run("check", ISSUE, "--cwd", r.root);
  assert.equal(c.status, 0, "with no --against, the file alone has no problem");
  c = run("check", ISSUE, "--cwd", r.root, "--against", "HEAD");
  assert.equal(c.status, 1);
  assert.match(c.out, /problem knowledge\/plan\/42-export\.md:1: the ✅ node A1 is removed/);
  c = run("check", ISSUE, "--cwd", r.root, "--against", "HEAD", "--new");
  assert.equal(c.status, 1);
  assert.doesNotMatch(c.out, /names no commit/, "--new: only findings that HEAD does not have");
  r.write(ISSUE, EXAMPLE);

  const sha = r.git("rev-parse", "HEAD");
  c = run("item", ISSUE, "A2", "--check", "A2.1", "--evidence", "报告", "--date", D, "--cwd", r.root);
  assert.equal(c.status, 0, c.out);
  c = run("done", ISSUE, "A2", "--commit", sha, "--date", D, "--cwd", r.root);
  assert.equal(c.status, 0, c.out);
  assert.match(r.read(ISSUE), new RegExp(`- \\[x\\] deep-verify（后台）（2026-10-22，\`${sha.slice(0, 7)}\`）`));
  c = run("done", ISSUE, "A6", "--commit", "0000000", "--cwd", r.root);
  assert.equal(c.status, 1);
  assert.match(c.out, /^refused: the commit 0000000 is not in the repo/);

  const before = r.read(ISSUE);
  c = run("add", ISSUE, "--code", "M1", "--label", "发布", "--after", "A5", "--cwd", r.root);
  assert.equal(c.status, 1);
  assert.match(c.out, /^not written: the edit adds a problem/);
  assert.equal(r.read(ISSUE), before, "the file is not changed");

  c = run("now", GRAPH, "#53 A2.", "--cwd", r.root);
  assert.equal(c.status, 0, c.out);
  assert.match(r.read(GRAPH), /^> \*\*Now:\*\* #53 A2\.$/m);

  c = run("json", EN, "--cwd", r.root);
  const plan = JSON.parse(c.out);
  assert.deepEqual(
    plan.nodes.map((n: { code: string }) => n.code),
    ["A1", "O1", "A2", "D1", "E1"],
  );
  assert.equal(run("nope", ISSUE, "--cwd", r.root).status, 1);
  assert.equal(run("help").status, 0);
});

test("the command line: the exit code of the process", () => {
  const r = repo({ [ISSUE]: patch(EXAMPLE, ["## A4 agent：文件传到桶 ⬜", "## A4 agent：上传 ⬜"]) });
  const script = fileURLToPath(new URL("./plan.ts", import.meta.url));
  const p = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, "check", "--cwd", r.root], { encoding: "utf8" });
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /^problem knowledge\/plan\/42-export\.md:88: the heading of A4 is not its chart label/m);
});

test("the hook (hooks.json PostToolUse): exit 2 with the problems on stderr for a plan that breaks a rule; silent for another file or a plan with no new problem", () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, "hooks/hooks.json"), "utf8")).hooks.PostToolUse;
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].matcher, "Edit|Write|MultiEdit");
  const command = hooks[0].hooks[0].command;
  const r = repo({ [ISSUE]: EXAMPLE, "README.md": "# x\n" });
  const hook = (input: unknown, pluginRoot = ROOT) =>
    spawnSync("/bin/sh", ["-c", command], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } });

  const quiet = hook({ cwd: r.root, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(r.root, ISSUE) } });
  assert.deepEqual([quiet.status, quiet.stdout, quiet.stderr], [0, "", ""], "a plan with no new problem");

  r.write(ISSUE, patch(EXAMPLE, ['A6["A6 agent：导出一份测试数据"]', 'A6["A6 agent：导出一份测试数据 ✅"]']));
  const loud = hook({ cwd: r.root, tool_name: "Write", tool_input: { file_path: ISSUE } });
  assert.equal(loud.status, 2, loud.stderr);
  assert.match(loud.stderr, /^knowledge\/plan\/42-export\.md breaks the rules of a plan/);
  assert.match(loud.stderr, /problem knowledge\/plan\/42-export\.md:18: the label of A6 has ✅, and its heading has no ✅/);
  assert.equal(loud.stdout, "");

  for (const input of [{ cwd: r.root, tool_input: { file_path: join(r.root, "README.md") } }, { cwd: r.root, tool_input: { file_path: join(r.root, "knowledge/plan/gone.md") } }, { tool_input: {} }, "not json"]) {
    const h = hook(input);
    assert.deepEqual([h.status, h.stdout, h.stderr], [0, "", ""], JSON.stringify(input));
  }
  const missing = hook({ cwd: r.root, tool_input: { file_path: ISSUE } }, join(r.root, "no-plugin"));
  assert.deepEqual([missing.status, missing.stderr], [0, ""], "no hook script: silent");
});
