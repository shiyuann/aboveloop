# 规矩和 feedback 放在哪

> 来了一条 feedback 或一条设计的规矩，要定它写进哪一份时读；写、改 skill 时读；deep-verify 查「每条规矩在它要用的时候读得到吗」时读。词表在 [entry 的 SKILL.md](../../entry/SKILL.md)。为什么这样定，在 aboveloop 的 [L2-plugin §2](../../../knowledge/spec/L2-plugin.md#2-entry-the-start-for-all-rules-and-skills)。

## 1. 规矩放在哪：它什么时候要用，就放在那时读得到的文字里

一条规矩的家，不按它讲什么定，按它什么时候要用定。先看四个事实：

1. 每个会话都整页读的，只有 `entry`。
2. 一个 skill 要被它的 description 里的词叫到，才加载。
3. 一份 reference，只在一个已经加载的 skill 那时指向它，才有人读。
4. 对话里的事（owner 纠正 agent、提意见、说「记一下」、谈一个还没定的设计）在任何会话里都会发生，不带 skill 的词。修 aboveloop 本身的会话也一样。

所以：

| 规矩是什么时候用的 | 放在哪 |
| --- | --- |
| 对话里的一件事一发生就要用（feedback、设计讨论）、每个会话都要守的 | `entry` 的正文，写短 |
| 做一种活时用 | 那种活的 skill：`dev`（下一件做什么）、`builder`（issue 的流程）、`knowledge`（怎么写 `knowledge/`、让它一直是真的）、`prerelease`…… |
| 一个决定，带它的为什么 | spec |
| 只是一个项目的事 | 那个项目（它的 `AGENTS.md`、`knowledge/`、`.agents/`） |

- **副本只能是一行指针。** 别处要用，写一行链过来，不抄正文。抄的一份，原文一改就错。
- **reference 要有人在那时指过来。** 放进 reference 的规矩，要有一份那时已经加载的文字（`entry` 的正文、那种活的 skill 或它的步骤）在那一刻链到它。
- 为什么：在 aboveloop 的 [L2-plugin §2](../../../knowledge/spec/L2-plugin.md#2-entry-the-start-for-all-rules-and-skills)。

### 例子：对话里的规矩和几种活的规矩分在哪

| 内容 | 家 |
| --- | --- |
| 什么算 feedback（被纠正、不满意、对产品的意见、「记一下」、agent 自己做错）；当场记，不攒着；那一个问题（开 issue，还是小改动）；小改动的做法；还没定的设计先讨论：资深工程师的样子和讨论的四步 | `entry` 的正文（对话里一发生就要用） |
| 记在哪（项目还是 aboveloop）；先找已有的那一条；写什么 | `knowledge`：这一页的第 2、3 节（那一刻 `entry` 的「owner 说「应该怎么样」」第 2 步指过来；`builder` 的 issue-in-session.md 第 2 节、spec.md 3.2 和 `knowledge` 的 SKILL.md 也指过来） |
| owner 在环里还是环上的判据；存储按产出的人分；搬安全关卡；owner 在环上的 spec 写清的三件事 | `knowledge` 的 [spec-and-plan.md](spec-and-plan.md)「自动化的 spec」 |
| 会话里一个 issue 的流程（explore → spec → implement、交给 builder、里程碑的节点） | `builder` 的 [issue-in-session.md](../../builder/references/issue-in-session.md)；`entry` 留一行指针 |
| routine 跑在哪（Actions 叫醒、Cursor 云端 agent 干活、钥匙留在 workflow、workflow 的代码一份、结果由产生它的那一步写） | spec：aboveloop 的 [L2-loop-architecture §2](../../../knowledge/spec/L2-loop-architecture.md#2-routines)；`entry` 的任务表指过去 |
| 变成 issue 的 feedback 进队列 | `dev` |
| 写代码的取向 | `entry` |
| 发版的规矩；后台 agent 的模型 | `prerelease` 的 [release.md](../../prerelease/references/release.md)；aboveloop 的 [L3-loop-workflow §2](../../../knowledge/spec/L3-loop-workflow.md#2-the-agents) |
| 一次设计讨论的复盘 | `knowledge` 的 [case-study-design-discussion.md](case-study-design-discussion.md)，`entry` 讨论那一条链过来，不用每次读 |

### 来了一条新的 feedback 或设计的规矩：放进去

1. 问：它什么时候要用？对话里一件事发生时、做一种活时，还是定一个决定时？只是一个项目的事吗？
2. 照上面的表定家。拿不准是不是对话里的事：放进 `entry` 的正文，写短。
3. 先找已有的那一条（第 2 节）。有，就改那一条，不另加。
4. 家是一份 reference：确认那一刻已经加载的文字里有一行链到它。没有，就加那一行。
5. 别处要用：只写一行指针。

## 2. feedback 记在哪

判据：换一个项目，这件事还会不会发生？

| feedback 说的事 | 记在哪 |
| --- | --- |
| 这个产品、这个仓库的事：画面、数据、这个仓库踩过的坑 | 这个项目的 spec、issue 和 plan。项目的规矩记进它的 `AGENTS.md` |
| agent 怎么干活，换个项目也会发生：写法、什么时候问、工程取向 | aboveloop 的规矩：`skills/` 里的 skill（从 `entry` 起）和它们的 references，放进第 1 节定的那一份。issue 开在 aboveloop |

分不清，就记在项目里。把项目的事放进 aboveloop，会影响别的项目。反过来，只是少共享一次。

**先找已有的那一条。** spec 或规矩里已经写了同一件事，就改那一条，不另加一条。plan 里已经有这件活，就改那个节点。开着的 issue 已经是这件事：不开新的，把 owner 的原话写成那个 issue 的一条评论，告诉 owner issue 号。评论的条数，就是 owner 说过几次。

## 3. 写什么

- **spec 和规矩写应该的样子，和为什么。** 「owner 说提交带了无关的文件」没用。「agent 为了凑一个干净的 commit 去改工作区；约定只说了『只带本轮改动』，没说不许 stash」才有用。由此写出的规矩是：不用 stash 挪走无关的改动。
- **owner 的原话，只在它就是理由时写进来。** 写上日期。
- **plan 的节点写做什么、怎样算过**（[spec-and-plan.md](spec-and-plan.md) 的「plan 怎么写」）。
- **agent 自己发现的毛病，owner 没说过应该怎样：** 写成 plan 里的 owner 拍板（D），给推荐。不自己定下来写进 spec。
