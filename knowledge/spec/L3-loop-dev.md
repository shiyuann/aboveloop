# Dev loop: how the session entry, the rank and the graph work

> The formats of the dev loop: where the facts and the rank of the session entry are written, the format of the graph of open work that `prerelease` reads, the project configuration `.agents/dev.md` (§3), and the plan scripts of `knowledge` that parse, examine and change the plans (§4). The session entry, the graph, the project configuration and the plan scripts are built.

Marks: ✅ built · 🔶 partly built · ⬜ not built.

## Summary

- **This page describes the formats of the dev loop.** The session entry of `dev` reads the facts with `gh` and `git`, and ranks them by the rules in words of `dev`'s `SKILL.md` (§1).
- **The steps of the session entry are only in the skill `dev`:** `references/session.md` (the facts, the three scans, the review record, the graph, the top 5, one item at a time, what it writes). The decisions and their Why are in [L2-loop-dev](L2-loop-dev.md) §3 and §4. Why one home: [L2-plugin §2](L2-plugin.md#2-entry-the-start-for-all-rules-and-skills).
- **What waits, the states of an issue, the next node of a plan and the rank are written once, in `dev`'s `SKILL.md`** (§1.1, §1.2).
- **Two formats:** the graph of open work, whose ✅ marks `prerelease`'s `cleanup.ts` reads (§2), and the project configuration `.agents/dev.md`, which the session entry reads (§3).
- **The plan scripts** (§4): one parser of the plans in `knowledge/plan/`, the rules of `knowledge`'s `spec-and-plan.md` that a script can decide, the edits of the graph parts, and the hook that examines each change of a plan.
- The briefing is a design that aboveloop does not implement ([L2-loop-dev §2](L2-loop-dev.md#2-the-briefing)).

Terms: [L2-loop-dev §0](L2-loop-dev.md#0-terms), [L2-loops §0](L2-loops.md#0-terms).

## 1. The session entry

The steps of the session entry are in `dev`'s `references/session.md`. This section says where its rules are.

### 1.1 The facts

- The session entry reads the facts with `gh` and `git` directly, and only reads. The commands are in `session.md` §1.
- What waits, the states of an issue and the next node of a plan are written once, in `dev`'s `SKILL.md` (「在等什么」, 「issue 的状态」, 「plan 的节点」), in one place (P3). Why one copy, in the skill: [L2-plugin §2](L2-plugin.md#2-entry-the-start-for-all-rules-and-skills).
- What the session entry reads, in addition to the open issues and PRs:
  - `.agents/dev.md` on the default branch of the repo (§3);
  - the comments of each open issue, for the newest comment and the newest Explore comment (the size of the issue, §1.2);
  - the labels of the open issues, for the urgent labels of §3.
- A read that failed is not "nothing": the first line to the owner names it. If `gh` cannot read the repo, the agent stops and names what it cannot read. It does not rank from memory.

### 1.2 The rank

- The session entry ranks the items from the facts only, not from the graph.
- The rules of the rank, in words, are written once, in `dev`'s `SKILL.md` (「排序」): a push that the owner did not make first, then the groups `urgent`, `started` and `issues`, the order in a group, the size of an issue, the tie, and what is not in the rank.
- A project can change the rank in its `.agents/dev.md` (§3). The reasons are in [L2-loop-dev §3](L2-loop-dev.md#3-the-session-entry).

## 2. The graph of open work

The graph is the file `knowledge/plan/index.md` on `main`. How a session writes it is in `dev`'s `session.md` §3 and `knowledge`'s `spec-and-plan.md` (「依赖图 `plan/index.md`」). Why: [L2-loop-dev §4](L2-loop-dev.md#4-the-graph-of-open-work). This section holds the format that `prerelease`'s `cleanup.ts` reads.

- **The chart** is one mermaid `flowchart`. Each node has the form `ID["text"]`. A line holds one arrow only.
- **The ✅ marks** (L2-loop-dev §4) are in two places only, and `cleanup.ts` reads only these:
  - in the chart, a node label that ends with ` ✅`, for example `I<N>["#<N> the release step ✅"]`;
  - in the table, a first cell that ends with ` ✅`, for example `| #<N> ✅ | … |`.
  - A ✅ in the middle of a label, or in a note, does not count.
- `cleanup.ts` reads the chart lines with the parser of §4 (`chartMask`, `parseChartLine`), so it finds a node in each mermaid shape.
- At a release, `cleanup.ts` removes each ✅ node, each line of the chart that names it, and each ✅ row (the decision: [L2-release §2.8](L2-release.md#28-a-release-removes-finished-plans-and-deep-verify-reports-)). When a line goes, each node on it that stays and has its only label on that line keeps the label, on a line of its own. A line with more than one arrow goes whole, with a warning.

## 3. The project configuration `.agents/dev.md`

A project can change the rank of §1.2 in its `.agents/dev.md`. The name follows the convention of the project configurations ([L2-plugin §4](L2-plugin.md#4-what-is-in-the-repo)). The reasons of the rank are in [L2-loop-dev §3](L2-loop-dev.md#3-the-session-entry).

- **The file** is `.agents/dev.md` on the default branch of the project, in English, in ASD-STE100. The session entry reads it for the repo, by the rules of `dev`'s `SKILL.md`. With no file, or with no section `## Rank`, the default rank applies (`dev`'s `SKILL.md`, 「排序」). Its one section, `## Rank`, is optional.
- **The section `## Rank`** has up to three subsections. Each subsection is a list, with one value in backticks on each line. A subsection that is not there keeps its default.

| Subsection | Values | Default |
| --- | --- | --- |
| `### Urgent` | Labels. An open issue or PR with one of them is urgent, and so are the PRs linked to such an issue and its other started work. | None |
| `### Order` | The three groups `urgent`, `started` and `issues`, each one time, in the order of the rank. | `urgent`, `started`, `issues` |
| `### Size` | Labels, from small to large. An issue with one of them has the size of the first one in the list that it has. An issue with none of them comes after them, by the size of its Explore comment. | No list: the size of the Explore comment |

- **A project cannot change these:** a push that the owner did not make stays first, and a failed run of `loop.yml` stays in the group `urgent`; the project's `### Order` places that group. The kinds in each group, their order in a group, and the tie (the oldest first) stay as in `dev`'s `SKILL.md` (「排序」).
  - Agent decided: because P2 counts on the owner to find a push that the owner did not make, and a failed run stops the loops of the repo. A file in a project must not hide them.
- **A file that the agent cannot parse** (a subsection that is not one of the three, a value of `### Order` that is not a group, a group two times or not there, an empty list) gives one line in the first line to the owner (what it could not read), and the default rank applies to that repo.
  - Agent decided: the line shows the owner the broken file in the next session; a rank that uses half of the file would hide the error.
- An example, with a label `Kind: incident` that the project uses:

```markdown
# dev: <project>

## Rank

### Urgent

- `Kind: incident`

### Order

- `urgent`
- `started`
- `issues`
```

- Agent decided: the values of `### Urgent` and `### Size` are labels. The session entry already reads the labels of each issue and PR, and the projects already use labels for facts (`Kind:`). A label is a fact that a person or a loop sets; the text of an issue is not, and text from outside can ask to come first (R23).
- Agent decided: a project writes `.agents/dev.md` only when it wants another rank. With no file, the default rank applies, and a file with the default values is a second copy of the default (P3).

## 4. The plan scripts

Three scripts of `knowledge` read and change the plans in `knowledge/plan/`: the graph of open work (`index.md`), the plan of an issue (`<N>-<words>.md`) and the plan of a milestone (`<name>.md`). The steps for agents are in `knowledge`'s `references/spec-and-plan.md` (「图的部分用 `plan.ts` 改」). The decision of the hook and its Why are in [L2-plugin §2](L2-plugin.md#2-entry-the-start-for-all-rules-and-skills).

| Script | What it does |
| --- | --- |
| `plan-graph.ts` | The parser (`parsePlan`) and the rules (`checkPlan`, `checkTransition`). It reads no file and starts no process: text in, objects out. |
| `plan.ts` | The command: `check`, `json`, and the edits `add`, `arrow`, `unarrow`, `done`, `item`, `drop`, `answer`, `now`. Each edit is also a function (text in, text out) that the tests call. |
| `plan-hook.mjs` | The `PostToolUse` hook of the plugin: after an `Edit`, `Write` or `MultiEdit` of a file under `knowledge/plan/`, it runs `plan.ts check <file> --against HEAD --new`. |

- `knowledge-check.ts` runs `checkPlan` on each file in `knowledge/plan/`. `prerelease`'s `cleanup.ts` uses the same parser (§2). `prerelease`'s `markdown.mjs` is the one parser of fenced code; `links.mjs` and `plan-graph.ts` import it.
- The tests of the scripts use the example of `spec-and-plan.md` (「例子」) as the valid plan. A test builds the example from that page again and compares it with the fixture, so the two cannot drift.

### 4.1 The parse

- **The kind of a file** comes from its name: `index.md`, a name that starts with a number, or another name.
- **A chart of the plan** is a mermaid block before the first `##` heading. A plan can have two (the done chart and the open chart). A mermaid block inside a `##` section is the small chart of that node. Its nodes are `###` subsections, not nodes of the plan.
- **A node** is a mermaid id with a label, in each shape of mermaid (`ID["text"]`, `ID("text")`, `ID{"text"}`, `ID[text]`, …). Its code is the first word of the label (`A3`, `O3–O4`) in the plan of an issue or a milestone, and the id (`I42`, `alphaO15`) in `index.md`. The kind is the letter: A, D, O, E, M; I for `I<N>` in `index.md`; X for each other code. The first labelled line gives the label. A label that ends with ` ✅` is done.
- **An arrow** goes from the code of one node to the code of another. A chain (`A --> B --> C`) and `&` give more than one arrow on a line.
- **A section** is a `##` heading outside fenced code, with its lines up to the next `#` or `##` heading. Its code is the first word of its title. Its mark is the last sign of the title: a ✅ or a ⬜. In a plan with sections, a node is done when its heading has ✅.
- **An item** is a list line with `[ ]` or `[x]`. Its id is the bold code at its start (`**A3.2 …**`). A struck item starts with `~~`. A node is struck when its heading or label has `~~`, when each top item is struck, or when its first item is the struck line of the node (`- [x] ~~**<label>**~~ …`).
- **`Plan`** is the object of `parsePlan`, and the JSON of `plan.ts json`. A viewer reads the same JSON. Its fields: `file`, `kind`, `title`, `update` (the line `> **更新 …**` or `> **Updated …**`), `now` and `nowLine` (`index.md`), `log` (the `> - ` lines), `notes` (the text under the charts), `nodes`, `edges`, `lang` (`zh` when a label has 「：」), `charts`, `sections` (each `##` section, also one with no node), `rows` (the table of `index.md`). A node has `code`, `id`, `kind`, `label`, `done`, `dropped`, `mark`, `section`, `items`, `chartLine`, `labelLines` and `shape`. The parser does not throw on the text of a file: a part that it cannot read becomes a finding.

### 4.2 The rules

A problem makes `plan.ts check`, the knowledge check and the hook fail. A question is printed and does not make them fail. Each finding names `file:line`.

| Rule (`spec-and-plan.md`) | Kind | Files |
| --- | --- | --- |
| One arrow on a chart line | Problem | All |
| A node has its label at its first appearance in each chart | Problem | All |
| An arrow names an id with a label | Problem | All |
| One id has one label; a node drawn again has the same label and the same ✅ | Problem | All |
| No cycle | Problem | All |
| A code is on one node only | Problem | All |
| A node is in the form `ID["text"]` | Problem in `index.md` (the format of the graph); question in a plan | All |
| A chart line that the parser cannot read | Question | All |
| A chart before the first `##` section | Problem | Plans |
| Each node has a `##` section, and each `##` section is a node | Problem | Plans |
| The title of a section is the label of its node, with a ✅ or a ⬜ at its end | Problem | Plans |
| ✅ on the heading if and only if ✅ on the label | Problem | Plans |
| No `- [ ]` under a ✅ heading | Problem | Plans |
| No `- [ ] ~~…~~`: only a `- [x]` item is struck | Problem | Plans |
| A label starts with a code | Problem | Plans |
| An item id is in the plan one time | Problem | Plans |
| The node of a small chart is a `###` subsection with its label as the title | Problem | Plans |
| No M node in the plan of an issue | Problem | Issue plans |
| Each open node has a path to a release O (its label has 「发版」 or "release") or an M | Problem | Milestone plans |
| A ⬜ heading whose items are all `- [x]` | Question | Plans |
| The codes of a kind skip a number | Question | Plans |
| The id of a node is not its code (`X3["A3 …"]`) | Question | Plans |
| The label does not name who: 「agent」「owner 拍板」「owner」「外部事件」, or "Agent", "Owner decides", "Owner", "Event" | Question | Plans |
| A section comes after the section of a node that waits on it | Question | Plans |
| A ✅ node waits on a node that is not ✅ | Question | Plans |
| A ✅ node (not a D, not struck) has more than two lines, or a ✅ A node names no commit | Question | Plans |
| A ⬜ D has no 背景, 问题 or 例子 (Context, Question, Example), no list of two options, or its first option is not the recommended one | Question | Plans |
| An item id of another node (`A4.1` in the section of `A3`) | Question | Plans |
| No update line | Question | Plans |
| A `Now:` line | Problem | `index.md` |
| The label of `I<N>` starts with `#<N>`; ✅ on the label if and only if ✅ on the first cell of the row of `#<N>` | Problem | `index.md` |
| An open `I<N>` with no row; a `Now:` line that names a ✅ issue | Question | `index.md` |

### 4.3 The transition

`checkTransition(before, after)` compares two versions of one file. `plan.ts check --against <ref>` takes `before` from git. Each finding is a problem.

- A ✅ node stays: it is not removed, its ✅ stays, its label stays, and the body of its section stays. In `index.md`, a ✅ node can go: the release removes it (§2).
- An open node is not removed: it is struck (`plan.ts drop`). A struck node stays struck.
- The body of a node changes freely in the version that ticks it: that commit compresses it.
- A `- [x]` item with an id of an open node stays, and stays `- [x]`.
- An arrow into a ✅ node stays, and no new arrow goes into a ✅ node.
- A new node takes a number above each number of its kind in `before`: a code is not used again.

### 4.4 The edits

- **Each write:** `plan.ts` parses the file, applies the edit, runs `checkPlan` on the new text and `checkTransition` from the old text, and writes only when no problem is new. A finding is new when the old text does not have it (the same kind and text). A refusal or a new problem exits 1 and changes nothing.
- **An edit changes only its lines.** The other lines stay byte for byte, also the text that a person wrote.
- **What the edits write** (Chinese plan; an English plan has the English form):

| Verb | It writes |
| --- | --- |
| `add` | The line `ID["<code> <label>"]` and one line for each arrow, at the end of the last chart (before its `style` lines). A node of an arrow that this chart does not label is drawn again first, with its label. The section `## <code> <label> ⬜` goes before the first node that waits on it, else after the last node that it waits on, else at the end. Items of an A node get the codes `**A7.1**`, `**A7.2**`, … In `index.md`, the label of `I<N>` starts with `#<N>`. |
| `arrow` | The line `X --> Y` in the last chart that labels Y; X is drawn again when that chart does not label it. It refuses a cycle and an arrow into a ✅ node. |
| `unarrow` | It removes the line of the arrow. A label on that line stays, on a line of its own. It refuses an arrow into a ✅ node and a line with more than one arrow. |
| `done` | ✅ at the end of each label and of the heading, and the body ``- [x] <summary>（<date>，`<sha>`）`` (English: ``- [x] <summary> (<date>, `<sha>`)``). The summary is the text of the label after its colon, or `--summary`. An A node needs `--commit`, and the commit must be in the repo. It refuses a node with an open item, and a D. In `index.md`: ✅ on the labels and at the end of the first cell of the row. |
| `item --check` | `[x]` and `（<date>，<evidence>）` at the end of the item. It refuses an item with an open sub-item. |
| `item --add` | `- [ ] <text>` after the last item; an A node gives the next code. |
| `item --drop` | `- [x] ~~<text>~~ 不用做了（<date>）：<reason>` (English: `not needed (<date>): <reason>`), and each open sub-item struck. |
| `drop` | The first line `- [x] ~~**<label>**~~ 不用做了（<date>）：<reason>`, each open item struck, ✅ on the heading and the labels. |
| `answer` | The body `owner 定的（<date>，「<quote>」）：<option>` (English: `Owner decided (<date>, "<quote>"): <option>`), ✅ on the heading and the labels. With `--skipped`, the body stays under the first line `Agent decided (<date>)：<the recommended option>，因为这个 D 被跳过了。` |
| `now` | The text after `Now:`. With no such line, `> **Now:** <text>` under the title. |

- `--date` gives the date; the default is the date of the local clock.
- Agent decided: a struck node gets ✅ on its heading and its labels. Without it, a plan with a struck node never has each heading ✅, and the release does not remove it (§2, `planState`).

### 4.5 The hook

- `hooks/hooks.json` runs `plan-hook.mjs` with `node` after `Edit`, `Write` and `MultiEdit`. The hook reads the hook input (JSON) on stdin and takes `tool_input.file_path`, from `cwd` when it is relative.
- A Markdown file under `knowledge/plan/` that is on disk: the hook runs `plan.ts check <file> --cwd <root> --against HEAD --new`. With a problem, it writes the output to stderr and exits 2: Claude Code gives the text to the agent.
- In each other case it prints nothing and exits 0: another file, a file that is not there, input that is not JSON, no `node`, no script, a Node that does not run TypeScript, a check that does not finish in 20 seconds.
- `--new` gives only the findings that the file at `HEAD` does not have, so an old problem of a plan does not come back after each edit.

### 4.6 What the scripts do not decide

These rules of `spec-and-plan.md` stay with the agent and the deep-verify:

- Whether an arrow is a real wait, and whether a node has one role and one task.
- Whether a D is a choice of direction, and whether its parts say enough. The script finds only the parts and the order of the options.
- In the plan of an issue, whether a node with no arrow out must block the wrap-up or is work for another issue. The rules permit such a node.
- Whether the work of a ticked node is on the remote branch. `done` examines only that the commit is in the repo: the tick goes up in the same push as the work.
- Whether the release node of a plan is done (the session entry of `dev` reads the release).
- The words of an open item (who it waits on, or 「能做」), the notes under the chart, and the `Now:` text, apart from a ✅ issue.
- A reference to a node of another plan (`#<N> D2`, 「<里程碑> plan <代号>」): the knowledge check examines the ⬜ marks that name one.
