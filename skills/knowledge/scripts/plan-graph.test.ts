import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkPlan, checkTransition, codesOf, type PlanFinding, parseChartLine, parsePlan } from "./plan-graph.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
/** The full example of spec-and-plan.md 「例子」, from its four code blocks. */
const EXAMPLE = fixture("42-export.txt");
const ENGLISH = fixture("7-english.txt");
const INDEX = fixture("index.txt");
const ISSUE = "knowledge/plan/42-export.md";

/** The text with each [from, to] replaced once; each `from` must be in the text. */
function patch(text: string, ...pairs: [string, string][]): string {
  for (const [a, b] of pairs) {
    assert.ok(text.includes(a), `not in the text: ${a}`);
    text = text.replace(a, b);
  }
  return text;
}

const check = (text: string, file = ISSUE) => checkPlan(parsePlan(text, file), text);
const problems = (f: PlanFinding[]) => f.filter((x) => x.kind === "problem");
const questions = (f: PlanFinding[]) => f.filter((x) => x.kind === "question");
const texts = (f: PlanFinding[]) => f.map((x) => `${x.where} ${x.text}`);

test("the fixture is the example of spec-and-plan.md 「例子」, unchanged", () => {
  const doc = readFileSync(new URL("../references/spec-and-plan.md", import.meta.url), "utf8");
  const part = doc.slice(doc.indexOf("## 例子"), doc.indexOf("## 依赖图和节点"));
  const blocks = [...part.matchAll(/```(markdown|mermaid)\n([\s\S]*?)```\n/g)];
  assert.equal(blocks.length, 4);
  const [head, chart, mid, tail] = blocks.map((b) => b[2]);
  assert.equal(EXAMPLE, `${head}\n\`\`\`mermaid\n${chart}\`\`\`\n\n${mid}\n${tail}`, "rebuild fixtures/42-export.txt from the example");
});

test("the example parses: codes, kinds, ✅, the range O3–O4, the sections and the arrows", () => {
  const p = parsePlan(EXAMPLE, ISSUE);
  assert.equal(p.kind, "issue");
  assert.equal(p.lang, "zh");
  assert.equal(p.title, "my-app #<N> plan：导出");
  assert.match(p.update ?? "", /^> \*\*更新 <日期>\*\*/);
  assert.deepEqual(p.log, ["<日期>：……"]);
  assert.match(p.notes, /^- O1 时 owner 要改两处/);
  assert.deepEqual(
    p.nodes.map((n) => `${n.code}:${n.kind}:${n.done ? "✅" : "⬜"}`),
    ["A1:A:✅", "O1:O:✅", "D1:D:✅", "A2:A:⬜", "O2:O:⬜", "A3:A:⬜", "D2:D:⬜", "A4:A:⬜", "O3–O4:O:⬜", "A6:A:⬜", "O5:O:⬜", "A5:A:⬜", "E1:E:⬜"],
  );
  const o3 = p.nodes.find((n) => n.code === "O3–O4")!;
  assert.equal(o3.id, "O3");
  assert.equal(o3.section?.title, "O3–O4 owner：建桶、建 token ⬜");
  assert.deepEqual(o3.items.map((i) => i.id), ["O3", "O4"]);
  const a3 = p.nodes.find((n) => n.code === "A3")!;
  assert.deepEqual(
    a3.items.map((i) => [i.id, i.checked, i.depth]),
    [
      ["A3.1", true, 0],
      ["A3.2", false, 0],
      [null, true, 1],
      [null, false, 1],
    ],
  );
  assert.equal(p.edges.length, 13);
  assert.deepEqual(p.edges.find((e) => e.to === "A4" && e.from.startsWith("O")), { from: "O3–O4", to: "A4", line: 17 });
  assert.deepEqual(codesOf("O3–O4"), ["O3", "O4"]);
});

test("the example has no problem; its only question is the commit of A1 (a placeholder in the example)", () => {
  const f = check(EXAMPLE);
  assert.deepEqual(problems(f), []);
  assert.deepEqual(texts(questions(f)), [`${ISSUE}:30 the ✅ node A1 names no commit (a short sha in backticks)`]);
});

