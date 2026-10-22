.DEFAULT_GOAL := help

.PHONY: help validate bump sync install-release skills-test loop-test loop-run loop-key loop-secrets

help:
	@echo "make sync       校验，再装最新一版（Claude Code 从 GitHub 钉在 tag 上，Cursor 拷 tag 的树）"
	@echo "make install-release [TAG=…]  装某一版（默认最新一版）"
	@echo "make validate   校验 plugin 清单、版本、skill reference 链接，和 entry 的会话摘要没漂（digest.md）"
	@echo "make bump       推版本号（只在发版时，prerelease 第 4 步；约定：当天日期.patch，如 20260920.1）"
	@echo "make skills-test     各 skill 脚本的测试（不联网）"
	@echo "make loop-test       loop.yml workflow 的测试（不联网）"
	@echo "make loop-run [STEP=all|explore|implement] [DRY=1]  本机跑一次 loop.yml workflow 做的事（REPO 和钥匙从环境变量读）"
	@echo "make loop-key NAME=CURSOR_API_KEY|GH_APP_ID_DEV  把这一行存进 ~/.config/aboveloop/loop.env（提示时粘贴，不回显）。NAME=GH_APP_KEY_DEV 不存：私钥是 ~/.config/aboveloop/ 里的一个文件（services/loop/keys.sh）"
	@echo "make loop-secrets REPO=<owner>/<repo>  把 loop.env 里这个仓库要的钥匙设成它的 GitHub secrets（只打印名字）"
	@echo ""
	@echo "改动在下一版才到 owner 的会话：发版走 prerelease skill。"

validate:
	@claude plugin validate .
	@bash bump.sh --check
	@node scripts/validate-skill-links.mjs
	@node --experimental-strip-types --no-warnings skills/entry/scripts/digest.ts --check

bump:
	@bash bump.sh

# 改完 aboveloop 让它真的生效的唯一入口。
#
# 为什么要包成一条：装一版有好几步（校验、Claude Code 的 marketplace 和 install、Cursor 的拷贝、
# 查装好的那份是不是 tag 的提交）。漏掉一步，别的步骤照样报「成功」，装好的那份却不是这一版 ——
# 静默过期。拆开敲，早晚会漏掉一步；包成一条就漏不掉。
sync: validate
	@# 装最新一版：Claude Code 从 GitHub 钉在 tag 上，Cursor 拷 tag 的那棵树。
	@# 不推版本号：版本号只在发版时推（prerelease 的第 4 步，make bump）。
	@bash scripts/install-release.sh

install-release:
	@bash scripts/install-release.sh $(TAG)

skills-test:
	@node --experimental-strip-types --no-warnings --test 'skills/*/scripts/*.test.ts'

# `loop.yml` workflow（knowledge/spec/L3-loop-workflow.md §1）。每个项目仓库的 .github/workflows/loop.yml
# （setup-app 的 references/loop.yml 原样拷过去）调用 services/loop/action.yml。
# 本机跑时 REPO 和各把钥匙从环境变量读。DRY=1 只读，不开 agent。
LOOP := services/loop

loop-test:
	@node --experimental-strip-types --no-warnings --test '$(LOOP)/test/*.test.ts'

loop-run:
	@node --experimental-strip-types --no-warnings $(LOOP)/run.ts $(if $(STEP),--step "$(STEP)") $(if $(DRY),--dry-run)

# 钥匙的值只经过 read -s 和 stdin，不上命令行、不打印（services/loop/keys.sh）。
loop-key:
	@bash $(LOOP)/keys.sh key "$(NAME)"

loop-secrets:
	@bash $(LOOP)/keys.sh secrets "$(REPO)"
