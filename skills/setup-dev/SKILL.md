---
name: setup-dev
description: >-
  装好 / 更新 / 检查 aboveloop 本身。项目的 AGENTS.md 指名的通用约定读不到、
  新机器第一次接进来、换了 coding agent、装最新一版、或者刚发的一版坏了时跑。
  `entry` skill 每次会话会来这里取一行状态。
  Use when the user says 配环境, setup dev, 装 aboveloop, 更新 plugin, 通用约定读不到,
  装最新一版, 版本坏了, or 改完 aboveloop 怎么生效.
---

# setup-dev

只管 **aboveloop 这个 plugin 自己**怎么装、怎么更新、怎么确认没过期。

不管 plugin 里有什么 —— 那看 plugin 自己（`claude plugin details aboveloop@aboveloop`）。
在这里抄一份清单，加一个 skill 就过时。

也不管代码依赖，那是 `npm install`。

---

## 一、状态检查（`entry` skill 每次会话跑一次）

```bash
bash "<这份 SKILL.md 所在目录>/status.sh"
```

**总是打印一行**，原样念给用户，不要改写、不要省略：

```
aboveloop · 20261012.3 · 已是最新一版（4 个 commit 还没发版）
aboveloop · 20261012.2 · **装的是旧的**，最新一版是 20261012.3 —— 跑 `make -C <aboveloop 工作副本> sync`
aboveloop · 20261011.7 · 读的是工作副本（还没发过版）（314 个 commit 还没发版）
aboveloop · 20261012.3 · 检查失效：工作副本 <路径> 读不到
```

- 说「装的是旧的」：照它给的命令跑一遍，然后告诉用户**要重启会话**才生效。
- 「还没发版」的 commit 不是毛病：一版就是一个 tag，改动等 owner 下一次 `prerelease` 才到会话里。agent 不替 owner 发版。
- 说「检查失效」：当它落后处理，**不要**当成「已是最新」。

### 为什么这样比

一版 aboveloop 是一个发版 tag（`knowledge/spec/L2-release.md`）。owner 的会话读 Claude Code 缓存里装好的那一版：marketplace 从 GitHub 来，钉在 tag 上。缓存以版本号为 key（`~/.claude/plugins/cache/<marketplace>/<plugin>/<版本>/`），版本号只在发版时变。所以状态行比的是装好的版本号，对工作副本里最新的发版 tag；只有真有更新的一版，才说装的是旧的。

它不联网：用工作副本本地已知的 tag。工作副本是 marketplace 指着的目录（还没切到 GitHub 时），不然是 `$ABOVELOOP_DIR`（默认 `~/workdir/aboveloop`）。

---

## 二、装最新一版

```bash
make -C <aboveloop 工作副本> sync
```

它先校验，再装最新一版（`scripts/install-release.sh`）：

- Claude Code：marketplace 不是钉在这个 tag 上的 GitHub（是本地目录，或钉在别的 tag 上），就先 `claude plugin marketplace remove aboveloop`，再 `claude plugin marketplace add "shiyuann/aboveloop#<tag>"`，再 `claude plugin install aboveloop@aboveloop`；已经钉在这个 tag 上，就只 install、update。最后查装好的那份就是 tag 的提交（`installed_plugins.json` 的 `gitCommitSha`）。为什么先 remove：user settings 的 `extraKnownMarketplaces` 登记着旧 tag 时，直接 add 新 tag 会被拒；本地目录也不让原地换成 GitHub。remove 把 settings 里那一条和 plugin 一起拿掉；add、install 之后 settings 写的是新 tag，plugin 仍是 enabled（实测过，L2-plugin §3）。不手改 settings 文件。
- Cursor：把 tag 那棵树真拷贝进 `~/.cursor/plugins/local/aboveloop/`（见第四节）。

不推版本号。版本号只在发版时推：`prerelease` 第 4 步跑 `make bump`。发版之后，`prerelease` 照项目配置的 After push 一节跑这一步（`make install-release`），平常不用手动跑。

跑完**重启会话**才生效。这一轮里新内容还读不到是正常的，跟用户说清楚。

---

## 三、一版坏了：逃生

刚发的一版让会话读不了规矩、或 skill 坏了：这一次会话直接读工作副本。

```bash
claude --plugin-dir ~/workdir/aboveloop
```

`--plugin-dir` 的那份盖过装好的同名 plugin，只管这一次会话（实测过：`claude --plugin-dir <目录> plugin details aboveloop` 显示的是那个目录的版本，源是 `aboveloop@inline`）。修法是 revert，再发一版。不要把 marketplace 改回本地目录。

> **第一次装不在这份文档里。** 那两行命令在 aboveloop 的 `README.md` 和各项目的
> `AGENTS.md` 里 —— plugin 没装的时候
> 这个 skill 不存在，写在这儿的安装说明恰好在需要它的那一刻读不到。同理，`marketplace add`
> 失败时怎么查凭证也在 `AGENTS.md`：失败的人打不开这一页。
>
> **这份管「装上之后」，`README.md` 和 `AGENTS.md` 管「还没装」，两边不重叠。**

## 四、Cursor

Cursor 没有装 plugin 的命令行入口（`cursor-agent` 没有 `plugin` 子命令）。按官方的本地
plugin 布局，**整个 plugin** 放进 `~/.cursor/plugins/local/<名字>/`。`make sync` 拷的是发版 tag 那棵树：

```bash
git archive <tag> | tar -x -C <临时目录> && rsync -a --delete --exclude '.env.*' <临时目录>/ ~/.cursor/plugins/local/aboveloop/
```

然后 **Developer: Reload Window**，去 **Customize** 里确认 skill 真的出现了。
不要只看 `rsync` 的退出码 —— 拷过去但没加载，从输出看和成功一模一样。

**必须是真拷贝，不能用符号链接。** 官方写明：`~/.cursor/plugins/local` 里的符号链接只有在
目标落在这个文件夹**内部**时才加载，指向别处的 plugin 仓库会被直接跳过。

**也不要往 `~/.cursor/skills/` 里塞单个 skill 目录。** 那里是 Cursor 自己从 AgentStores
同步下来的镜像，不是给人手放东西的地方 —— 放进去会被下一次同步清掉，而且分散的 skill
目录不是一个 plugin。

---

## 五、验收

**不要只看退出码。** 装上但没加载，从命令输出看和成功一模一样。

```bash
claude plugin details aboveloop@aboveloop
```

能打印出 plugin 信息、状态 enabled，才算成。打不出来就报给用户，不要说「装好了」。

---

## 六、排障

| 现象 | 多半是 |
| --- | --- |
| 状态行说「装的是旧的」 | 有更新的一版没装。跑 `make sync` |
| 改了 aboveloop，会话里读不到 | 正常：改动等下一版。owner 发版（`prerelease`）之后才到 |
| skill 这一轮读不到 | 正常，plugin 下次会话才加载 |
| 刚发的一版坏了 | 第三节：`claude --plugin-dir ~/workdir/aboveloop`，revert，再发一版 |
| 状态行说「检查失效」 | 按落后处理，跑 `make sync`；还是不行就重装 |

---

## 七、项目接上工作循环

装好 aboveloop 之后，再看一眼当前项目接没接上工作循环。只看 owner 自己的项目（仓库在 owner 的账号下）。

```bash
cmp "<本 skill 目录>/../setup-app/references/loop.yml" "<项目根>/.github/workflows/loop.yml"
```

文件不在，或 `cmp` 说不一样，就跑 `setup-app` skill。一样就什么都不做。