test("English labels, two charts (a done node drawn again), and the small chart of a node with ### subsections", () => {
  const p = parsePlan(ENGLISH, "knowledge/plan/7-english.md");
  assert.equal(p.lang, "en");
  assert.deepEqual(
    p.nodes.map((n) => `${n.code}:${n.kind}`),
    ["A1:A", "O1:O", "A2:A", "D1:D", "E1:E"],
    "the small chart of A2 (A2a, A2b) is not in the nodes",
  );
  assert.deepEqual(p.nodes.find((n) => n.code === "O1")!.labelLines, [7, 12]);
  assert.deepEqual(
    p.charts.map((c) => [c.direction, c.section]),
    [
      ["TB", null],
      ["LR", null],
      ["LR", "A2"],
    ],
  );
  assert.deepEqual(check(ENGLISH, "knowledge/plan/7-english.md"), []);
  const noSub = ENGLISH.replace("### A2.2 test the file", "### A2.2 the test");
  assert.deepEqual(texts(problems(check(noSub, "knowledge/plan/7-english.md"))), [
    'knowledge/plan/7-english.md:42 the small chart of A2 has "A2.2 test the file", and the section has no "### " subsection with that title',
  ]);
});

test("chart lines: shapes, chains, &, text arrows, |labels|, :::classes and statements", () => {
  const ids = (line: string) => parseChartLine(line).refs.map((r) => `${r.id}=${r.label}`);
  assert.deepEqual(ids('  A1("A1 x") --> B[[B y]] --> C{"C z"}'), ['A1=A1 x', "B=B y", 'C=C z']);
  assert.equal(parseChartLine("  A --> B --> C").edges.length, 2);
  assert.equal(parseChartLine("  A & B --> C").edges.length, 2);
  assert.deepEqual(parseChartLine("  A -- waits --> B").edges.length, 1);
  assert.deepEqual(parseChartLine('  A -->|"text"| B:::done').refs.map((r) => r.id), ["A", "B"]);
  assert.deepEqual(parseChartLine("  A -.-> B").edges.length, 1);
  assert.equal(parseChartLine("  style I36 fill:#cfc").other, true);
  assert.equal(parseChartLine("  A --> B oops").rest, "oops");
  const r = parseChartLine('  O3["O3–O4 owner：建桶"] --> A4').refs[0];
  assert.equal(r.shape, '["');
  assert.equal('  O3["O3–O4 owner：建桶"] --> A4'.slice(r.labelStart, r.labelEnd), "O3–O4 owner：建桶");
});

