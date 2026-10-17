# setup-app · 钥匙和全局的部分

owner 用自己的账号做的几样：全局的钥匙和 App 只设一次（第 1 节）；一把钥匙过期或泄露了，就换它（第 2 节）。每个 app 要用户动手的，在 [SKILL.md](../SKILL.md) 的「要用户动手的」。

每个组件是什么、在哪：aboveloop 的 [L3-loop-components](../../../knowledge/spec/L3-loop-components.md)。为什么每把钥匙都要有换法：[L2-loop-untrusted-text R20](../../../knowledge/spec/L2-loop-untrusted-text.md#3-design-requirements)。

钥匙和 token 不贴进聊天、不进仓库。值只经过提示时的粘贴，不上命令行。

## 1. 全局：只设一次

用户做；你说清点哪里、填什么、不做会怎样。做完的那几样不再做。

1. Cursor 的 API key：cursor.com/dashboard → API keys → 新建一把。存进 `loop.env`：在 aboveloop 里跑 `make loop-key NAME=CURSOR_API_KEY`，提示时粘贴。
2. Cursor 的花费上限：cursor.com/dashboard → Spending。
3. 建 loop 的 GitHub App（`<你的 GitHub App>`），权限照 [L3-loop-components §1](../../../knowledge/spec/L3-loop-components.md#1-global-aboveloop-set-up-once) 的那一条，没有 Workflows，Variables 只读。
4. App 的私钥文件放到 `~/.config/aboveloop/github-app.pem`。App ID 存进 `loop.env`：`make loop-key NAME=GH_APP_ID_DEV`。
5. Cursor GitHub App：只在 owner 自己用 Cursor 的 Cloud Agents 时装。loop 不用它。
6. aboveloop 的 Actions 访问设成 none：GitHub → aboveloop → Settings → Actions → Access。每个 `loop.yml` 用 App 的 token 检出 aboveloop，不靠这个访问。

- 钥匙都存在 `~/.config/aboveloop/`，不放进 aboveloop 文件夹：`claude plugin update` 连 gitignored 的文件一起拷进 plugin 缓存。
- 全局还没做完的几步，在 aboveloop 的 issue 里。

做完的样子：对一个接了 loop 的仓库跑 `scripts/check.sh <owner>/<repo>`，「aboveloop Actions access」「GitHub App on aboveloop」「GitHub App of the loop: Variables」这几行都是 ✓。

## 2. 换一把钥匙

钥匙过期了，循环的那一步就停。有泄露的迹象，当天就换。

**CAUTION:** 两步之间，用这把钥匙的那一步会失败。

### loop 的钥匙 `CURSOR_API_KEY`

1. 做一把新的（第 1 节）。
2. 换掉 `loop.env` 里那一行：`make loop-key NAME=CURSOR_API_KEY`，提示时粘贴。
3. 对每个仓库跑 `make loop-secrets REPO=<owner>/<repo>`。

### App 的私钥 `GH_APP_KEY_DEV`

1. 在 GitHub 上生成 loop 的 GitHub App 的一把新私钥：Developer settings → GitHub Apps → `<你的 GitHub App>` → Private keys。
2. 换掉 `~/.config/aboveloop/github-app.pem`。
3. 对每个仓库跑 `make loop-secrets REPO=<owner>/<repo>`。
4. 在 GitHub 上删掉旧的私钥。

**NOTE:** 删了旧的私钥，它已经造出的 token 最多还能用一小时（R20）。
