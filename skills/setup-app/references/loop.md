# setup-app · loop

把这个 app 的仓库接上 workflow `loop.yml` 和 builder loop 的自动模式（CI 那一部分）。总的顺序和要先问的在 [SKILL.md](../SKILL.md)；设计在 aboveloop 的 [L2-loops](../../../knowledge/spec/L2-loops.md) 和 [L2-loop-builder](../../../knowledge/spec/L2-loop-builder.md)。

### 1. label 和仓库设置

两种 label（[L2-loop-builder §3](../../../knowledge/spec/L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder)、[§4](../../../knowledge/spec/L2-loop-builder.md#4-labels-that-describe-an-issue)）：

- builder loop 靠两个 label 过滤 issue：explore 做完的打 `explored`；交给 CI 自动做的打 `ready-for-auto-builder`。它不是 sign-off。
- 描述 issue 的 label，形式是 `名字: 值`：`Kind: <kind>`（explore 打）。
- 描述 PR 的 label：`Mode: automatic` 或 `Mode: semi-automatic`、`Agent: cloud` 或 `Agent: local`、`auto-builder`（开 PR 的 agent 打，[L2-loop-builder §4.1](../../../knowledge/spec/L2-loop-builder.md#41-labels-that-describe-a-pr)）。

1. 建 [labels.tsv](labels.tsv) 里的每一个（名字、颜色、说明，用 tab 隔开）：

   ```bash
   while IFS=$'\t' read -r name color desc; do gh label create "$name" -R <owner>/<repo> --color "$color" --description "$desc" --force; done < <本 skill 目录>/references/labels.tsv
   ```

   `--force` 让已有的同名 label 只更新颜色和说明，不报错。

2. 项目配置 `.agents/builder.md` 的 Kinds 里每一类，建一个 `Kind: <kind>`：颜色 `FEF2C0`，说明是那一类是什么的一句（不超过 100 个字符）。还没有项目配置，就等第 5 步写好再建。
3. 打开仓库设置「Automatically delete head branches」：PR merge 之后，GitHub 删掉它的分支（[L2-loop-builder §5](../../../knowledge/spec/L2-loop-builder.md#5-the-branch-the-pr-and-the-plan-of-an-issue-)）。本地的分支和 worktree 由 agent 自己删。

   ```bash
   gh repo edit <owner>/<repo> --delete-branch-on-merge
   ```

owner 想交给 CI 自动做的 issue，自己打上 `ready-for-auto-builder`；项目配置允许的，explore 也会打。

做完的样子：`scripts/check.sh` 的 label 那几行都是 `exists`（`gh label list --search` 刚建完可能还搜不到，别用它判断）；`delete head branches` 那一行是 `on`。

### 2. 放进 loop workflow

把本 skill 目录下的 `references/loop.yml` 原样拷成项目的 `.github/workflows/loop.yml`，一个字也不改。项目之间的差别全在第 3、4 步的变量和钥匙里。

- 和第 5 步的文件一起，在项目里提交（只 add 这两个路径）。
- schedule 和 `workflow_dispatch` 只认默认分支上的文件。照 `builder` 的 implement.md 在 issue 的分支上提交、开 PR；owner merge 进 main 以后，第 6 步才测得了。

做完的样子：`cmp <本 skill 目录>/references/loop.yml <项目根>/.github/workflows/loop.yml` 没有输出；`gh workflow view loop.yml -R <owner>/<repo>` 找得到它。

### 3. 变量

项目仓库只有一个变量 `GH_APP_ID_DEV`（loop 的 GitHub App 的 ID）：第 4 步的 `make loop-secrets` 从 `loop.env` 把它一起设好，不用另设。

做完的样子：`gh variable get GH_APP_ID_DEV -R <owner>/<repo>` 打印 App 的 ID。

### 4. 钥匙

`CURSOR_API_KEY` 和 `GH_APP_ID_DEV` 各存一次：写进 `~/.config/aboveloop/loop.env`（直接编辑，或在 aboveloop 里跑 `make loop-key NAME=<名字>`，提示时粘贴）。`make loop-key NAME=GH_APP_KEY_DEV` 不存，只说把文件拷到 `~/.config/aboveloop/github-app.pem`。不放进 aboveloop 文件夹：`claude plugin update` 连 gitignored 的文件一起拷进 plugin 缓存。值不进聊天、不进仓库。然后你跑：

```bash
make -C <aboveloop 工作副本> loop-secrets REPO=<owner>/<repo>
```

| Secret | 用户怎么做 |
| --- | --- |
| `CURSOR_API_KEY` | cursor.com/dashboard → API keys → 新建一把 |
| `GH_APP_KEY_DEV` | 不用新做：loop 的 GitHub App 的私钥，在 `~/.config/aboveloop/github-app.pem`，`make loop-secrets` 直接读那个文件。`make loop-key NAME=GH_APP_KEY_DEV` 不存。同时设变量 `GH_APP_ID_DEV`（`make loop-key NAME=GH_APP_ID_DEV` 写入 `loop.env` 的那一行）。每次运行 `loop.yml` 用它造几把一小时的 token，每个 job 一把，权限只够这个 job：explore 是 Contents 只读、Issues 写；implement 是 Contents、Issues、PR 写，没有 `workflows`。agent 拿自己 job 的那把当 `GH_TOKEN`，另拿一把只读 aboveloop 的 `GH_TOKEN_KIT`（读 skill） |

- **把 loop 的 GitHub App 装到新仓库上**（agent 都向它要 token）。用户做：GitHub → Settings → Developer settings → GitHub Apps → `<你的 GitHub App>` → Install App → 装了它的账号旁边的齿轮 → Repository access 里加上这个仓库 → Save。不用重存钥匙。`check.sh` 会以 App 的身份问 GitHub 装没装。
- **这个 App 要有 Variables 只读，没有写**：每个 `loop.yml` 都用它读发版变量 `RELEASE`（[L2-release §0](../../../knowledge/spec/L2-release.md#0-terms)）。只有 owner 的登录写这个变量，loop 的 token 都写不了（§2.3）。App 是全局的，设一次就够（[L2-release §5](../../../knowledge/spec/L2-release.md#5-the-owners-part)）。`check.sh` 各给一行：loop 的 GitHub App 是 Variables 只读；Cursor GitHub App 没有 Variables 权限。
- `loop.env` 里已有的钥匙不用再存；新项目一般只要用户做上面这一条。
- 钥匙过期了，循环的那一步就停：照 [keys.md](keys.md) 第 2 节换。

做完的样子：`gh secret list -R <owner>/<repo>` 列出这两个名字（只看名字，值读不到也不打印）。

### 5. 项目配置 `.agents/builder.md`

在项目里写 `<项目根>/.agents/builder.md`，英文，按 ASD-STE100（`entry` 的「ASD-STE100」）。`builder` 的三步（explore、spec、implement）都读它。分两部分。

**Explore**（问用户，aboveloop 不替项目定）：

- **Kinds**：这个项目的 issue 分哪几类，每类去哪里查（代码、数据、日志、官网）、Explore 一节要写清什么。只有一类也可以。
- **Auto-ready**：哪几类、什么条件下 explore 可以自动打 `ready-for-auto-builder`。不写就是从不自动打，全等 owner。
- **Light spec**：哪几类、什么条件下 spec 那一步走轻的（只写一份短 plan，不改 spec，没有 D 和 deep-verify；`builder` 的 spec.md）。从 Auto-ready 的那几类和它们的条件起步，条件照抄过来。没有就写「None」。不写这一节，就没有一类是轻的，每个 issue 都走重的 spec。

**Implement**：

- **Tests**：跑哪几条命令（照 `AGENTS.md` 和 Makefile，亲手跑一遍确认能过），基线红的是哪些。
- **Evidence**：除了测试，PR 里还要什么（截图、数据 diff），怎么拿、放哪。
- **Do not**：这个项目里 agent 不能碰的东西（钥匙、发版、线上数据、要人工跑的命令）。

做完的样子：文件在，两部分都有（Auto-ready、Light spec 可以写「None」），测试命令真的跑通过。和第 2 步一起提交。

### 6. 测一遍

**CAUTION:** 不带 `dry_run=true` 的一轮会开 Cursor agent，花钱。先 dry run。

```bash
gh workflow run loop.yml -R <owner>/<repo> -f step=all -f dry_run=true
gh run list -R <owner>/<repo> -w loop.yml -L 1
gh run watch <run id> -R <owner>/<repo>
gh run view <run id> -R <owner>/<repo> --log
```

做完的样子：这一轮绿；日志里有 `implement: <n> open issues with the label ready-for-auto-builder`，没有开任何 agent。日志说缺哪个变量或钥匙，回第 3、4 步补，再跑一次。

最后 `gh workflow view loop.yml -R <owner>/<repo>` 是 active（不是就 `gh workflow enable loop.yml -R <owner>/<repo>`），让它按时跑。

报告：label 建好没有、设了哪些变量和钥匙（只写名字）、dry run 的链接，还有交给用户的那几样做没做完。

### 7. 可选：项目配置 `.agents/dev.md`

`dev` 的排序（会话开工的 top 5）默认是：不是 owner 推的 push 最先；然后紧急的（`loop.yml` 失败的运行；默认没有算紧急的 label）、已经开始的活、其他 issue（从小到大）。只有 owner 要这个项目换一种排法（哪些 label 算紧急、三组的先后、按哪些 size label 给 issue 排大小）的时候，才写这个文件。不是就不写：和默认一样的文件只是默认的第二份。

格式见 aboveloop 的 [L3-loop-dev §3](../../../knowledge/spec/L3-loop-dev.md#3-the-project-configuration-agentsdevmd)：英文，按 ASD-STE100。一节 `## Rank`：下面最多三小节 `### Urgent`、`### Order`、`### Size`，每行一个反引号里的值。不是 owner 推的 push 和失败的运行，项目改不了。

和第 2 步一样，在 issue 的分支上提交。

做完的样子：`scripts/check.sh` 的 `.agents/dev.md` 一行是 ✓；没有这个文件是 `·` default rank。`dev` 读不懂的 `## Rank`，会话开工用默认的排法，给 owner 的第一行写一句。
