# 设计：owner 说「应该怎么样」、还没定的设计、routine

> owner 说一样东西应该怎么样、讨论还没定的设计、定一个自动的活跑在哪时读。spec 和 plan 怎么写，在 `knowledge` 的 [spec-and-plan.md](../../knowledge/references/spec-and-plan.md)。开始之前，先对照 [SKILL.md](../SKILL.md) 的「用哪个模型」。

## 词

通用的词（owner、agent、用户、spec、plan、拍板）在 [SKILL.md](../SKILL.md) 的词表里。这一页另加：

| 词 | 意思 |
| --- | --- |
| in the loop | 每一步都等 owner 批准。 |
| on the loop | owner 定规则、审永久的改动、看结果，能随时叫停，不逐步批准。 |
| routine | 一个自动跑的活：一个 skill、叫醒它的触发、跑它的平台。 |

---

# owner 说「应该怎么样」：在 issue 的分支上改 spec 和 plan

owner 在会话里说一样东西应该怎么样。agent 先照 [SKILL.md](../SKILL.md) 的同名一节，问开不开 issue。owner 说做，就照 `builder` 的 [spec.md](../../builder/references/spec.md) 做 spec 那一步：开 issue 的分支和 draft PR，在分支上改 spec 和 plan，带 owner 做 spec review。这一节只写 spec 和 plan 怎么改。spec 那一步结束了，才在同一个分支上写代码。

1. 在 `index.md` 里找要改的 spec 页。没有合适的页，就新写一页，登记进 `index.md`（[knowledge-base.md](../../knowledge/references/knowledge-base.md)）。
2. 改 spec，写应该的样子。L1、L2 的决定写「为什么」。页头加一条更新记录，写上 issue 号。
3. 还没做到的那一段，标 ⬜ 和 issue 号：「⬜ #N」。
4. 照 [knowledge-base.md](../../knowledge/references/knowledge-base.md) 的「改了一页之后」，核对下游的页。核对和跟着改的页（cascade）放进这个改动的同一个 commit，不记成节点。
5. 写这个 issue 的 plan（`knowledge` 的 [spec-and-plan.md](../../knowledge/references/spec-and-plan.md) 的「plan 怎么写」）。spec 和代码之间差的每一样，都写成一个节点或条目。
6. 在 issue 的分支上提交，信息以 `#<N>` 开头，只带自己改的文件；push。回复里说改了哪几页，链到 draft PR，写下一步（比如「下一步：deep-verify，然后 O1 spec review」）。

- 规矩本身就是 spec。改 `entry`、`knowledge` 和它们的 references，或项目 `AGENTS.md` 里的规矩，也这样做：应该怎样先写进 `knowledge/spec/`；`skills/` 里的文字到写代码时改，跟代码一起 merge。只改一段的，算小改动：一个分支、一个 PR，检查过了 agent 当场 merge（[SKILL.md](../SKILL.md) 的同名一节第 2 步）。aboveloop 的规矩 merge 以后，下一版才到 owner 的会话里：告诉 owner，不替 owner 发版。
- owner 这次说的，和一条记下的 owner 决定冲突，先问一句：改那条决定，还是只这一处例外（[knowledge-base.md](../../knowledge/references/knowledge-base.md) 的「两页说的不一样」）。
- spec 那一步结束了，照 `builder` 的 [implement.md](../../builder/references/implement.md) 写代码。带 owner 过 D、O 在 [spec.md](../../builder/references/spec.md) 最后一节。

---

# 设计还没定：先讨论

顺序：先谈清楚，再写 spec 和 plan。改代码，等最后一次 spec review 过了。

agent 是懂行、负责的资深工程师：

- agent 给判断，并说清有几成把握。
- agent 从基本概念讲起。owner 不一定知道业界最新的做法。
- 该查的，agent 自己查。agent 不等 owner 一步步带着问。

讨论时，照这几步做：

1. 不把现在的实现当定论。它可能只是原型。
2. 把几条路放进一张表，比优缺点。查做成过的系统，查被认可的人怎么说。
3. 给一条推荐和理由。不只在 owner 给的方案里挑，也不照单全收 owner 的说法。改了 owner 方案的哪里，逐条说。
4. owner 纠正时，先对齐目标。问清 owner 要什么结果，owner 的审查在哪一步有用。然后再改设计。

## 有自动化或 agent：owner 在环里还是环上

用两条判据：

- **owner 审这一步，能不能加上系统给不了的东西？** 永久的改动合不合理、新东西该不该收，要 owner 判断。逐个的数据值，owner 的依据只有 agent 的调研，审了也没用。
- **错了能不能发现、能不能退回、代价有没有上限？** 做不到的，owner 留在环里：花钱、对外发布、删除、改线上状态。

另外三条：

- **存储按产出的人分。** owner 和写代码的 agent 写的东西，进 git，走 review。机器产出的是数据，进数据存储。「影响用户」不等于「要 owner 审」。
- **搬一个安全关卡之前，先看出错的代价和已有的关卡。** 别处的「agent 提议、代码核对后执行」，防的是 agent 的产出直接到用户手里。这里前面已经有 owner 把关，就不再加一道代码关，也不为它加部件。
- **owner 在环上时，spec 写清三件事：** owner 管哪几件事；owner 看什么（通知、抽查）；owner 怎么叫停。

## routine 跑在哪：GitHub Actions 叫醒，Cursor 云端 agent 干活

每个系统在自己的 spec 里写一节 routine：哪个 skill、谁叫醒、输入、模型、要哪些能力、多少钱、连接点验到哪。例子：aboveloop 的 [L2-loop-architecture §2](../../../knowledge/spec/L2-loop-architecture.md#2-routines)。不另开一份「所有 routine」的 spec。

- **触发只用 GitHub Actions。** 定时、手动、别的服务叫醒（`workflow_dispatch`），都写进项目里的 workflow。workflow 不用模型：它先看状态，有活才开 agent。空跑不花模型的钱。
- **干活的是 Cursor 云端 agent。** workflow 经 Cursor 的 Cloud Agents API（`POST https://api.cursor.com/v1/agents`）开 agent，一件活一个。不用 Claude routine，不用 Cursor Automation。模型照 SKILL.md 的「用哪个模型」选。
- **触发只做两件事：** 指出 skill；交出输入。输入写在 prompt 里，标成不可信的数据。skill 不写平台，不写多久跑一次。agent 从状态里找活，不靠时间窗。
- **钥匙留在 workflow 里。** agent 只拿这件活用得着的那一把，经 `envVars` 给。Cursor 的 key 不给 agent。Cursor agent 自己的 GitHub token 开不了 issue（实测 403）。agent 要写 issue，workflow 就从工作循环的 GitHub App mint 一把一小时的 token，只给这件活要的权限。不用长期的个人 token。
- **workflow 的代码只有一份。** `setup-app` 照它的 reference 文件，把工作循环的 workflow 装进每个项目。代码是 aboveloop 里的 composite action。别的系统要定时跑 agent，照这个做法。
- **结果由产生它的那一步写。** 开 issue 的那一步写齐 context（[issue-template.md](issue-template.md)）。不为写结果另加一个触发。

owner 说可以写成 spec 了，就照 `knowledge` 的 [spec-and-plan.md](../../knowledge/references/spec-and-plan.md) 的「spec 怎么写」写。一次完整的讨论在 [case-study-design-discussion.md](case-study-design-discussion.md)。不用每次读。
