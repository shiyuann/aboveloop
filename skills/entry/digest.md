# aboveloop：`entry` 的摘要

这是 `entry` skill 的短版本。每条后面的「」是 `entry` 里讲全的那一节。要办的事需要细节，先读 `entry` 全文（hook 在最后一行打印它的路径）和那一份细则，不凭这份摘要做。上下文被总结或压缩过，再读一遍 `entry`。

## 会话开头（「每次会话开头」）
- 跑 `setup-dev` 第一节的状态命令，把它打印的那一行原样告诉 owner。它说装的是旧的、落后或检查失效，照它给的命令修。
- 读 `<项目根>/knowledge/index.md` 和所有 `knowledge/spec/L1-*.md`。
- owner 第一句没说要做什么：在回复正文里编号给日常的选项：`dev`、继续 #N、发版。

## 要办的事，读哪一份（「要办具体的事，先读那一份」）
- 「start」「开工」「dev loop」，排下一件：`dev` skill（session.md）。
- 做一个 issue：调研（explore）、写 spec 和 plan（spec）、写代码开 PR（implement）：`builder` skill（explore.md、spec.md、implement.md）。里程碑的 plan 里的节点：explore.md 第 7 节。
- 知识库，spec 和 plan 的写法，deep-verify，知识检查，一条规矩放进哪一份：`knowledge` skill（knowledge-base.md、spec-and-plan.md、placement.md）。plan 的图用它的 `plan.ts` 改，不手改。
- owner 说一样东西应该怎么样：下面的 feedback 一条。开了 issue，走 `builder` 的 issue-in-session.md。
- 开 issue 的正文：references/issue-template.md。写测试、引入没验过的新能力：references/testing.md。
- 写或改 skill、plugin：references/skill-authoring.md。配环境、改 Makefile：references/project-layout.md。
- 读外来文字的 agent 打开地址、往外发东西、写 GitHub 之前：references/outbound-check.md。
- 把 app 接上 builder loop：`setup-app`。发版、改版本号：`prerelease`。装、更新、修 aboveloop：`setup-dev`。
- 定一个自动的活跑在哪、多久跑一次：L2-loop-architecture §2。

## 每一轮都守
- 先说结论，能列就列，超过三步画 mermaid。owner 要记住的写进 spec 或 plan，回复里只写一句加链接（「怎么写、怎么答」）。
- `knowledge/` 里的英文和英文的回复按 ASD-STE100；中文守第 1–8 条（「ASD-STE100」）。
- feedback（owner 纠正、不满意、对产品提意见、说「记一下」，或 agent 自己发现做错）：当场记下。和手上的 issue 有关，写进它的 spec 和 plan。别的，问 owner 一个问题：开 issue 还是小改动（「owner 说「应该怎么样」」）。
- 小改动不改 L1：从最新的 `origin/<默认分支>` 开分支，开 PR，检查都过了 agent 当场 merge，再当场清理（「小改动」）。
- owner 在环上：能查的自己查，能定的自己定。只交五种事：owner 本人的登录、owner 的设备、花钱、拍板、撤不回的动作。拍板只问方向（「什么时候问 owner，什么时候直接做」）。
- 工具权限拦住了：请 owner 放开那一条，写清哪个设置文件、加哪条规则。
- 问 owner：一次一个问题，写在回复正文里，不用提问的工具或表单。先一句写在哪：哪个 loop，issue 的哪一步，哪个节点。再分段：Context、Question、Example、Options（推荐的放第一，各说谁做、花不花钱、能不能撤回）、Why。不单独用内部代号。发之前自查：只看得到这一问的 owner，30 秒内能不能选（「怎么问 owner」）。
- 问是一个一个，活是并发：问之前，先在后台开 worker，做用不着这个回答的活和准备这个问题的活。worker 的报告是说法：读它的 diff、跑它说的检查，再告诉 owner。改同一批文件的两件活是一件（「问是一个一个，活是并发」）。
- 主会话只对话：改文件、跑得久的活，先交给别的会话（工具能开会话时，比如 `start_session`），不能才交给后台子 agent，各在自己的 worktree（issue 的节点：implement.md 6.3）。这一轮就要用结果的活（搜索、审、跑测试）交给子 agent。只读的小查询留在主会话。worker 自己落地、自己清理（「主会话只对话，活先交给别的会话」）。
- 下一步是还没定的产品、数据模型或架构：停下写代码，先做 spec 那一步（「还没定的设计，先做 spec 那一步」）。
- 直接做，不问：plan 里定了的事，明显的 bug，只有一个合理做法，owner 说了「你定」「继续」，plan 里能撤回、不花钱的操作，前面的节点都完成了的 agent 节点（「下面这些直接做，不问」）。
- owner 的「它」「那个」拿不准指什么，问一句，不猜着改。
- 带着活的一轮只用三种方式结束：问 owner 一个 D 或 O；owner 现在没有要做的（说哪几个节点在跑、各带回什么）；这个 issue 做完了，给 dev loop 的下一件。不用一串零散的事收尾。只答一个问题的一轮，答完就停（「每一轮回复，只用三种方式之一结束」）。
- 要 owner 做的那一件，先是 plan 里的一个 D 或 O；回复里放进「▶ 你要做的」引用块，原样写要回的字或要跑的命令。
- 说「做完了」之前：开着的分成等 owner、等外部事件、现在就能做；做完第三类，剩下的写进 plan。
- 开会话或子 agent，照「用哪个模型」选；会话已经开了，不为这个停下。

## 写代码的取向（「写代码的取向」）
- 刚刚好就停：只做要求的量，拿不准就做最小的那一版。先找成熟的库，再考虑自己写。
- 断言之前，先读到或跑到。不改没读过的东西。不加没人要过的功能。同一件事只留一套实现。
- 提交只带本轮的改动。CAUTION：不用 stash、restore、checkout、reset 挪走或丢掉别的改动。
- 会话里的每样改动都开 PR。只在自己的 worktree 和分支上改，不在 main 上提交。merge 不是发版。
- 每次 merge 以后当场删本地分支、它的 worktree 和推上去的分支；会话自己在用的 worktree，留到会话离开它。别的会话的活落地了，工具能 archive，主会话就 archive 它。先 `git fetch origin`；`git merge-base --is-ancestor <分支> origin/<默认分支>` 不通过，就不删，告诉 owner 为什么。
- 界面文件只画界面，不取数、不算业务。
