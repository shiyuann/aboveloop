# feedback：当场改 spec 和 plan

> owner 在会话里纠正 agent、对产品提意见、或说「记一下」时读。词表在 [SKILL.md](../SKILL.md)。

做错了，要留下记录。不留，同一个错会一直犯。

会话里听到的 feedback，当场记下，不另记文件，不攒着以后消化。应该的样子最后写进 spec，要做的活写进 plan；在那之前，它记在 issue 里。记在哪，照这几条（[SKILL.md](../SKILL.md) 的「owner 说『应该怎么样』」）：

- 和手上这个 issue 有关：写进它的分支上的 spec 和 plan。
- 小改动（错字、链接、规矩里的一段）：问一句，开一个分支和一个 PR，检查过了 agent 当场 merge（[SKILL.md](../SKILL.md) 的同名一节第 2 步）。
- 别的：问 owner 开不开 issue。开了，照 SKILL.md 的步骤走。

## 什么时候记

- owner 纠正 agent（「不对，应该……」「你又……」「为什么总是……」）。
- owner 明显不满意结果。
- agent 自己发现做错了。不等 owner 开口。
- owner 对产品提意见：画面、数据、想要的功能。
- owner 说「记一下」「下次注意」。

当场记。不留到「等下一起整理」，那样会丢。

## 记在哪

判据：换一个项目，这件事还会不会发生？

| feedback 说的事 | 记在哪 |
| --- | --- |
| 这个产品、这个仓库的事：画面、数据、这个仓库踩过的坑 | 这个项目的 spec、issue 和 plan。项目的规矩记进它的 `AGENTS.md` |
| agent 怎么干活，换个项目也会发生：写法、什么时候问、工程取向 | aboveloop 的规矩：`entry` 和它的 references。issue 开在 aboveloop |

分不清，就记在项目里。把项目的事放进 aboveloop，会影响别的项目。反过来，只是少共享一次。

**先找已有的那一条。** spec 或规矩里已经写了同一件事，就改那一条，不另加一条。plan 里已经有这件活，就改那个节点。

## 写什么

- **spec 和规矩写应该的样子，和为什么。** 「owner 说提交带了无关的文件」没用。「agent 为了凑一个干净的 commit 去改工作区；约定只说了『只带本轮改动』，没说不许 stash」才有用。由此写出的规矩是：不用 stash 挪走无关的改动。
- **owner 的原话，只在它就是理由时写进来。** 写上日期。
- **plan 的节点写做什么、怎样算过**（`knowledge` 的 [spec-and-plan.md](../../knowledge/references/spec-and-plan.md) 的「plan 怎么写」）。
- **agent 自己发现的毛病，owner 没说过应该怎样：** 写成 plan 里的 owner 拍板（D），给推荐。不自己定下来写进 spec。

## 之后

- 照 `builder` 的 [spec.md](../../builder/references/spec.md) 走完 spec 那一步（重的：到最后一次 spec review；轻的：短 plan），agent 才写代码。
- issue 照 [issue-template.md](issue-template.md) 开。owner 说「交给 builder」，照 `builder` 的 [implement.md](../../builder/references/implement.md) 第 9 节的「交给 builder」。owner 没说，就不打 `ready-for-auto-builder`。
- 改规矩也走 issue 的分支和 PR。小改动走自己的分支和 PR，agent 当场 merge。aboveloop 的规矩 merge 以后，下一版才到 owner 的会话里：告诉 owner，不替 owner 发版。
