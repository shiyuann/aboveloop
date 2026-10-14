# issue 的模板

> 开 issue 的都读这一份：owner、会话里的 agent，和不用模型的脚本（比如管道）。

所有开 issue 的都照这个模板。脚本用同样的五个标题；Report 一节写一句是哪个脚本、哪一轮开的，链到那一轮。项目不另抄一份模板，链到这一页。为什么：一份模板，改一处就够，不用在每个项目里各维护一份。context 在开的那一刻写齐，没有「事后再补」这一步。

正文用英文，写给 builder 和 owner 读。照 [entry](../SKILL.md) 的「怎么写、怎么答」和「ASD-STE100」两节写：先说结论，句子短，一句一件事。

```markdown
## Problem

<一两句：哪个画面或哪条数据，什么不对；或者想要什么>

## Report

From <the owner | a session of the owner | 哪个脚本、哪一轮>, <日期>.

> <owner 的原话，原样>

<img src="<截图的 url>" width="300" alt="Screenshot 1">

Screenshot 1: <哪个画面；圈了或指了什么>.

## Evidence

- <一个事实和它的来源：已发布数据里的值和链接、官网那一页写的值、日志>

## Impact

<影响谁、哪几条数据、哪几个版本、多急>

## Done when

<一个看得到的结果>

Opened by <who>.
```

- **Problem**：用用户看得到的词：画面、按钮、数据。不写代码、文件名、内部的 id。
- **Report**：谁报的、哪天。
  - owner 在会话里说的：写 `From the owner, <日期>.`，下面是原话的引用块，原样贴，每行前面加 `> `。builder 只读 issue，原话不在 issue 里就丢了。
  - 脚本开的：一句是哪个脚本、哪一轮，链到那一轮。没有原话。
  - 有截图，照模板写成 `<img>`：GitHub 照常显示，宽 300 的手机截图不会占满一页。每张图下面一行，写它是哪个画面、圈了什么。不把图里的字全抄一遍。
  - 日志不贴图，写成链接 `[<文件名>](<url>)`。要紧的几行贴进 Evidence。
- **Evidence**：只写决定做不做要用的事实，每条指得回来源。代码在哪不用写，explore 会补。不写查的过程（查了哪些 issue、哪天查的）。一个已有的 issue 容易和这个混，才写它，一句说哪里不同。
- **Done when**：想法写验证方案：先试什么，什么结果算成立。
- **标题**：一句话说问题，不加前缀。谁开的看最后一行。
- **署名**：最后一行写谁开的，比如 `Opened by the owner.`、`Opened by a session of the owner.`、`Opened by <脚本名>.`。
- **label**：开 issue 时不在 `POST /issues` 里带 `labels`：没有 push 权限的 token，GitHub 会悄悄丢掉（文档：「Labels are silently dropped otherwise」）。开完再打：`gh api repos/<owner>/<repo>/issues/<N>/labels -f 'labels[]=<label>'`。
- **为什么紧急**：只有不用模型的脚本开 issue 时直接带上 `ready-for-auto-builder` 才写（[L2-loop-builder §3](../../../knowledge/spec/L2-loop-builder.md#3-the-labels-explored-and-ready-for-auto-builder)）：命中项目 spec 里的哪条规则、证据（数字、哪一轮）、链接。开的时候就写进正文；之后情况变了，加一条新评论，不改正文。
