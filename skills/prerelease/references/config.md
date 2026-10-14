# 项目配置 `.agents/prerelease.md`

每个项目一份，放在项目根的 `.agents/prerelease.md`。`prerelease` 每次都读全部几节。项目用不着的一节，写一行「None」，不删标题。没有这份文件，或少了一节，`prerelease` 就停，说出少的是什么。

几节的意思在 aboveloop 的 [L2-release §3](../../../knowledge/spec/L2-release.md#3-the-project-configuration-)。下面是一份例子，项目叫 `my-app`。照着改，标题和表头不改：`scripts/scope.ts` 和 `scripts/changelog.ts` 按它们读。

````markdown
# prerelease: my-app

## Areas

改了哪些路径，这一版就要做哪些本机步骤。路径写在反引号里，`**` 是任意层，`*` 不跨目录。一个文件只算进第一个匹配的区域。哪个区域都不匹配的文件照样发，只是不触发本机步骤。

| Area | Paths | Local steps |
| --- | --- | --- |
| mobile | `mobile/**`, `packages/**` | TestFlight 上传（Before push） |
| docs | `*.md`, `knowledge/**` | None |

## Release worktree

发版 worktree 新建、或挪到 `origin/main` 之后，在它里面跑：

1. `npm ci`
2. 从主目录的 `.env.local` 只拿上传要的两行：`grep '^ASC_' <主目录>/.env.local > .env.local`。别的钥匙不拿。

## Version

`make bump`：只改版本号文件（根目录 `VERSION`，和从它抄值的 `package.json`），`VERSION` 最后改。

## Changelog

None

## Tests

`make test`。全部要过。

## Before push

| Step | Area | Command | 失败后从哪重跑 |
| --- | --- | --- | --- |
| TestFlight 上传 | mobile | `make ios-release` | archive 失败：`make ios-archive` 起；upload 失败：`make ios-upload` |

## After push

None
````

- **Release worktree**：发版在自己的 worktree 里跑（`<主目录>-release`，从 `origin/main` 开）。新的 worktree 里没有装好的依赖，也没有主目录里被 ignore 的文件。这一节写本机步骤要的：装依赖的命令，从主目录拿哪几个文件、哪几行。只拿用得着的，不拷整份 `.env`。用不着就写「None」。
- **Version**：版本号命令只改版本号文件，最后才改 `VERSION`：中途停了，`VERSION` 没变，下一次就再跑一次这个命令。
  - 发版不生成数据文件。生成的数据（比如打包的快照）平时走 PR 刷新，测试在 PR 里跑。
  - 改源码的命令（比如格式化）不在发版里跑：哪个会话改的，哪个会话格式化。
  - 号用过没有，除了 origin 上的 tag 还要看别处的（比如 TestFlight 的 build 号），写在这一节。
- 配置里没有 Commit 一节：发版只提交点了名的文件（版本号文件、`CHANGELOG.md`、`cleanup.ts` 改的、发版内的修复改的）。
- **Tests 不按区域挑。** 每次发版全跑。红了，`prerelease` 先在发版里修（「发版内的修复」），还红才停。
- **Before push** 和 **After push** 的每一步，写它属于哪个区域：这个区域这一版没改，就跳过。每一版都要做的，区域写 `every release`。写清失败后从哪一步重跑，`prerelease` 照着接着做，不重新打 tag。要改代码才能过的，`prerelease` 照它的「推之前的检查红了」做：删本机的 tag，修，同一个号再做一次第 4 步。
- **After push** 的步骤失败了，只重跑那一步，不出新版本。
- **Changelog** 一节放 `prerelease` 写 `CHANGELOG.md` 之前要跑的命令。没有就写「None」。`CHANGELOG.md` 里每一版的那一节，由 `prerelease` 第 4 步写。
- **发版时 GitHub Actions 跑的活（release job）不写在这里。** 它们在项目的 workflow 里，tag 推上去就跑。workflow 本身就是记录（P4）。
- **项目自己才知道的事**（签名、测试员、撞过的坑）写在这份文件里，不写进 `prerelease`。
