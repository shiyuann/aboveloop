# Dev loop: how the session entry, the rank and the graph work

> The formats of the dev loop: where the facts and the rank of the session entry are written, the format of the graph of open work that `prerelease` reads, and the project configuration `.agents/dev.md` (§3). The session entry, the graph and the project configuration are built.

Marks: ✅ built · 🔶 partly built · ⬜ not built.

## Summary

- **This page describes the formats of the dev loop.** The session entry of `dev` reads the facts with `gh` and `git`, and ranks them by the rules in words of `dev`'s `SKILL.md` (§1).
- **The steps of the session entry are only in the skill `dev`:** `references/session.md` (the facts, the three scans, the review record, the graph, the top 5, one item at a time, what it writes). The decisions and their Why are in [L2-loop-dev](L2-loop-dev.md) §3 and §4. Why one home: [L2-plugin §2](L2-plugin.md#2-entry-the-start-for-all-rules-and-skills).
- **What waits, the states of an issue, the next node of a plan and the rank are written once, in `dev`'s `SKILL.md`** (§1.1, §1.2).
- **Two formats:** the graph of open work, whose ✅ marks `prerelease`'s `cleanup.ts` reads (§2), and the project configuration `.agents/dev.md`, which the session entry reads (§3).
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

## 4. The plan viewer

✅ The plan viewer is a local web page that draws each plan of `knowledge/plan/` as a graph. It reads the plans and their git history, and it changes no file. The steps to start it are in `knowledge`'s `SKILL.md` (「看 plan 的图」).

- **The script** is `plan-view.ts` in `knowledge`'s `scripts/`. It uses only Node and `git`, with no package to install. The page is `plan-view.html` beside it, with no script or style from another site.
- **It binds to 127.0.0.1 only.** It answers only a request whose `Host` is `127.0.0.1:<port>` or `localhost:<port>`. Another `Host` gets 403.
  - Agent decided: a plan can name private work. A page of another site must not read it through a DNS name that points to 127.0.0.1.
- **The parser is the parser of the plan check** (`parsePlan`, `checkPlan` and `checkTransition` of `plan-graph.ts`). The viewer does not parse a plan itself (P3). The tests give the server a fake parser.

### 4.1 The endpoints

| Path | What it gives |
| --- | --- |
| `/` | The page. |
| `/api/plans` | Each `.md` file of `knowledge/plan/`: `file`, `kind`, `title`, `done` (the nodes that are ✅ or dropped), `open`, and `error` when the parser cannot read it. `index.md` is first, then the plans of a milestone, then the plans of an issue. |
| `/api/plan?file=<path>` | `plan` (the `Plan` of `plan-graph.ts`, unchanged), `findings` (of `checkPlan`, and of `checkTransition` from the last commit when the file has an uncommitted change; each with the `node` that its line is in), `activity` (§4.2) and `view` (§4.3). |
| `/api/events` | Server-Sent Events. First `hello`, then `changed` with `{"file": "<path>"}` when a file under `knowledge/plan/` changes on disk, and `{"file": null, "head": "<sha>"}` when `git rev-parse HEAD` changes. |

- A `file` that is not a `.md` file under `knowledge/plan/` gets 400: a path with `..`, an absolute path, another folder, or a symlink to a file outside. A plan file that is not there gets 404.
- The server waits 150 ms after the last change of a file before it sends `changed`. It reads `HEAD` each 2 seconds, and only while a page listens.

### 4.2 The activity

The activity of one plan comes from git, with no database. The server reads the last 200 commits that changed the file (`git log --follow`, across a rename), parses each version, and compares each version with the version before it. It keeps each parsed version by its blob sha. `plan-activity.ts` does the comparison, with no I/O.

| `kind` | When |
| --- | --- |
| `add` | A node is new. In the first version of the file, each node is new. |
| `done` | A node that is not a D gets ✅. |
| `answer` | A D gets ✅. `quote` holds the first quote (「…」, “…” or "…") of the line in its section that says the owner decided. When the agent decided, `quote` is null. |
| `tick` | An item is checked. |
| `drop` | A node or an item is struck through. |
| `remove` | A node goes out of the plan. |
| `arrow-add`, `arrow-remove` | An arrow between two nodes that both stay. The arrows of a new or removed node are part of that node. |
| `now` | The `Now:` line changes. |
| `log` | A `> - ` line of the plan (`Plan.log`). Its date is the date at its start. |

- Each event has `id`, `kind`, `node`, `item`, `text`, `quote`, `from`, `to`, `source` (`commit`, `uncommitted` or `log`), `sha`, `date`, `subject` and `author`.
- An item pairs with its old item by its id, then by the same text, then by its order.
- The file on disk that differs from its last commit gives the events of `source: "uncommitted"`, with the time of the file.
- The order is: the uncommitted events first, then the commits and the log lines, newest first by date. The `id` of an event stays the same over reloads, so the page knows which events are new.

### 4.3 The view

| Field | What it holds |
| --- | --- |
| `states` | The state of each node: `done` (✅), `dropped` (struck through), `ready` (能做: each node before it is done or dropped, and an agent does it), `waits` (等: each node before it is done or dropped, and it is a D, an O or an E), `blocked` (a node before it is open). |
| `critical` | The longest path of open nodes, by count, that ends at an open node with no open node after it. |
| `decisions` | Each D: its question (the line that starts with 「问题」 or "Question"), the line that names the recommended option, and, when it is ✅, who decided, the quote and the date. |

- Agent decided: `waits` names only a D, an O or an E whose turn it is, so the word keeps the meaning of [L2-loop-dev §4](L2-loop-dev.md#4-the-graph-of-open-work). A node after open work is `blocked`, not `waits`.
- The page follows the newest event: on load, and on each `changed`, it moves the view to the node of the newest new event, and makes that node pulse. A pan, a zoom or a click in a panel stops the follow. The follow button starts it again.