/** One broken variant of the example and the finding that it must give. */
const BROKEN: [string, [string, string][], "problem" | "question", RegExp][] = [
  ["a node with no section", [["## A6 agent：导出一份测试数据 ⬜", "## A6x"]], "problem", /the node A6 has no "## " section/],
  ["a section with no node", [["## E1 外部事件：商店审核通过 ⬜", "## E1 外部事件：商店审核通过 ⬜\n\n## Notes\n"]], "problem", /the section "## Notes" is not a node of the chart/],
  ["a heading that is not the label", [["## A4 agent：文件传到桶 ⬜", "## A4 agent：上传 ⬜"]], "problem", /the heading of A4 is not its chart label "A4 agent：文件传到桶"/],
  ["a heading with no mark", [["## A4 agent：文件传到桶 ⬜", "## A4 agent：文件传到桶"]], "problem", /the heading of A4 has no ✅ or ⬜ at its end/],
  ["✅ on the label only", [['A6["A6 agent：导出一份测试数据"]', 'A6["A6 agent：导出一份测试数据 ✅"]']], "problem", /the label of A6 has ✅, and its heading has no ✅/],
  ["✅ on the heading only", [["## A6 agent：导出一份测试数据 ⬜", "## A6 agent：导出一份测试数据 ✅"]], "problem", /the label of A6 has no ✅, and its heading has ✅/],
  ["an open item under ✅", [["## O1 owner：spec review ✅\n", "## O1 owner：spec review ✅\n\n- [ ] one more\n"]], "problem", /a "- \[ \]" under a ✅ heading: - \[ \] one more/],
  ["two nodes with one code", [['  E1["E1 外部事件：商店审核通过"] --> A5', '  E1["E1 外部事件：商店审核通过"] --> A5\n  X6["A6 agent：again"] --> A5']], "problem", /two nodes have the code A6: A6, X6/],
  ["a label with no code", [['A6["A6 agent：导出一份测试数据"]', 'A6["agent：导出一份测试数据"]']], "problem", /the label of A6 does not start with its code/],
  ["a node before its label", [["  O1 --> A2[", "  A3 --> O2\n  O1 --> A2["]], "problem", /A3 comes before its label in this chart/],
  ["two arrows on a line", [["  A2 --> O2\n", "  A1 --> A2 --> O2\n"]], "problem", /the chart line has 2 arrows: write one arrow on each line/],
  ["an arrow to an unknown id", [["  A4 --> O5\n", "  A4 --> O5\n  A4 --> Z9\n"]], "problem", /the chart names Z9, which has no label in a chart/],
  ["a cycle", [["  A4 --> O5\n", "  A4 --> O5\n  A5 --> A3\n"]], "problem", /the chart has a cycle: /],
  ["a struck open item", [["- [ ] 跑 `make export`", "- [ ] ~~跑 `make export`~~"]], "problem", /a struck item has "- \[ \]"/],
  ["an M node in the plan of an issue", [["  A4 --> O5\n", '  A4 --> O5\n  A5 --> M1["M1 发布"]\n'], ["## A5 agent：打开线上的开关 ⬜", "## M1 发布 ⬜\n\n## A5 agent：打开线上的开关 ⬜"]], "problem", /M1: the plan of an issue has no M node/],
  ["an item code used two times", [["- [ ] **A4.1 上传**", "- [ ] **A4.1 上传**\n- [ ] **A4.1 again**"]], "problem", /the item A4.1 is in the plan two times/],
  ["no chart", [["```mermaid\nflowchart TB", "```text\nflowchart TB"]], "problem", /the plan has no mermaid chart before its first ## section/],
  ["a ⬜ heading with each item checked", [["- [ ] 跑 `make export`", "- [x] 跑 `make export`"]], "question", /the heading has ⬜ and each of its 1 item\(s\) is "- \[x\]": done\?/],
  ["a section after the node that waits on it", [["## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑 `make export`，数文件的行数。过：和库里的行数一样。\n\n", ""], ["## E1 外部事件", "## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑 `make export`，数文件的行数。过：和库里的行数一样。\n\n## E1 外部事件"], ["  A4 --> O5\n", "  A4 --> O5\n  A6 --> A4\n"]], "question", /the section of A6 comes after the section of A4, which waits on it: put A6 first/],
  ["a D with no example", [["例子：选 CSV", "选 CSV"]], "question", /the ⬜ D node D2 has no 例子 \(Example\) part/],
  ["a D whose first option is not the recommended one", [["- **推荐：CSV。**", "- **CSV。**"]], "question", /the first option of D2 is not the recommended one/],
  ["a gap in the codes", [['A3 --> A6["A6 agent', 'A3 --> A7["A7 agent'], ["## A6 agent", "## A7 agent"]], "question", /the A codes skip A6/],
  ["a label that does not name who", [['D2["D2 owner 拍板：文件格式"]', 'D2["D2 文件格式"]'], ["## D2 owner 拍板：文件格式 ⬜", "## D2 文件格式 ⬜"]], "question", /the label of D2 does not name who does it: 「D2 owner 拍板：…」/],
  ["a ✅ node that is not compressed", [["- [x] 做完的节点压成一两行（日期、commit）。", "- [x] one `abc1234`\n- [x] two\n- [x] three"]], "question", /the ✅ node A1 has 3 lines: compress it/],
  ["a ✅ node that waits on an open node", [["## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑", "## A6 agent：导出一份测试数据 ✅\n\n- [x] 跑"], ['A6["A6 agent：导出一份测试数据"]', 'A6["A6 agent：导出一份测试数据 ✅"]']], "question", /A6 is ✅, and A3, which it waits on, is not/],
  ["another shape in a plan", [['A6["A6 agent：导出一份测试数据"]', 'A6("A6 agent：导出一份测试数据")']], "question", /A6 is not in the form ID\["text"\]/],
];

for (const [name, pairs, kind, re] of BROKEN)
  test(`a broken plan: ${name} is a ${kind}`, () => {
    const f = check(patch(EXAMPLE, ...pairs));
    assert.ok(
      f.some((x) => x.kind === kind && re.test(x.text)),
      `no ${kind} ${re}; got:\n${texts(f).join("\n")}`,
    );
    if (kind === "question") assert.deepEqual(texts(problems(f)), [], "a question only");
  });

test("a milestone plan: each open node has a path to a release O or an M; the plan of an issue does not need one", () => {
  const MILESTONE = "knowledge/plan/alpha.md";
  const plan = (extra: string) =>
    [
      "# alpha plan",
      "",
      "> **更新 2026-10-22**",
      "",
      "```mermaid",
      "flowchart TB",
      '  A1["A1 agent：一"] --> O1["O1 owner：发版"]',
      '  A2["A2 agent：二"]',
      extra,
      "```",
      "",
      "## A1 agent：一 ⬜",
      "",
      "## A2 agent：二 ⬜",
      "",
      "## O1 owner：发版 ⬜",
      "",
    ].join("\n");
  const loose = checkPlan(parsePlan(plan(""), MILESTONE), plan(""));
  assert.deepEqual(texts(problems(loose)), [
    `${MILESTONE}:8 A2 has no path to a release O or an M node: draw an arrow to the next open node of the critical path, or ask a D (future work or out of scope)`,
  ]);
  const linked = plan("  A2 --> A1");
  assert.deepEqual(problems(checkPlan(parsePlan(linked, MILESTONE), linked)), []);
  assert.deepEqual(problems(checkPlan(parsePlan(plan(""), "knowledge/plan/9-x.md"), plan(""))), [], "the plan of an issue: A2 blocks the wrap-up");
});

test("index.md: the Now: line, the ✅ of the table and the label, the form ID[\"text\"]", () => {
  const FILE = "knowledge/plan/index.md";
  const idx = (text: string) => checkPlan(parsePlan(text, FILE), text);
  const p = parsePlan(INDEX, FILE);
  assert.equal(p.kind, "index");
  assert.equal(p.now, "#44 A1: the agent can do it now. #45 waits on E1.");
  assert.deepEqual(
    p.nodes.map((n) => `${n.code}:${n.kind}:${n.done ? "✅" : "⬜"}`),
    ["REL:X:✅", "I43:I:⬜", "I52:I:✅", "I53:I:⬜", "I44:I:⬜", "I36:I:✅", "I45:I:⬜", "E1:E:⬜", "alphaO15:X:⬜"],
  );
  assert.deepEqual(idx(INDEX), []);
  assert.deepEqual(texts(idx(INDEX.replace("> **Now:** #44 A1: the agent can do it now. #45 waits on E1.\n", ""))), [`${FILE}:1 the graph has no "Now:" line`]);
  assert.deepEqual(texts(idx(INDEX.replace("| #43 | Live runs", "| #43 ✅ | Live runs"))), [`${FILE}:21 the label of I43 has no ✅, and the first cell of its row has ✅`]);
  assert.deepEqual(texts(idx(INDEX.replace("| #43 | Live runs | The agent | — |\n", ""))), [`${FILE}:8 the open issue #43 has no row in the table`]);
  assert.deepEqual(texts(idx(INDEX.replace("> **Now:** #44", "> **Now:** #36"))), [`${FILE}:3 "Now:" names #36, which is ✅`]);
  assert.deepEqual(texts(idx(INDEX.replace('E1["E: an outside event"]', 'E1("E: an outside event")'))), [`${FILE}:12 E1 is not in the form ID["text"]`]);
  assert.deepEqual(texts(idx(INDEX.replace('  E1["E: an outside event"] --> I45', '  E1["E: an outside event"] --> I45 --> I43'))), [`${FILE}:12 the chart line has 2 arrows: write one arrow on each line`]);
});

test("transitions: a ✅ node is not removed, un-ticked, renamed or rewritten; an open node is struck, not removed; codes are not used again", () => {
  const before = parsePlan(EXAMPLE, ISSUE);
  const after = (...pairs: [string, string][]) => texts(checkTransition(before, parsePlan(patch(EXAMPLE, ...pairs), ISSUE)));
  assert.deepEqual(after(), []);
  assert.deepEqual(after(["## A1 agent：调研导出格式 ✅", "## A1 agent：调研导出格式 ⬜"], ["调研导出格式 ✅\"]", "调研导出格式\"]"]), [`${ISSUE}:30 the ✅ node A1 lost its ✅`]);
  assert.deepEqual(after(["## A1 agent：调研导出格式 ✅", "## A1 agent：调研 ✅"], ["调研导出格式 ✅\"]", "调研 ✅\"]"]), [`${ISSUE}:9 the ✅ node A1 has a new label: "A1 agent：调研导出格式" → "A1 agent：调研"`]);
  assert.deepEqual(after(["- [x] 做完的节点压成一两行（日期、commit）。", "- [x] 另一行。"]), [`${ISSUE}:30 the section of the ✅ node A1 changed: a ✅ node does not change`]);
  assert.deepEqual(after(["## A1 agent：调研导出格式 ✅\n\n- [x] 做完的节点压成一两行（日期、commit）。\n\n", ""], ['A1["A1 agent：调研导出格式 ✅"] --> O1["O1 owner：spec review ✅"]', 'O1["O1 owner：spec review ✅"]']), [
    `${ISSUE}:1 the ✅ node A1 is removed: a ✅ node stays`,
    `${ISSUE}:9 the arrow A1 --> O1 into the ✅ node O1 is removed`,
  ]);
  assert.deepEqual(after(["## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑 `make export`，数文件的行数。过：和库里的行数一样。\n\n", ""], ['  A3 --> A6["A6 agent：导出一份测试数据"]\n', ""]), [
    `${ISSUE}:1 the node A6 is removed: strike it through (plan.ts drop), do not remove it`,
  ]);
  assert.deepEqual(after(["  A4 --> O5\n", "  A4 --> O5\n  A6 --> O1\n"]), [`${ISSUE}:21 the new arrow A6 --> O1 goes into the ✅ node O1`]);
  assert.deepEqual(after(["- [x] **A3.1 <一件事>**", "- [ ] **A3.1 <一件事>**"]), [`${ISSUE}:68 the item A3.1 went back from "- [x]" to "- [ ]"`]);
  assert.deepEqual(
    after(["## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑 `make export`，数文件的行数。过：和库里的行数一样。", "## A6 agent：导出一份测试数据 ✅\n\n- [x] 跑通（2026-10-22，`abc1234`）"], ['A6["A6 agent：导出一份测试数据"]', 'A6["A6 agent：导出一份测试数据 ✅"]']),
    [],
    "the commit that ticks a node may compress its section",
  );
  // A new node takes the next code: a gap below the highest code is not used.
  const gap = patch(EXAMPLE, ['  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n'], ["## A6 ", "## A6 "]);
  const without = parsePlan(gap.replaceAll("A6", "A8"), ISSUE);
  const reused = parsePlan(gap.replaceAll("A6", "A8").replace('  E1["E1 外部事件：商店审核通过"] --> A5\n', '  E1["E1 外部事件：商店审核通过"] --> A5\n  A3 --> A7["A7 agent：新的"]\n').concat("\n## A7 agent：新的 ⬜\n"), ISSUE);
  assert.deepEqual(texts(checkTransition(without, reused)), [`${ISSUE}:22 the new node A7 uses a code at or below A8: a code is not used again; take A9`]);
  // A struck node stays struck.
  const struck = patch(EXAMPLE, ["## A6 agent：导出一份测试数据 ⬜\n\n- [ ] 跑", "## A6 agent：导出一份测试数据 ✅\n\n- [x] ~~**A6 agent：导出一份测试数据**~~ 不用做了（2026-10-22）：理由\n- [x] ~~跑"], ["和库里的行数一样。\n", "和库里的行数一样。~~\n"], ['A6["A6 agent：导出一份测试数据"]', 'A6["A6 agent：导出一份测试数据 ✅"]']);
  assert.equal(parsePlan(struck, ISSUE).nodes.find((n) => n.code === "A6")!.dropped, true);
  assert.deepEqual(texts(checkTransition(before, parsePlan(struck, ISSUE))), []);
});

test("transitions of index.md: a ✅ node leaves at the release; an open node does not leave; a ✅ does not go back", () => {
  const FILE = "knowledge/plan/index.md";
  const before = parsePlan(INDEX, FILE);
  const t = (text: string) => texts(checkTransition(before, parsePlan(text, FILE)));
  assert.deepEqual(t(INDEX.replace('  I52["#52 release step：agent ✅"] --> I53["#53 next thing：agent"]', '  I53["#53 next thing：agent"]')), []);
  assert.deepEqual(t(INDEX.replace('  REL --> I43["#43 live runs：agent"]\n', "")), [`${FILE}:1 the node I43 is removed: strike it through (plan.ts drop), do not remove it`]);
  assert.deepEqual(t(INDEX.replace("issue life：agent ✅", "issue life：agent")), [`${FILE}:10 the ✅ node I36 lost its ✅`]);
});

// ---------- groups: proposals and issues in a milestone plan ----------

const ALPHA = fixture("alpha.txt");
const MS = "knowledge/plan/alpha.md";
const ms = (text: string) => checkPlan(parsePlan(text, MS), text);

test("groups: a proposal P<k>, an issue I<N> with its %% P<k>, a kept code %% P<k>, and the group of each node", () => {
  const p = parsePlan(ALPHA, MS);
  assert.deepEqual(p.groups, [
    { code: "I7", kind: "issue", title: "调研格式", issue: 7, nodes: ["A2"], line: 8, endLine: 11, from: "P1" },
    { code: "P2", kind: "proposal", title: "导出和上传", issue: null, nodes: ["A3", "A4"], line: 12, endLine: 15, from: null },
    { code: "P4", kind: "proposal", title: "测试数据", issue: null, nodes: ["A5"], line: 17, endLine: 19, from: null },
  ]);
  assert.deepEqual(p.retired, ["P3"]);
  assert.deepEqual(
    p.nodes.map((n) => `${n.code}:${n.group}`),
    ["O1:null", "A1:null", "A2:I7", "A3:P2", "A4:P2", "A5:P4", "D1:null", "O2:null"],
  );
  assert.deepEqual(ms(ALPHA), []);
  assert.deepEqual(parsePlan(EXAMPLE, ISSUE).groups, []);
});

const GROUP_BROKEN: [string, string, [string, string][], "problem" | "question", RegExp][] = [
  ["a group in the plan of an issue", "knowledge/plan/9-x.md", [], "problem", /the group I7 is in a plan that is not the plan of a milestone/],
  ["a node in two groups", MS, [["  %% P3\n", "  %% P3\n  subgraph P5[\"P5 proposal：again\"]\n    A3\n  end\n"]], "problem", /A3 is in two groups: P2 and P5/],
  ["nested groups", MS, [["    A4[\"A4 agent：文件传到桶\"]\n  end\n", "    subgraph P5[\"P5 proposal：in\"]\n      A4[\"A4 agent：文件传到桶\"]\n    end\n  end\n"]], "problem", /the group P5 is inside another group/],
  ["a group with no node", MS, [["  %% P3\n", "  subgraph P3[\"P3 proposal：empty\"]\n  end\n"]], "problem", /the group P3 has no node/],
  ["a D node in a group", MS, [["  %% P3\n", "  %% P3\n  subgraph P5[\"P5 proposal：d\"]\n    D1[\"D1 owner 拍板：桶在哪\"]\n  end\n"], ['  D1["D1 owner 拍板：桶在哪"] --> A4', "  D1 --> A4"]], "problem", /D1 is in the group P5: only A nodes go into an issue/],
  ["an issue member with no #N in its label", MS, [['A2["A2 agent：调研格式 #7"]', 'A2["A2 agent：调研格式"]'], ["## A2 agent：调研格式 #7 ⬜", "## A2 agent：调研格式 ⬜"]], "problem", /A2 is in the issue group I7: its label and its heading carry #7/],
  ["a node with #N outside its issue group", MS, [['A5["A5 agent：导出一份测试数据"]', 'A5["A5 agent：导出一份测试数据 #9"]'], ["## A5 agent：导出一份测试数据 ⬜", "## A5 agent：导出一份测试数据 #9 ⬜"]], "problem", /A5 carries #9 and is not in the group I9/],
  ["a proposal label not in the form", MS, [['subgraph P2["P2 proposal：导出和上传"]', 'subgraph P2["导出和上传"]']], "problem", /the group P2 is not in the form P2\["P2 proposal：<title>"\]/],
  ["a proposal code used two times", MS, [["  %% P3\n", "  %% P2\n"]], "problem", /the proposal code P2 is used two times/],
  ["an open A node in no group", MS, [['  subgraph P4["P4 proposal：测试数据"]\n    A5["A5 agent：导出一份测试数据"]\n  end\n', '  A5["A5 agent：导出一份测试数据"]\n  %% P4\n']], "question", /the open A node A5 is in no group/],
  ["a gap in the P codes", MS, [["  %% P3\n", ""]], "question", /the P codes skip P3/],
  ["an arrow inside a group", MS, [['    A4["A4 agent：文件传到桶"]\n', '    A4["A4 agent：文件传到桶"]\n    A3 --> A4\n']], "question", /an arrow inside the group P2/],
];

for (const [name, file, pairs, kind, re] of GROUP_BROKEN)
  test(`groups: ${name} is a ${kind}`, () => {
    const text = patch(ALPHA, ...pairs);
    const f = checkPlan(parsePlan(text, file), text);
    assert.ok(
      f.some((x) => x.kind === kind && re.test(x.text)),
      `no ${kind} ${re}; got:\n${texts(f).join("\n")}`,
    );
    if (kind === "question") assert.deepEqual(texts(problems(f)), [], "a question only");
  });

test("groups in transitions: an issue group stays, a proposal code stays used, a new proposal takes the next code, a ✅ node does not move", () => {
  const before = parsePlan(ALPHA, MS);
  const t = (...pairs: [string, string][]) => texts(checkTransition(before, parsePlan(patch(ALPHA, ...pairs), MS)));
  assert.deepEqual(t(["  subgraph I7[\"#7 调研格式\"]\n    %% P1\n", "  %% P1\n"], ["    A2[\"A2 agent：调研格式 #7\"]\n  end\n", "    A2[\"A2 agent：调研格式 #7\"]\n"]), [`${MS}:1 the issue group I7 is removed: an issue group stays`]);
  assert.deepEqual(t(["  %% P3\n", ""]), [`${MS}:1 the proposal code P3 is gone: a removed or opened proposal keeps a line %% P3`]);
  assert.deepEqual(t(["  subgraph P4[\"P4 proposal：测试数据\"]", "  subgraph P3[\"P3 proposal：测试数据\"]"]), [`${MS}:1 the proposal code P4 is gone: a removed or opened proposal keeps a line %% P4`]);
  assert.deepEqual(t(['  O1["O1 owner：spec review ✅"] --> A1["A1 agent：调研 ✅"]\n', '  O1["O1 owner：spec review ✅"]\n'], ["    A5[\"A5 agent：导出一份测试数据\"]\n", "    A5[\"A5 agent：导出一份测试数据\"]\n    A1[\"A1 agent：调研 ✅\"]\n"], ["  A1 --> O2\n", "  O1 --> A1\n  A1 --> O2\n"]), [`${MS}:19 the ✅ node A1 moved into the group P4`]);
  // Open: P2 becomes I8 with %% P2; its members keep their group.
  const opened = patch(ALPHA, ['  subgraph P2["P2 proposal：导出和上传"]\n', '  subgraph I8["#8 导出和上传"]\n    %% P2\n'], ['A3["A3 agent：导出成文件"]', 'A3["A3 agent：导出成文件 #8"]'], ['A4["A4 agent：文件传到桶"]', 'A4["A4 agent：文件传到桶 #8"]'], ["## A3 agent：导出成文件 ⬜", "## A3 agent：导出成文件 #8 ⬜"], ["## A4 agent：文件传到桶 ⬜", "## A4 agent：文件传到桶 #8 ⬜"]);
  assert.deepEqual(ms(opened), []);
  assert.deepEqual(texts(checkTransition(before, parsePlan(opened, MS))), []);
});
