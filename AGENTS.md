# aboveloop

先读 `aboveloop:entry` skill，每次会话都照它做。读不到（plugin 没装），就直接读这个仓库的 `skills/entry/SKILL.md`：这个仓库就是 aboveloop 本身。改 aboveloop 的规矩，照 `entry` 的「owner 说「应该怎么样」」。

- 上下文里可能已经有 `entry` 的摘要（「aboveloop：`entry` 的摘要」）：Claude Code 的 plugin hook 在会话开始时放进来。摘要只是短版本。要办的事需要细节时，读 `entry` 全文。
- 上下文被总结或压缩过，再读一遍 `entry`：规矩在那里，总结会把它丢掉。
