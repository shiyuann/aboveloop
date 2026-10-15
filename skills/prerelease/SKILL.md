---
name: prerelease
description: >-
  发一版：从 origin/main 到推 tag，一条路，在自己的 worktree 里跑。定范围（上一版之后改了什么、按区域要做哪些本机步骤）、
  点名主目录里没进这一版的改动、跟上 origin/main、跑测试、推版本号、写 CHANGELOG、删做完的 plan、报告和依赖图里打了 ✅ 的项、打 tag、推之前的本机步骤（比如传 TestFlight）、
  先推 main 再推这一个 tag、推之后的本机步骤，最后看 tag 触发的 run。项目自己的那几步在
  `.agents/prerelease.md`。只有 owner 叫它发版；发版的规矩（写发版时跑的 workflow、定时的活跑哪份代码）在 `references/release.md`，谁都可以读。Use when the user says prerelease, 发版, 发一版,
  预发布, 出包, 发 TestFlight, ship a build, release, cut a release, or 打 tag 发布.
---

# prerelease

一条路，按这个顺序，不要另拼：

```text
0 发版 worktree → 1 定范围 → 2 点名不进这一版的改动 → 3 跟上 origin/main、跑测试 → 4 推版本号、写 CHANGELOG、删做完的 plan、打 tag → 5 推之前的本机步骤 → 6 推 HEAD:main、推 tag → 7 推之后的本机步骤、看 run、删 worktree
```

owner 叫了这个 skill，提交、tag、上传、push 都在范围内，不每步再问。只在下面写了「停」的地方停。停的时候：

- 说停在哪一步、为什么、下一次从哪接着。
- 这一次锁上了发版 worktree（第 0 步的 `add --lock` 或 `lock` 成功了），才解开它的锁（`git -C "$MAIN" worktree unlock "$REL"`）。worktree 留着，下一次从「接着上次」开始。
- 因为 worktree 已经锁着（或 `git worktree lock` 失败了）而停的，不解锁：那把锁是另一次发版的。

