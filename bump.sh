#!/usr/bin/env bash
#
# 版本号推进。约定：`<当天日期>.<patch>`，例如 20260920.1。
#
# 为什么是日期而不是语义化版本：这个 plugin 里是约定和手艺，不是有 API 的库。
# 「0.3.0 还是 1.0.0」对散文没有意义，而「这份约定是哪天的」有意义 —— 一眼看出
# 消费端落后了多久。
#
# VERSION 是唯一真相，三个清单从它同步。清单里的 version 字段必须是字面量
# （JSON 读不了文件），所以这个脚本存在的意义就是让那三处不用手改、也就不会写歪。
#
#   ./bump.sh          今天已发过就 patch +1，否则今天的 .1
#   ./bump.sh --check  只校验 VERSION 和三个清单一致，不改动（给 make validate 用）

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

VERSION_FILE="VERSION"
MANIFESTS=(".claude-plugin/plugin.json" ".cursor-plugin/plugin.json")
MARKETPLACE=".claude-plugin/marketplace.json"

current="$(cat "$VERSION_FILE" 2>/dev/null || echo "")"

read_manifest_versions() {
  for m in "${MANIFESTS[@]}"; do
    python3 -c "import json,sys; print(json.load(open('$m')).get('version',''))"
  done
  python3 -c "import json; print(json.load(open('$MARKETPLACE'))['plugins'][0].get('version',''))"
}

if [ "${1:-}" = "--check" ]; then
  bad=0
  while read -r v; do
    [ "$v" = "$current" ] || { echo "版本不一致: 清单里是 '$v'，VERSION 是 '$current'" >&2; bad=1; }
  done < <(read_manifest_versions)
  [ "$bad" = "0" ] || { echo "跑 ./bump.sh 或手动对齐" >&2; exit 1; }
  echo "版本一致: $current"
  exit 0
fi

today="$(date +%Y%m%d)"
case "$current" in
  "$today".*)
    patch="${current##*.}"
    next="$today.$((patch + 1))"
    ;;
  *)
    next="$today.1"
    ;;
esac

# VERSION 最后改（L2-release §3）：中途停了，VERSION 还是旧的，发版就知道版本号命令没跑完，再跑一次。
for m in "${MANIFESTS[@]}"; do
  python3 -c "
import json
p = '$m'
j = json.load(open(p))
j['version'] = '$next'
json.dump(j, open(p, 'w'), ensure_ascii=False, indent=2)
open(p, 'a').write('\n')
"
done
python3 -c "
import json
p = '$MARKETPLACE'
j = json.load(open(p))
j['plugins'][0]['version'] = '$next'
json.dump(j, open(p, 'w'), ensure_ascii=False, indent=2)
open(p, 'a').write('\n')
"

echo "$current -> $next"
echo "同步了 ${#MANIFESTS[@]} 个 plugin 清单 + marketplace"

echo "$next" > "$VERSION_FILE"
echo "VERSION: $next"
