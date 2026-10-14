# aboveloop

一个 **Claude Code / Cursor plugin**：agent 驱动的开发循环要守的规矩和用的 skill。

它分两层：

- **里层是 builder loop**：一个 issue 的一生。explore 补 context、分类、调研；implement 在分支
  `issues/<N>` 上写 plan、spec 和代码，开 PR，跑测试。两种模式走同样的步骤：owner 和 agent 在会话里一起做
  （半自动），或者 CI 里没有 owner 地做（自动：项目仓库的 `loop.yml` workflow 经 Cursor 的 Cloud Agents API 开 agent）。
  owner 只做决定和 merge。
- **外层是 dev loop**：owner 的注意力。会话开工时 `start` 扫一遍在等的活，更新依赖图，给出先做的几件，一件一件带 owner 做。

设计在 [`knowledge/`](knowledge/index.md)，以那里的 spec 为准；这份 README 只写它是什么、怎么装、怎么改。

两家的清单分别在 `.claude-plugin/` 和 `.cursor-plugin/`，共用同一个 `skills/`。SKILL.md 是通用的 Agent Skills 格式。
入口是 `entry` skill：每次都要守的规矩在那里，要办具体的事该读哪份、用哪个 skill，也从那里查。

## 装

Claude Code：

```bash
claude plugin marketplace add shiyuann/aboveloop
claude plugin install aboveloop@aboveloop
```

然后在每个要用它的项目的 `AGENTS.md`（或 `CLAUDE.md`）里写一句：先读 aboveloop 的 `entry` skill。

验收：能打印出 plugin 信息、状态 enabled，才算装上。

```bash
claude plugin details aboveloop@aboveloop
```

装上之后的事 —— 更新到最新一版、钉在一个发版 tag 上、Cursor、一版坏了怎么逃生、排障 —— 全在
[`skills/setup-dev/SKILL.md`](skills/setup-dev/SKILL.md)。一句话版本：把这个仓库 clone 到
`~/workdir/aboveloop`（别处就设 `ABOVELOOP_DIR`），跑 `make sync`：它把 Claude Code 的 marketplace 钉在
最新的发版 tag 上，并把那个 tag 的树拷进 `~/.cursor/plugins/local/aboveloop/`。跑完重启会话。

要让一个项目接上 builder loop（workflow、label、钥匙、项目自己的配置），用 `setup-app` skill。

## 装了什么

```bash
claude plugin details aboveloop@aboveloop
```

不在这里抄一份清单 —— 加一个 skill 就会过时。

## 改

```bash
vim skills/<name>/SKILL.md
make validate             # 校验
make skills-test          # skill 脚本的测试
make loop-test            # loop workflow 的测试
git commit && git push    # 进 main：开发的历史，还不是一版
```

**改动等下一版才到会话里。** 一版就是一个发版 tag（`knowledge/spec/L2-release.md`）。owner 用
`prerelease` skill 发版：它推版本号、写 CHANGELOG、打 tag、推上去，再装这一版（`make install-release`）。
agent 不发版。

会话读 Claude Code 缓存里装好的那一版，不读工作副本。装最新一版：`make sync`，然后**重启会话**。
Cursor 那边也是 tag 那棵树的真拷贝（不是符号链接），`make sync` 一并刷新。
只想这一次会话读工作副本：`claude --plugin-dir ~/workdir/aboveloop`。

## 版本

`VERSION` 是唯一真相，三个清单（Claude plugin / Claude marketplace / Cursor plugin）
由 `make bump` 从它同步 —— JSON 读不了文件，所以只能同步，但不用手改就不会写歪。只在发版时推（`prerelease` 第 4 步）。
`make validate` 会检查三处版本一致、plugin 清单有效、Markdown 里的相对链接指得到。

约定：**当天日期 + patch**，如 `20260920.1`。同一天再发就是 `.2`。

这个 plugin 装的是约定和手艺，不是有 API 的库 ——「0.3.0 还是 1.0.0」对散文没有意义，
「这份约定是哪天的」有意义，一眼看出消费端落后多久。

## 一条铁律

