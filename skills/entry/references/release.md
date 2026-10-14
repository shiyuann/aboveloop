# 发版：VERSION、tag、prerelease

> 改版本号、发一版、写发版时跑的 workflow，或定一个定时的活跑哪份代码时读。词表在 [SKILL.md](../SKILL.md)。

main 是开发的历史。只有 tag 是正式的版本。一版就是一个 tag，tag 推上 origin 就是发版。推 main 不是发版。

发版的顺序、项目配置有哪几节、每个项目发版做什么，在 [L2-release](../../../knowledge/spec/L2-release.md)。要做的活在 issue 里。

## 词

| 词 | 意思 |
| --- | --- |
| 一版 | 一个发版 tag 记下的那个提交。 |
| 发版变量 | 项目仓库的 repository variable `RELEASE`（GitHub Actions 的 variables）。值是 `<tag> <sha>`：最新一版的名字、一个空格、它的 tag 的提交的完整 SHA（40 位）。只有 `prerelease` 写它：在 owner 的 Mac 上、用 owner 的 `gh` 登录、推完 tag 之后（第 6 步，`release-var.ts write <tag>`）。第一次写：有发版 tag、还没有变量（或变量丢了）的项目，owner 说是哪一版，用同一条命令写一次。loop 的 token 都写不了它。 |
| 最新一版 | 发版变量指的那一版。只有这几样都成立才算：那个名字的 tag 在，它的提交就是变量的 SHA，`origin/main` 到得了这个提交。不然拿钥匙的活就停，从不退回一个旧的 tag。变量没有、读不到、不是 `YYYYMMDD.N <sha>` 的样子，也停。变量没指的发版 tag，版本号再大，也不是最新一版：到处都不认，所以不用删。按数字比日期和 patch，不按字符串排（`.10` 比 `.9` 新）。只有 `YYYYMMDD.N` 形式的名字是版本号。GitHub Actions 里的活先 fetch tag：`actions/checkout` 默认只拿一个提交，不拿 tag。定义在 [L2-release §0](../../../knowledge/spec/L2-release.md#0-terms)。 |
| 发版 tag | 带注释的 tag，名字就是 `VERSION` 那一行，比如 `20261010.1`。 |
| 发版的活 | 发版 tag 推上去时，GitHub Actions 跑的 job。比如部署网站、往桶里传文件、跑一轮数据。 |
| 本机的步骤 | 只能在 owner 的机器上做的发版步骤。比如传 TestFlight、重装 plugin。 |
| 项目配置 | `<项目根>/.agents/prerelease.md`：这个项目发版时自己的那几步。 |

## 文件

```text
<项目根>/
  VERSION                     ← 版本号的唯一真相，一行 YYYYMMDD.patch
  .agents/prerelease.md       ← 项目配置，prerelease 读它
  .github/workflows/<…>.yml   ← 发版的活，由推 tag 触发
```

## 规矩

- **`VERSION` 是版本号的唯一真相。** 格式 `YYYYMMDD.patch`。
  - 别处要版本号（清单、`package.json`、App 的配置），从它读，或由脚本从它同步。不手改第二处。要 semver 的文件（比如 `package.json`），同步成 `YYYYMMDD.patch.0`：npm 不收两段的版本号，补一个 `.0` 顺序不变。
  - 只在发版时推版本号（`prerelease` 第 4 步）。平常的提交不动它。
- **一版是一个 tag。** tag 名就是 `VERSION` 那一行，不加 `v`。用带注释的 tag（`git tag -a`）。
  - tag 打在版本号那次提交上。这次提交已经跟上 origin/main。
  - 推上去的 tag 不删、不挪。号用过了，就推一个新号。
- **推 tag 是发版唯一的触发。**
  - 发版的活写成 GitHub Actions 的 workflow，触发写 `on: push: tags`。
  - 推 main 不触发发版的活。merge 了的代码，等下一版才上线。
  - 发版的活拿钥匙之前，先查这个 tag 的提交在 main 上。不在就停。拿钥匙的活还要查：这个 tag 是最新一版，tag 是 owner 推的（R15）。用 `prerelease` 发版的项目，怎么查看是什么触发了它（[L2-release §2.3](../../../knowledge/spec/L2-release.md#23-each-release-job-examines-that-the-tag-is-on-main-)）：
    - 定时的活、别的仓库的活：读发版变量，只跑它指的那一版。
    - 推 tag 触发的活：查 `github.actor` 是 owner；再用 `vars.RELEASE` 查它的 tag 比变量那一版大，或者变量指的就是它的 tag、在 `GITHUB_SHA` 上（变量在推完几秒之后才写，等 runner 的活和每次重跑都可能看到自己的 tag）。没有变量（项目的第一版）就停；写了变量以后重跑就过。
    - 只有 owner 的登录写发版变量。不给 loop 的任何 token Variables 写的权限。
- **正式跑的东西，只读最新一版，不读 main。**
  - 定时跑的活跑最新一版的代码。比如数据管道：定时的那一轮跑最新一版。
  - **NOTE:** GitHub 定时触发时，用的总是 main 头上的那份 workflow 文件。只检出 tag，换的只是代码，job、步骤和钥匙还是 main 的。所以定时触发只做一件事：用 `workflow_dispatch` 在最新的发版 tag 上再跑一遍同一个 workflow，整轮都来自 tag。
  - 别的仓库用这个仓库的代码或 skill（composite action、云端 agent 的 clone），也只读最新一版。
  - 在 main 上干活的只有开发：会话、开分支写 PR。
  - 推一个发版 tag，马上用新代码跑一轮。
  - 修好了、急着上线：发一版。不拿 main 的头手动跑。
- **发版只走 `prerelease` skill。**不自己拼提交、rebase、tag、push。
  - owner 叫了 `prerelease`，里面的步骤都在范围内，不每步再问。只在 skill 写了「停」的地方停。
- **项目不留自己的发版 skill。** 项目只写项目配置。`prerelease` 读它，和 `builder` 读 `.agents/builder.md` 一样。
- **只有 owner 发版。** owner 叫 `prerelease`，就是拍板。工作循环里的 agent 不发版。

## 为什么

- main 是开发的历史，只有 tag 是正式的版本。merge 不是上线的决定。什么时候上线，owner 定。
- 最新的 tag 说清线上跑的是哪份代码。数据和 App 出自同一份代码。
- 没有分支保护的私有仓库，能推代码的人都能在任何提交上打 tag。所以发版的活先查 tag 在 main 上。
- 发版的顺序只学一遍：上传失败怎么接着做、怎么跟上 origin/main。一份 skill 管所有项目，每个项目都拿到。
