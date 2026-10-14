#!/usr/bin/env bash
# The status line against a fake Claude Code install and a real temporary working copy. No network.
# Cases: the same version, a newer release, commits that are not released, no release yet,
# a marketplace that is still the working copy, the Cursor copy, a working copy that cannot be read.
set -euo pipefail

root=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

wc="$tmp/wc"
home="$tmp/home"
mkdir -p "$wc" "$home/.claude/plugins"
git -C "$wc" init -q -b main
git -C "$wc" config user.email t@example.dev
git -C "$wc" config user.name t
commit() { echo "$RANDOM" >"$wc/f"; git -C "$wc" add -A; git -C "$wc" commit -q -m "$1"; git -C "$wc" update-ref refs/remotes/origin/main HEAD; }

source_is() {
  if [ "$1" = directory ]; then
    printf '{"aboveloop":{"source":{"source":"directory","path":"%s"}}}\n' "$wc"
  else
    printf '{"aboveloop":{"source":{"source":"github","repo":"shiyuann/aboveloop","ref":"%s"}}}\n' "$2"
  fi >"$home/.claude/plugins/known_marketplaces.json"
}
installed() { printf '{"plugins":{"aboveloop@aboveloop":[{"version":"%s"}]}}\n' "$1" >"$home/.claude/plugins/installed_plugins.json"; }

expect() {
  local out
  out=$(HOME="$home" ABOVELOOP_DIR="${2:-$wc}" bash "$root/status.sh")
  printf '%s\n' "$out"
  case "$out" in
    *$1*) ;;
    *) printf 'expected "%s", got: %s\n' "$1" "$out" >&2; exit 1 ;;
  esac
}

commit one
source_is directory; installed 20261011.7
expect "读的是工作副本（还没发过版）（1 个 commit 还没发版）"

git -C "$wc" tag -a 20261012.9 -m x
git -C "$wc" tag -a 20261012.10 -m x
expect "读的是工作副本，还没切到发版 20261012.10 —— 跑 \`make -C $wc sync\`"

source_is github 20261012.10; installed 20261012.10
expect "20261012.10 · 已是最新一版"

commit two
expect "20261012.10 · 已是最新一版（1 个 commit 还没发版）"

installed 20261012.9
out=$(HOME="$home" ABOVELOOP_DIR="$wc" bash "$root/status.sh")
case "$out" in *"已是最新"*) echo "an old install must not say 已是最新: $out" >&2; exit 1 ;; esac
expect "20261012.9 · **装的是旧的**，最新一版是 20261012.10"

installed 20261012.10
mkdir -p "$home/.cursor/plugins/local/aboveloop"
echo 20261012.9 >"$home/.cursor/plugins/local/aboveloop/VERSION"
expect "Cursor 副本是 20261012.9"

expect "检查失效" "$tmp/nowhere"
echo "status.test.sh: all cases pass"
