# 项目骨架

> 配环境、改 Makefile、找不到一样东西该放哪时读。写 skill 或 plugin，读 [skill-authoring.md](skill-authoring.md)。词表在 [SKILL.md](../SKILL.md)。

每个项目用同一个骨架。这样 agent 找东西时，不用重新认路。

aboveloop 的约定不在项目的仓库里。agent 不用知道它存在哪。要改它，就改 aboveloop 的规矩（[feedback.md](feedback.md)）。

```
<项目根>/
  AGENTS.md          ← 约定的唯一真相，手写
  CLAUDE.md          ← 只有一行 `@AGENTS.md`
  Makefile           ← 常用命令
  knowledge/         ← 知识库（`knowledge` 的 knowledge-base.md）
  .agents/skills/    ← 本项目自己的 skill，真实的目录
  .claude/skills     → ../.agents/skills（符号链接）
```

## 一份真相，其余是指针

- `AGENTS.md` 写内容。`CLAUDE.md` 只写 `@AGENTS.md`。
- **不在 `.claude/` 或 `.cursor/` 里另写一份约定。** 两份会漂开，然后没人知道该信哪份。
- skill 也一样。真实的目录只有一个：`.agents/skills/`。有的工具只认自己的目录（比如 `.claude/skills/`），就给它加一条符号链接，指过去。不复制一份。
- 跨项目通用的约定和 skill，由 aboveloop 分发，不在项目的仓库里。项目的仓库只写这个项目特有的东西。

## 数据桶：每个 app 两个

有服务端数据的 app，在 Cloudflare R2 上只用两个桶。按「要不要登录」分：

- **`<app>-public`**：谁都能读的东西，比如发布的数据集、图片。桶挂自定义域名给客户端读。r2.dev 关着。
- **`<app>-private`**：要登录、或者只给 owner 看的东西，比如管道的状态、日志。它没有公开地址。只有 Worker 的 binding，或限定了这个桶的 token，能读它。

一个 app 的不同用途，在桶里按前缀分。比如日志只写 `<app>-private` 的 `logs/`。不为每个用途另开一个桶。一个 Worker 可以绑几个 app 的桶，但每个请求只碰它那个 app 的桶。

## 工具目录里只放配置

`.claude/` 和 `.cursor/` 只放配置，比如 `settings.json`、`mcp.json`。日志、调试输出、临时产物不放在里面：它们会被提交，会被读进上下文，而且没人清。

## Makefile：常敲的命令

Makefile 让 agent 不用再查怎么跑测试、怎么起服务。入口是 `make help`。

- **只放常敲的命令。** 一年跑一次的事，包成 target 只是多一样要维护的东西。直接敲命令。需要的话，在 `AGENTS.md` 的命令表里留一行。
- **target 是薄壳，不写逻辑。** 真正的定义在 `package.json` 的 scripts 或 `scripts/*.sh` 里。两个地方都「知道怎么跑」，就多了一个。
- **例外：封住一个坑。** 一条命令直接敲会出错（比如漏了一个环境变量就静默退出），就让 target 带上那个设置。再在 `AGENTS.md` 写一句：绕过 make 会出什么错。这时 target 的用处是封坑，不是少敲几个字。
- **help 要和 target 一致。** 手写的 help 迟早和 target 对不上。要么自动生成 help，要么让 target 少到一眼能核对完。

五六个 target 是正常的量。二十个，说明在给不常跑的事包壳。
