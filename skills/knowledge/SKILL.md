---
name: knowledge
description: >-
  knowledge loop 的 skill：让 `<项目根>/knowledge/` 一直是真的。知识库的规矩（三层 L1、L2、L3，文件名，
  `index.md` 的依赖图，改了一页之后核对哪些页、更新记录、核对过的日期，两页说的不一样），spec 怎么写、
  plan 怎么写（节点、条目、依赖图 `plan/index.md`），deep-verify（深查 spec 和 plan，多人或单人，页头的标记），
  和知识检查的脚本 `knowledge-check.ts`。词和每次会话都守的规矩在 `entry`。
  Use when the user says 知识库, 记一下, 加进知识库, deep-verify, 深查, 核对, 核对过, spec 怎么写, plan 怎么写,
  依赖图, 更新记录, 改了一页, 两页说的不一样, knowledge check, or reads or writes `knowledge/`.
---

# knowledge

knowledge loop 的 skill（[L2-loops §2.2](../../knowledge/spec/L2-loops.md#22-the-knowledge-loop)）。它的一件活是对 `<项目根>/knowledge/` 的一次改动：一页 spec、`index.md`、一份 reference 或一份 plan。它没有自己的触发：builder loop（主要是 spec 那一步）和会话里的 dev loop 开它，发版做它的清理。

词（owner、agent、spec、plan、spec review、拍板）和每次会话都守的规矩（怎么写、ASD-STE100、拍板只问方向、用哪个模型）在 `entry` 的 [SKILL.md](../entry/SKILL.md)。本页和 `references/` 里的路径，都相对 agent 正在干活的那个项目的根，写作 `<项目根>/`。

## 先分清是不是这里的活

owner 说一样东西应该怎么样（纠正 agent、对产品提意见、说「记一下」「加进知识库」），先照 `entry` 的「owner 说『应该怎么样』」：问开 issue，还是小改动。定了以后，改 `knowledge/` 的那一步照这里做。

## knowledge loop 的四步

1. **写改动。** spec 照 [spec-and-plan.md](references/spec-and-plan.md) 的「spec 怎么写」，plan 照它的「plan 怎么写」。新的页登记进 `index.md`（[knowledge-base.md](references/knowledge-base.md)）。
2. **快：同一个 commit 里核对下游。** 照 [knowledge-base.md](references/knowledge-base.md) 的「改了一页之后」：建立在它上面的页逐页核对，改「核对过」的日期，改了意思的页写更新记录。不记成 plan 的节点。
3. **慢：deep-verify。** 重的 spec，每次 spec review 前面一个固定的 agent 节点，在后台跑，不先问 owner。照 [deep-verify-knowledge.md](references/deep-verify-knowledge.md)。
4. **清理。** 发版时 `prerelease` 删做完的 plan、它们的 deep-verify 报告，和依赖图里打了 ✅ 的项（[L2-release §2.8](../../knowledge/spec/L2-release.md#28-a-release-removes-finished-plans-and-deep-verify-reports-)）。

## 要做的事，读哪一份

| 要做的事 | 读 |
| --- | --- |
| 读、写 `<项目根>/knowledge/`，给新项目建知识库，改成分层；改了一页要核对哪些页；两页说的不一样 | [knowledge-base.md](references/knowledge-base.md) |
| 写、改 spec 和 plan：元信息和更新记录、⬜ 标记、plan 的依赖图和节点、条目怎么记、依赖图 `plan/index.md` 的格式 | [spec-and-plan.md](references/spec-and-plan.md) |
| deep-verify：深查 plan 做完到不到得了 spec、spec 在现在的代码上做不做得出来、spec 有没有矛盾和大的设计问题 | [deep-verify-knowledge.md](references/deep-verify-knowledge.md) |
| 只查形式：锚点、⬜ 标记的 issue 还开不开、`index.md` 的「建立在」、plan 的格式 | 知识检查：`node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/knowledge-check.ts --cwd <项目根>`（不联网加 `--offline`）。deep-verify 的第 2 步也跑它 |

设计还没定、在环里还是环上、routine 跑在哪，不在这里：见 `entry` 的 [design.md](../entry/references/design.md)。