**规矩和设计里不写具体项目（L1 的 P5）。** 一个项目只能以「实例」出现：它在登记表里的那一条、它的域名、在它身上做的实测、plan 里它的那一组节点。规矩里的例子用中性的名字，比如 `my-app`。

原则进 aboveloop，让原则站得住的证据（踩过什么坑、这个仓库为什么这么定）留在各项目自己的
`AGENTS.md`。skill 同理：手艺进 aboveloop，项目自己的配置和记录留项目。

一旦 aboveloop 里出现具体路径，它就不再通用，下一个项目接进来就得改它。

## License

[MIT](LICENSE)

---

# 为什么是这个形状

下面每条都是一次取舍。**要推翻，先推翻它的理由。**

## 前提：本机装 plugin，云端 clone

本机的 Claude Code 和 Cursor 装 plugin。云端 agent（项目的 loop workflow 经 Cursor 的 Cloud Agents API 开出来的）
不装 plugin，每次把这个仓库和项目仓库一起 clone，按路径读 skill（[L2-plugin §3](knowledge/spec/L2-plugin.md#3-how-it-is-loaded)）。

所以不把拷贝提交进别的仓库，不用 stamp 和漂移检查，不用 submodule：只有一份。

## 全部走 plugin

约定和 skill 都是 plugin 里的 skill。**没有符号链接，没有自己造的拷贝脚本，没有生成物**：装和更新都走 plugin 自己的命令。
plugin 把版本、更新、卸载、token 开销核算全部白送，比自己造链接或拷贝脚本省事。

## 仓库根即 plugin 根

单个 plugin 就不要 `plugins/<name>/` 那层 —— 那是**一个 marketplace 装多个 plugin** 时的布局。
marketplace 的 `source` 写 `"./"`。

两家清单能并存，是因为**都自动发现根下的 `skills/`**，格式也都是标准 SKILL.md。
一份 skill 两家都认，不用维护两套内容。

## 约定做成 skill，不做 hook

hook 能把约定注进每次会话，但**每家 coding agent 的 hook 都不一样**，维护三套触发器
换一点「自动」不划算。项目的 `AGENTS.md` 里一句「先读 `entry` skill」，三家都跟得上。

## `setup-dev` 进 aboveloop，第一次装留在外面

先有鸡还是先有蛋的问题只卡在**第一次装**上：plugin 没装的时候，`setup-dev` 这个 skill 不存在。
更新、验收、Cursor、排障全都发生在装上之后。

切法的判据是**读得到读不到**：

| 文件 | plugin 没装时读得到吗 |
| --- | --- |
| 这份 README | ✅ 公开仓库 |
| 项目的 `AGENTS.md` | ✅ 项目里的 agent 唯一一定读的入口 |
| `setup-dev` skill | ❌ plugin 没装，这个 skill 不存在 |

所以：

- **README 和项目的 `AGENTS.md` 管「还没装」** —— 那两行装的命令，和「先读 `entry`」那一句。
- **`setup-dev` 管「装上之后」** —— 状态检查、装最新一版（`make sync`）、逃生、Cursor、验收、排障。
- **两边不重叠。** 一条信息如果在需要它的那一刻读不到，写在那儿就是装饰。

大方向仍是 `skill-authoring.md` 那条 —— plugin 不该假设消费项目已经有一份操作说明。

## 手艺进 aboveloop，产出留项目

判据一句话：**换个项目还用得上的进 aboveloop；只描述「这个项目做过什么」的留项目。**

| 进 aboveloop | 留项目 |
| --- | --- |
| 规矩、流程、怎么调研、怎么写、怎么验 | 项目自己的配置（`.agents/<skill>.md`：issue 的分类、发版的本机步骤） |
| 工具脚本（跟着它的 skill 走） | 项目的 spec、plan、发版记录 |
| | 凭证与会话（gitignore，哪都不去） |

工具放进 skill 目录内，一个 skill 就是一个自洽单元，不另开平行的 `toolkits/` 树。

## 不做

- **不拷贝、不 vendor、不用 submodule** —— 一份 plugin，本机装、云端 clone，就够了。