为什么是这个顺序，在 aboveloop 的 [L2-release §1](../../knowledge/spec/L2-release.md#1-the-order-)；做事用不着读它。词（最新一版、发版 tag、本机的步骤）和发版的规矩在 [references/release.md](references/release.md)。

## 0. 发版 worktree

发版只在发版 worktree 里跑：从 `origin/main` 开，`HEAD` 是 detached。主目录里可能有别的会话的改动，发版不碰它：不在那里提交、不切分支、不 stash。

```bash
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"   # 主目录
REL="$MAIN-release"                                                              # 发版 worktree，绝对路径
git -C "$MAIN" worktree prune
git -C "$MAIN" worktree list --porcelain
```

在仓库的哪个 worktree 里跑都一样：路径是固定的。看 `list` 里 `worktree $REL` 那一段：

| 发版 worktree | 做什么 |
| --- | --- |
| 不在 | `git -C "$MAIN" fetch origin`，`git -C "$MAIN" worktree add --detach --lock --reason "prerelease $(date -u +%Y-%m-%dT%H:%MZ)" "$REL" origin/main`。再在 `$REL` 里跑项目配置「Release worktree」一节。然后第 1 步 |
| 在，有 `locked` 一行 | 停，说出锁的 reason：另一次发版在跑，或者上一次死了。不解锁：锁不是这一次的。没有在跑的，owner 跑 `git -C "$MAIN" worktree unlock "$REL"` |
| 在，没锁 | 上一次停了。先锁上：`git -C "$MAIN" worktree lock --reason "prerelease <时间>" "$REL"`。`lock` 失败了（比如另一次发版刚锁上）：停，说出原话，不解锁。锁上了，再照「接着上次」做 |

- 之后每一步都在 `$REL` 里跑（命令的工作目录是 `$REL`）。项目配置、链接检查、测试，都读 `$REL` 里的。
- worktree 挪到 `origin/main` 以后（新建、`git checkout --detach origin/main`，或第 3 步带进来新的提交），再跑一次「Release worktree」一节。

## 先读

- **项目配置** `$REL/.agents/prerelease.md`，全部几节。没有这份文件就停，说出文件名，并指给 [references/config.md](references/config.md)（模板）。
  - 模板里的每一节都要有，用不着的写「None」。少了一节（比如旧的配置没有 Release worktree）也停，说出少的那一节，指给模板。
- 下面的脚本在本 skill 目录的 `scripts/` 下，零依赖，用 `node --experimental-strip-types --no-warnings <脚本>` 跑（Node 22+）。`scope.ts`、`changelog.ts` 和 `release-var.ts` 要 `gh` 已登录（本机的 owner 账号）。
- **记下 `<点>`** 是 `node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write <点>`，在 `$REL` 里跑。下面每到一个点就记，哪个点在哪、停了以后怎么接，在「接着上次」那张表。
- **链接检查**是 `node <本 skill 目录>/scripts/links.mjs`：项目里每个 Markdown 文件的相对链接，指向的文件都在。不联网。红了它列出每一条坏链接。

## 接着上次

发版每到一个点，就把它记下来：`state.ts write <点>`（下面每一步写了在哪记）。记在发版 worktree 自己的 git 目录里：`$(git rev-parse --git-dir)/prerelease-state`。每个 worktree 一份，不进提交，不在主目录里，`git worktree remove` 连它一起删。里面两行：`version=<记的时候 VERSION 那一行>`、`step=<点>`。它先写临时文件再改名，停在哪都不会只写一半。

接着上次只看记下的点，不从 git 的样子猜停在哪：

```bash
git fetch origin
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts read
```

- 它打印 `step`、`version`、`problems`。`problems` 是文件和 git 对不上的地方：比如记的是 `tagged`，本地却没有这个 tag；记的是 `main-pushed`，`origin/main` 却没有 `HEAD`；记的是 `version-commit`，本地 V 的 tag 却在别的提交上；没有文件，`origin/main..HEAD` 里却有 `version:` 提交；或者读不到 origin。不空：停，原话说出两边，再告诉 owner 下一步有哪两条路。不猜，不改文件，两条路都等 owner 选：
  - **补回记下的样子**：git 里少的东西补回来，再叫一次。比如本地的 V 的 tag 被删了、V 不在 origin 上：在版本号那次提交上重打（`git log --format='%h %s' --grep="^version: V$" origin/main..HEAD` 找它，`git tag -a V <sha> -m V`）。读不到 origin：等能读了再来。没有文件、git 停在第 4 步之后：照 git 的样子记下那个点（`HEAD` 是没 tag 的 `version: V`：`state.ts write version-commit`；有本地 tag、在 `HEAD` 上：`write tagged`；tag 的提交已经在 `origin/main` 上：`write main-pushed`），再叫一次。
  - **从头来，不丢修复**：先 `git log --format='%h %s' origin/main..HEAD` 列出发版内的修复，说给 owner；要留的，删 worktree 之前 `git branch <名字> HEAD` 把它们留住（`git worktree remove` 之后，没有名字的提交找不回来）。再删这一次的本地版本号 tag：tag 是所有 worktree 共用的，留着它，同一天的下一次发版 bump 出同一个号，`git tag -a` 就失败（「tag already exists」）。这一次的 tag：文件里的 `version`；没有文件，就是 `read` 说出的那几个。每个 `T` 照下面这段做，它停了就停：
    ```bash
    git ls-remote --exit-code --tags origin "refs/tags/$T"; rc=$?
    if [ "$rc" -eq 2 ]; then git tag -d "$T"        # 从没离开本机：这个号没用过
    else echo "STOP: ls-remote exit $rc (0: $T is on origin, used; keep it; else: origin cannot be read)"; exit 1; fi
    ```
    退出码 0：tag 在 origin 上，这个号用过了，不删，停，说出来。别的：读不到 origin，停，说出原话。都删完了，再删掉 worktree，从第 0 步开始。
- 不然照下表做。一个点只有一种做法。V 是文件里的 `version`。

| 记下的点 | 什么时候记 | 接着做什么 |
| --- | --- | --- |
| 没有文件 | — | 停在第 4 步之前，或 worktree 刚建好。从不当成推完了。`state.ts read` 先查：`origin/main..HEAD` 里有 `version:` 提交，或者本地有一个版本号的 tag 不在 origin 上：文件丢了，但这一次已经过了第 4 步。是 `problems`，停，说出那个提交或 tag（上面的两条路）。从不把它 rebase 进第 3 步。都没有：工作区干净、`origin/main..HEAD` 是空的：`git checkout --detach origin/main`，再跑一次「Release worktree」一节，从第 1 步开始。`origin/main..HEAD` 里有修复的提交，或工作区里有没提交完的修复（「发版内的修复」，然后停了）：留着。先把没提交的修复做完、提交，再从第 1 步走到第 3 步：第 3 步把它们 rebase 到最新的 `origin/main` 上（已经在上游的修复会丢掉），跑测试。这里从不 `git checkout --detach origin/main`：修复的活不能丢 |
| `bump` | 第 4 步，跑版本号命令之前 | 停在第 4 步当中。不 bump 第二次，不写第二节。`VERSION` 还是 V：版本号命令没跑完（它最后才改 `VERSION`），再跑一次；不是 V 了：它跑完了，不再跑。再查这个号用过没有。`HEAD` 已经是 `version: $(cat VERSION)`、工作区干净：提交做完了，记 `version-commit`，接着下一行。不然：版本号文件、`CHANGELOG.md`、页头、「核对过」、暂存区里 `cleanup.ts` 的结果是这一版的；别的改动是一个没提交完的修复，做完，只提交它的文件。再从第 4 步的 Changelog 命令那一行接着做：项目配置 Changelog 一节的命令、`changelog.ts`；`exists` 是 false 才写这一节（true：上次已经写了，不写第二节）。页头上已经有这一版日期的那一条，就不再写第二条。然后 `git add` 那一行往下：stage、`cleanup.ts`、链接检查、Tests、提交、tag |
| `version-commit` | 版本号那次提交之后 | 只补 tag（第 4 步那一行，带上修复的列表），记 `tagged`。本地已经有 V 的 tag、在 `HEAD` 上：只记 `tagged`。再第 5 步。本地已经有 V 的 tag、却在别的提交上（比如一次没删 tag 的「从头来」留下的）：`git tag -a` 会失败，所以 `state.ts read` 报 `problems`，说出两个提交，停（上面的两条路；补回：`git ls-remote --exit-code` 退出码 2 才 `git tag -d V`，再叫一次） |
| `tagged` | 打完 tag 之后 | 第 5 步，从失败的那一步接着做（项目配置 Before push 那张表）。不 bump，TestFlight 已经有这个号的包也不 bump：那是这一版自己传的 |
| `refix` | 「推之前的检查红了」：查过 tag 不在 origin 上之后，挪 worktree 之前 | 把那一段做完：本地还有 V 的 tag，`HEAD` 是它的提交：`git checkout --detach "$VC^"`；再查一次 origin，退出码是 2 才 `git tag -d`。然后照「发版内的修复」修、提交，重做第 4 步（记 `bump`），再第 5 步 |
| `before-push-done` | 第 5 步全过了之后 | 第 6 步：推 `HEAD:main`，再推 tag。不再跑 Before push |
| `merge` | 第 6 步，`git merge origin/main` 之前 | 第 6 步那次 merge 的后半段。tag 不动，不再跑 Before push，从不走「推之前的检查红了」。先收好工作区：merge 有冲突没解完（`MERGE_HEAD` 在）：解开，`GIT_EDITOR=true git commit --no-edit`。还有没暂存的改动：那是一次修复，做完，`git commit -m "Merge follow-up: <修了什么>" -- <文件>`。然后从第 6 步 merge 那一串的第 2 项接着做：`cleanup.ts`（暂存区里已有它上次的结果，它给出一样的），改了就提交 `Merge follow-up: links`；链接检查、Tests，红了在上面修、提交 `Merge follow-up: <修了什么>`；再跑一次第 6 步那段：推 `HEAD:main`、记 `main-pushed`、推 tag、记 `tag-pushed`、写发版变量 |
| `main-pushed` | `git push origin HEAD:main` 过了之后 | 只推 tag（`git push origin V`），记 `tag-pushed`，写发版变量（`release-var.ts write V`，第 6 步），再第 7 步 |
| `tag-pushed` | 推 tag 过了之后 | 推完了。先写发版变量：`release-var.ts write V`（第 6 步；变量已经是这一版，它什么都不写，打印 `already`）。再第 7 步：从没过的那一步接着做（停的时候说过）。不出新版本，不 bump。owner 要的是新的一版：先删掉 worktree，再从第 0 步开始 |
| `after-push-done` | 第 7 步的本机步骤全过了之后 | 第 7 步的 2、3：列出 tag 触发的 run，删掉 worktree |

**这个号用过了**：tag 已经在 origin 上，或者 TestFlight 已经有这个号的包（项目配置写了怎么看，比如 Version 一节的 `BUILD` 行）。先 bump，再打新 tag。只在本机、从没推过的 tag 不算用过。这一条只管第 4 步的 bump（也是 `bump` 这个点上接着做的），和 `refix` 之后重做的第 4 步。`tagged` 往后的点从不 bump，TestFlight 有这个号的包也一样。

## 1. 定范围

```bash
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/scope.ts
```

它只读，打印一份 JSON：最新一版（`latest`：发版变量 `RELEASE` 指的那一版；还没有发版就是 null）、之后的提交、工作区的文件、按区域分好的文件（`areas`、`outside`）、这一版要做的本机步骤（`steps`）、不算数的 tag（`ignored`：`origin/main` 上版本号比最新一版大、但发版变量没指它的 tag，原因是「not the release variable」）、`stop`。

- `stop` 不是 null：停，原话告诉 owner。几种：
  - 不在发版 worktree 里，或 `HEAD` 在一个分支上。只从发版 worktree、detached 的 `HEAD` 发（第 0 步）。
  - 上一版之后什么都没改。
  - 上一版之后有不是 owner 做的推送进了 `main`（列出提交和是谁）。owner 先看过这些提交，再叫一次。owner 在这一轮会话里听你说了这几个提交、看过之后又叫了，第二次就带上它们：`scope.ts --seen <sha>,<sha>`（L2-release §1 第 1 步）。它们不再挡，列在 `seen` 里；第 4 步打 tag 时，把它们写进 tag 的说明（`-m "Seen by the owner: <sha> by <谁>, …"`），记录跟着这一版走。别的会话、别人说「看过了」都不算。新冒出来的推送照样停。
  - 谁推了 `main` 的记录读不到。不猜，停。
  - 没有发版变量 `RELEASE`，`origin/main` 上却有发版 tag。scope 从不从 tag 猜最新一版。owner 先写变量（第一次写，L2-release §0）：owner 说是哪一版，再用 owner 的 `gh` 登录跑 `release-var.ts write <那个 tag>`（第 6 步那条命令）。一个发版 tag 都没有：这是第一版，不停，全部都在范围里。
  - 发版变量读不到，或不是 `<YYYYMMDD.N> <40 位 SHA>` 的样子。
  - 变量指的 tag 在 origin 上没了、在 origin 上不在变量的 SHA 上（被挪过），或 `origin/main` 到不了它。scope 读的是 origin 上的 tag（`git ls-remote`），不是本地的：fetch 不删 origin 上删掉的 tag。owner 先看。
- `ignored` 不空：照常往下，回复里说一句哪几个 tag 不算、为什么。不删它们：它们留着当证据，怎么处理由 owner 定。
- `steps` 就是这一版要做的本机步骤。只做它列出的。没列的区域，Before push 和 After push 里属于它的步骤跳过。

## 2. 点名不进这一版的改动

这一步什么都不提交。发版 worktree 从 `origin/main` 开，自己没有改动。

```bash
git -C "$MAIN" status --porcelain                 # 主目录里没提交的文件
git -C "$MAIN" log --oneline origin/main..main    # 主目录的 main 上没推的提交
git status --porcelain                            # 发版 worktree
```

- 主目录里的这些不进这一版。记下来，「做完」时点名：
  - 没提交的文件：由改它的会话自己提交。
  - 没推的提交：写「put them on a branch and a PR」。每样改动都走分支和 PR，小改动也是（`entry` 的「小改动」；L2-loop-builder §2.1）。它们进下一版。
- 发版 worktree 里只能有一次停下留下的改动：第 4 步当中停下的文件，或一次停下留下的修复（「接着上次」）。别的改动：停，说出文件名。
- 不用 stash、restore、reset 把改动挪走或丢掉。

## 3. 跟上 origin/main，跑测试

```bash
git fetch origin
```

| 历史 | 做什么 |
| --- | --- |
| `origin/main` 已是 `HEAD` 的祖先 | 不用动 |
| `HEAD` 已是 `origin/main` 的祖先 | `git merge --ff-only origin/main` |
| 分叉了，`origin/main..HEAD` 里没有 merge commit（比如接着上次留下的修复） | `git rebase origin/main`。已经在上游的修复，git 会丢掉它 |
| 分叉了，这一段里有 merge commit | `git merge origin/main`，说明写 `Merge origin/main` |

冲突要解开，然后接着 rebase 或 merge，不停下来问。

- 不 `--force`，不 `-i`，不整份拿 ours 或 theirs。
- `git rebase --continue` 和 merge 的提交说明用 `GIT_EDITOR=true`，留原来的说明。

跟上之后，origin/main 带进来新的提交：先再跑一次「Release worktree」一节，再跑一次第 1 步的脚本。它又停了，就停。

然后跑项目配置 Tests 一节的全部命令。红了：照「发版内的修复」修，再跑一次。还红就停，不打 tag。

## 发版内的修复

第 3、4 步的测试或链接检查红了，或第 5 步的一个本机步骤要改代码才能过：发版自己修。这是没走 PR 进 `main` 的唯一一种工作（L2-release §1）。

- 在发版 worktree 里修，在版本号那次提交之前提交。
- 提交只点名修的文件：`git commit -m "<说明>" -- <文件>`。暂存区里这一版的改动（第 4 步）留着。
- 第 4 步里的修复：在 `CHANGELOG.md` 这一节加一行，写它改了什么，不带链接；`git add CHANGELOG.md`。
- tag 的说明列出每个修复：`git log --format='%h %s' origin/main..<版本号那次提交>^`（第 4 步）。
- 「做完」列出每个修复：SHA、subject、改了哪些文件（`git show --name-only --format= <sha>`）。只改了测试的，说一句。

## 4. 推版本号、写 CHANGELOG、删做完的 plan、打 tag

```bash
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write bump &&   # 记下 bump；没记下就不往下跑
<项目配置 Version 一节的命令>
<项目配置 Changelog 一节的命令；None 就不跑>
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/changelog.ts
```

- 版本号只在根目录 `VERSION`，格式 `YYYYMMDD.patch`。tag 名就是这一行，不加 `v`。
- 版本号命令只改版本号文件，最后才改 `VERSION`。它改了别的文件（比如生成的数据、格式化），停，说出文件名：发版不生成数据文件。
- bump 之后、往下跑之前，查这个号用过没有（「接着上次」的「这个号用过了」）：`git ls-remote --exit-code --tags origin "refs/tags/$(cat VERSION)"`。退出码 2：没用过，往下。0：用过了，再 bump 一次。别的（读不到 origin）：停，说出原话。

`changelog.ts` 只读，打印一份 JSON：

- `heading`：这一节的标题。`exists`：这一版的一节已经在了。
- `prs`：上一版之后 merge 的 PR。每个有号、标题、正文的摘要那一段，和 `issues`：它的 `Fixes`、`Refs` 行里本仓库的 issue 号，每个带它在 `HEAD` 的 plan（`knowledge/plan/<N>-<slug>.md`，没有就是 null）。别的仓库的 issue 不算。
- `commits`：没走 PR、直接进 `main` 的提交（subject）。发版内的修复也在这里。
- `repo`、`commit`：拼链接用。`commit` 是第 4 步写这一节时的 `HEAD`。这一版删掉的 plan，在它上面还打得开。
- `stop`。

- `stop` 不是 null：停，原话告诉 owner。比如项目配置少了 Changelog 一节。
- `exists` 是 true：`CHANGELOG.md` 里已经有这一版的一节（上次停在第 4 步当中）。不写第二节，接着做下面的 stage 和 `cleanup.ts`。
- 不然，把这一节写进项目根的 `CHANGELOG.md`，放在最上面：`# Changelog` 下面、上一版那一节上面。没有这份文件，就建一个，第一行写 `# Changelog`。

这一节这样写：

- 标题照抄 `heading`：`## <version> · <YYYY-MM-DD>`。
- 下面几条 bullet，用简单的英文（照 `entry` 的 ASD-STE100）。读的人是 owner 和 agent，没有用户读它。
- 只从 `prs` 的标题和摘要、`commits` 的 subject 写。一件改动一条，说改了什么。几条说同一件事，合成一条。
- 不打开 issue、评论去补：那是别人的字（E1），而这一节不经 merge 就进 tag。
- 内部的改动（refactor、CI、测试）合起来最多一条。
- 每条末尾带上它有的链接，放在一对括号里，按 issue、PR、plan 的顺序。只用 `changelog.ts` 给的字段拼：`repo`、`commit`、号、`plan`。不从标题、摘要或别的文字里抄链接。
  - issue：`[#<N>](https://github.com/<repo>/issues/<N>)`
  - PR：`[PR #<N>](https://github.com/<repo>/pull/<N>)`
  - plan：`[plan #<N>](https://github.com/<repo>/blob/<commit>/<plan>)`。`plan` 是 null 就不写。
  - 一条合了几个 PR：带上每个 PR 和它的 issue、plan。同一个链接只写一次。
  - 只从 `commits` 来的一条，不带链接。
  - 例：`- The app follows the dark mode of the phone. ([#<N>](https://github.com/acme/app/issues/<N>), [PR #<M>](https://github.com/acme/app/pull/<M>))`

然后写页头。对每个自上次发版 tag 以来正文有 diff 的 Markdown 文件：

1. 看正文的 diff，不看页头。只改了措辞、错字、链接的，跳过。
2. 页头加一条，概括这段 diff 改了什么。日期用这一版的日期。这一版的日期已经在那一条上，就不再写第二条。新的在上，留 5 条左右。
3. L1 的那一条写清改了哪几条。
4. `index.md` 里，上游正文有这种 diff 的页，「核对过」写成这一版的日期。新行留空的，也写成这个日期。
5. 版本号命令改的文件，这里不手改。
6. 依赖图的 `Now:` 不在这一步改。会话改图时已经写过。

然后删做完的 plan、它们的报告和依赖图里打了 ✅ 的项，跑链接检查和测试，提交，打 tag：

```bash
git add VERSION CHANGELOG.md <版本号命令改的别的文件> <写了页头或「核对过」的文件>
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/cleanup.ts
node <本 skill 目录>/scripts/links.mjs
<项目配置 Tests 一节的全部命令>
git commit -m "version: $(cat VERSION)" &&
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write version-commit
git log --format='%h %s' origin/main..HEAD^    # 发版内的修复
git tag -a "$(cat VERSION)" -m "$(cat VERSION)" [-m "Seen by the owner: …"] [-m "Fixes inside the release: <sha> <subject>, …"] &&
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write tagged
```

- 先 stage 版本号的改动。版本号命令改了哪些文件，看 `git status`：发版 worktree 里只有这一版的改动。
- `cleanup.ts` 做四件事（L2-release §2.8）：
  - 删做完的 plan：`knowledge/plan/<N>-<slug>.md`，每个 `##` 节点的标题都有 ✅。没有号的里程碑的 plan 不删。
  - 删这些 issue 的 deep-verify 报告，和号对应的 issue 在 `main` 上没有 plan 的报告。没有号的报告留着，记一条 warning：每份报告都该写上它的 issue 号。
  - 删它们在 `knowledge/index.md` 里的那一行。每个 Markdown 文件里指向它们的相对链接，改成 `HEAD` 上的永久链接，锚点不变。
  - 删依赖图 `knowledge/plan/index.md` 里打了 ✅ 的项：图上字以 ✅ 结尾的节点，提到它的每一行图；表里第一格以 ✅ 结尾的行。一行图删了，行上还留着的节点，它的字留成单独一行。标法在 `knowledge` 的 [spec-and-plan.md](../knowledge/references/spec-and-plan.md)「依赖图」。
- 它把删的、改的都 stage 好：暂存区就是版本号那次提交。它打印一份 JSON：`remove`（删了哪些、为什么）、`kept`（还没做完的 plan）、`rows`、`graph`（依赖图里删的行；`to` 不是 null 的，换成了留下的节点）、`links`、`changed`、`mentions`、`warnings`、`stop`。
  - `stop` 不是 null：停，原话告诉 owner。它什么都没改。多半是一个修复改了要改链接的文件，还没提交。
  - `mentions`：别处还提到这些文件、它没改的地方（代码、不是 Markdown 的文件、裸路径）。`warnings`：删掉的 plan 里，✅ 的标题下还有 `- [ ]`；依赖图里一行有几个箭头，整行删了。照常往下，回复里列出来。
  - 只想看会删什么：加 `--dry-run`，它只打印。
- 链接检查和 Tests 红了：照「发版内的修复」修，再跑一次。还红就停在打 tag 之前。
- 这次提交还有页头和「核对过」：版本号的改动、`CHANGELOG.md`、页头、`index.md` 的「核对过」、`cleanup.ts` 删的和改的文件。
- tag 的说明：有 `seen` 就加那一行；`origin/main..HEAD^` 不空就加修复那一行，每个修复写 SHA 和 subject。
- `CHANGELOG.md` 里这一版的那一节，原样放进给 owner 的回复（「做完」）。不为它停。

## 5. 推之前的本机步骤

项目配置 Before push 一节里，属于第 1 步 `steps` 里那些区域的步骤，和区域写着 `every release` 的步骤，按顺序做。比如传 TestFlight。

全过了，记下 `before-push-done`。

失败就停在推之前。tag 留在本地，记下的点还是 `tagged`。下一次从「接着上次」开始，照项目配置那张表的「失败后从哪重跑」接着做。

### 推之前的检查红了

一个本机步骤要改代码才能过：tag 还没推，这个号没用过（L2-release §1「A check that fails after the tag」）。

```bash
V="$(cat VERSION)"
VC="$(git rev-parse "$V^{commit}")"   # 版本号那次提交
git ls-remote --exit-code --tags origin "refs/tags/$V"; rc=$?
if [ "$rc" -ne 2 ]; then echo "STOP: ls-remote exit $rc (0: $V is on origin, used; else: origin cannot be read)"; exit 1; fi
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write refix &&
git checkout --detach "$VC^" &&
git tag -d "$V"                       # 只删本机的：它从没推过
```

1. 动之前，查 origin 上有没有这个 tag：`git ls-remote --exit-code` 退出码 2 是没有，才往下。0：这个 tag 在 origin 上，这个号用过了，停，说出来，不删、不挪。别的退出码：读不到 origin，停，说出原话。上面那段在这两种时自己停（`exit 1`），不跑后面三行。
2. 记下 `refix`，再挪 worktree，最后删本地的 tag：tag 删之前一直指着版本号那次提交，中途停了，「接着上次」的 `refix` 那一行从它找回 `$VC`，把这一段做完。
3. 照「发版内的修复」修、提交。
4. 再做一次第 4 步（又记下 `bump`）：再跑一次版本号命令。它从同一个旧的 `VERSION` 算：同一天得出同一个号；过了午夜，号按日子算，得出新一天的号，照用（删掉的号没推过，没用过）。不手改 `VERSION`。它的 CHANGELOG 一节和 tag 的说明都列出这次修复。只在这个号用过了（「接着上次」）时才再 bump。
5. 再从第 5 步接着做。

## 6. 推 main，再推这一个 tag

```bash
git push origin HEAD:main &&
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write main-pushed &&
git push origin "$(cat VERSION)" &&
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/state.ts write tag-pushed &&
node --experimental-strip-types --no-warnings <本 skill 目录>/scripts/release-var.ts write "$(cat VERSION)"
```

- 先推 `main`，再推 tag：tag 触发的活要查 tag 在 `main` 上。
- 推完 tag，写发版变量 `RELEASE=<tag> <tag 的提交的 SHA>`（L2-release §0）：`release-var.ts write` 用 owner 的 `gh` 登录写，再读回来比对，打印一行。不在推 tag 之前写：读的一方查 tag 在 origin 上、在变量的 SHA 上，先写了，到推完之前每个读的一方都会停。
  - 它停了（打印 `stop: …`、退出码 1），什么都不写：变量指着更大的版本（从不拿旧的一版盖新的）、同一版却在别的提交上、读不到变量、tag 不在 origin 上或不在 `origin/main` 上、读回来的不一样。停，原话告诉 owner。下一次从 `tag-pushed` 接着写。
- 只推刚打的这一个 tag。不 `--tags`，不 `--force`。
- 每推过一次就记下（上面那段，用 `&&` 连着）：`main` 推过了记 `main-pushed`，tag 推过了记 `tag-pushed`。一次推被拒了，后面的都不跑。
- origin 拒了 `main`，因为 origin/main 又动了：
  1. `git fetch origin`，记下 `merge`，再 `git merge origin/main`（不 rebase：tag 要留在它的提交上）。从这里到推过 `main`，停了都是 `merge` 那一行：tag 不动，不再跑 Before push。
  2. 再跑 `cleanup.ts`。merge 进来的新链接，指向这一版删掉的文件的，它改成版本号那次提交的前一个提交上的永久链接。依赖图里新打了 ✅ 的项，它也删。
  3. 它改了文件（`changed` 或 `remove` 不空）：`git commit -m "Merge follow-up: links"`。它停了：停，说出是哪几个文件。
  4. 跑链接检查和 Tests。红了：tag 不动（它的提交过了第 3–5 步，第 5 步已经把它发出去了）。在 merge 上面修，提交只点名修的文件：`git commit -m "Merge follow-up: <修了什么>" -- <文件>`，再跑一次。还红就停；链接检查红了，说出是哪几个文件。
  5. 再跑一次上面那段：推 `HEAD:main`、记 `main-pushed`、推 tag、记 `tag-pushed`、写发版变量。
- 别的拒绝：停，原话告诉 owner。

## 7. 推之后的本机步骤，看 run

1. 项目配置 After push 一节里，属于 `steps` 那些区域的步骤，和区域写着 `every release` 的步骤，按顺序做。比如在 owner 的机器上重装 plugin。全过了，记下 `after-push-done`。失败了只重跑那一步：停，worktree 留着、解锁，记下的点还是 `tag-pushed`。
2. 列出 tag 触发的 run：

   ```bash
   gh run list --commit "$(git rev-list -n 1 "$(cat VERSION)")" --event push --json workflowName,status,conclusion,url
   ```

   跑完的，说哪个过了、哪个没过，给没过的那个链接。还在跑的，给链接。一个 run 都没有（比如这个项目推 tag 不触发任何活），说一句「这个 tag 没有触发 run」。
3. 删掉发版 worktree：

   ```bash
   git -C "$MAIN" worktree unlock "$REL"
   git -C "$MAIN" worktree remove "$REL"
   ```

## 做完

告诉 owner：

- 版本号和 tag，和发版变量（`release-var.ts` 打印的那一行）。
- `CHANGELOG.md` 里这一版的那一节（原样）。
- 发版内的每个修复：SHA、subject、文件；只改了测试的，说一句。每个 `Merge follow-up` 也这样列（链接，或一次修复）：它在 tag 之后，tag 的说明列不到它。
- 主目录里没进这一版的改动（第 2 步）：没提交的文件；没推的提交，写「put them on a branch and a PR」。
- 删了哪些 plan、报告和依赖图的项，`cleanup.ts` 的 `mentions` 和 `warnings`（如果有）。
- 这一版做了哪些本机步骤，tag 触发的 run 怎么样，哪些 tag 不算（如果有）。

## 不做的事

- 不在会话之外发版。工作循环里的 agent 不叫这个 skill（只有 owner 发版）。
- 不在主目录里发版：不在那里提交、切分支、stash。
- 不从 git 的样子猜上次停在哪：只看记下的点（「接着上次」）。
- 不挪、不删 origin 上的 tag。推上去的号用过了。只在本机、从没推过的 tag 可以删（「推之前的检查红了」）。不挪推上去的提交。
- 不拿 `main` 的头去手动跑发版的活。急着上线：发一版。
- 项目自己才知道的事（签名、测试员、撞过的坑）不写进这里，写在项目配置里。
