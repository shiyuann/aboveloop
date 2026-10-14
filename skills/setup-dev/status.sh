#!/usr/bin/env bash
#
# 打印一行 aboveloop 状态。`entry` skill 每次会话跑一次。
#
# 一版 aboveloop 是一个发版 tag（L2-release）。owner 的会话读 Claude Code 缓存里装好的那一版：
# marketplace 从 GitHub 来，钉在 tag 上，每次发版装一次（make sync）。
# 所以这里比的是：装好的版本号，对最新的发版 tag。只有真有更新的一版时，才说装的是旧的；
# 另外说工作副本里有几个 commit 还没发版（它们要等下一版才到会话里）。
#
# 工作副本：marketplace 是本地目录时就是那个目录（还没切到 GitHub）；不然是
# $ABOVELOOP_DIR，默认 ~/workdir/aboveloop。不联网：用工作副本本地已知的 tag 和 origin/main。
# 最新的 tag 是不是 owner 推的，这里不查（要联网）；make sync 装的时候会查。
#
# 铁律：任何一步拿不准，报「检查失效」，不要报「已是最新」。假的绿灯比没有灯更糟。

set -uo pipefail

python3 <<'PY'
import json, os, re, subprocess

home = os.path.expanduser("~")
mk = None
ins = None
try:
    mk = json.load(open(f"{home}/.claude/plugins/known_marketplaces.json"))
    ins = json.load(open(f"{home}/.claude/plugins/installed_plugins.json"))
except Exception:
    pass


def line(s):
    print(f"aboveloop · {s}")


if mk is None or ins is None:
    line("不是 Claude Code 的 plugin 安装，跳过版本检查")
    raise SystemExit(0)

source = (mk.get("aboveloop") or {}).get("source") or {}
installed = ((ins.get("plugins") or {}).get("aboveloop@aboveloop") or [{}])[0]
ver = installed.get("version")
if not ver:
    line("装好的那份读不到版本 —— 检查失效，跑 setup-dev")
    raise SystemExit(0)

wc = source.get("path") if source.get("source") == "directory" else os.environ.get("ABOVELOOP_DIR", f"{home}/workdir/aboveloop")


def git(*args):
    try:
        r = subprocess.run(["git", "-C", wc, *args], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def version_key(name):
    m = re.fullmatch(r"(\d{8})\.(\d+)", name)
    return (int(m.group(1)), int(m.group(2))) if m else None


tags = git("tag", "--merged", "origin/main")
notes = []
latest = None
if tags is None:
    notes.append(f"工作副本 {wc} 读不到")
else:
    releases = sorted((t for t in tags.split() if version_key(t)), key=version_key)
    latest = releases[-1] if releases else None
    unreleased = git("rev-list", "--count", f"{latest}..origin/main" if latest else "origin/main")
    if unreleased and unreleased != "0":
        notes.append(f"{unreleased} 个 commit 还没发版")
    dirty = git("status", "--porcelain")
    if dirty:
        notes.append(f"{len(dirty.splitlines())} 处未提交")
    unpushed = git("rev-list", "--count", "origin/main..HEAD")
    if unpushed and unpushed != "0":
        notes.append(f"{unpushed} 个 commit 未推")

# Cursor 的副本是 tag 那棵树的真拷贝，它也会落后。
cursor = f"{home}/.cursor/plugins/local/aboveloop/VERSION"
if latest and os.path.isfile(cursor):
    cv = open(cursor).read().strip()
    if cv != latest:
        notes.append(f"Cursor 副本是 {cv}")

tail = ("（" + "，".join(notes) + "）") if notes else ""
cmd = f"跑 `make -C {wc} sync`"

if source.get("source") == "directory":
    if latest:
        line(f"{ver} · 读的是工作副本，还没切到发版 {latest} —— {cmd}{tail}")
    else:
        line(f"{ver} · 读的是工作副本（还没发过版）{tail}")
elif tags is None:
    line(f"{ver} · 检查失效：{tail[1:-1]}")
elif not latest:
    line(f"{ver} · 检查失效：工作副本里没有发版 tag{tail}")
elif version_key(ver) is None or version_key(ver) < version_key(latest):
    line(f"{ver} · **装的是旧的**，最新一版是 {latest} —— {cmd}{tail}")
else:
    line(f"{ver} · 已是最新一版{tail}")
PY
