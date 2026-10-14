---
name: setup-app
description: >-
  把一个 app（一个项目仓库）接上 aboveloop 的 builder loop：workflow `loop.yml`、label、钥匙、
  `.agents/builder-resolve.md`，最后跑 `scripts/check.sh` 逐项确认都设好了。只设这个 app 自己的；
  aboveloop 全局的（composite action、GitHub App、各把钥匙）在 L3-loop-components §1。Use when the user says
  setup-app, setup-loop, 接工作循环, 接 loop, 新项目接进来, connect a project, or a repo has no loop workflow,
  or to check whether an app is set up.
---

# setup-app

把一个 app 的仓库接上 builder loop。哪些东西是每个 app 各设一份、哪些是 aboveloop 全局只设一次，见 [L3-loop-components](../../knowledge/spec/L3-loop-components.md)；这里只写每个 app 要做的步骤。

| 部分 | 步骤 |
| --- | --- |
| loop | [references/loop.md](references/loop.md)：label、merge 后删分支、workflow `loop.yml`、变量、钥匙、`.agents/builder-resolve.md`、dry run |
| 检查 | 最后，和以后随时：`scripts/check.sh <owner>/<repo>` |

## 先问清这几样

缺哪样问哪样，不要猜：

- 项目仓库 `<owner>/<repo>`。必须在装了 loop 的 GitHub App 的那个账号下：loop 第 4 步把仓库加进这份安装。
- 这个项目的 issue 分哪几类、哪几类可以不等 owner 就开工（写进 `.agents/builder-resolve.md`）。

## 前提

| 查什么 | 谁 | 做完的样子 |
| --- | --- | --- |
| aboveloop 全局的那些已经设好（[L3-loop-components §1](../../knowledge/spec/L3-loop-components.md#1-global-aboveloop-set-up-once)） | 你 | `scripts/check.sh <owner>/<repo>` 里「aboveloop Actions access」和「GitHub App on aboveloop」两行是 ✓；不是就先补全局的 |
| `gh` 已登录，scope 里有 `workflow` | 你 | `gh auth status` 列出它；缺就 `gh auth refresh -s workflow`（会开浏览器，用户点一下） |
| aboveloop 的 Actions 访问是 `none`：每个 `loop.yml` 用 App 的 token 检出最新版，不靠这个访问（[L3-loop-components §1](../../knowledge/spec/L3-loop-components.md#1-global-aboveloop-set-up-once)） | 你 | `gh api repos/shiyuann/aboveloop/actions/permissions/access` 打印 `"access_level":"none"`；不是就先补全局的，不放开它 |

## 要用户动手的

攒到一起，一次说清点哪里、填什么、不做会怎样：把 loop 的 GitHub App 装到这个仓库上（loop 第 4 步）。钥匙和 token 不贴进聊天、不进仓库。

## 最后：检查

```bash
<aboveloop 工作副本>/skills/setup-app/scripts/check.sh <owner>/<repo>
```

每一项一行，✓ 或 ✗；最后一行是「All set.」或有几项没设好，退出码就是 ✗ 的个数。它只读 GitHub，从不打印钥匙的值。读不到的一样（App 装没装，有私钥文件时它自己问 GitHub）标 `·`，交给用户看。loop 的 agent 不用 Cursor GitHub App：它们不带 repo 启动，用 loop 的 GitHub App 的 token 自己 clone。

做完的样子：`All set.`，再加上用户确认了那个 `·`（如果有）。以后怀疑哪里断了，也先跑它。

报告：做了哪些步骤、`check.sh` 的结果、dry run 的链接，还有交给用户的那几样做没做完。
