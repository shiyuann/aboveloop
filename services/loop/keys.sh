#!/usr/bin/env bash
# The `loop.yml` workflow's secrets on this machine (make loop-key, make loop-secrets).
#
#   keys.sh key NAME             store CURSOR_API_KEY or GH_APP_ID_DEV in loop.env
#   keys.sh secrets OWNER/REPO   set the repo's secrets and the variable GH_APP_ID_DEV from loop.env
#
# loop.env is ~/.config/aboveloop/loop.env (LOOP_ENV replaces it), mode 600,
# one NAME=value per line; the owner may edit it by hand. It is not in the kit
# folder: `claude plugin update` copies that folder, gitignored files too, into
# the plugin cache (measured). No value goes onto a command line, into the output
# or into a log: `gh secret set` reads it from stdin. The names are the
# contract's (services/loop/plan.ts SECRETS; a test keeps the lists equal).
#
# `key` stores GH_APP_ID_DEV in loop.env, the same way as CURSOR_API_KEY.
# GH_APP_KEY_DEV is not a line: it is the private key file of the GitHub App
# of the loop, ~/.config/aboveloop/github-app.pem (APP_PEM replaces it).
# `key` with that name stores nothing and says to copy the file to that path.
# `secrets` sets the repo variable GH_APP_ID_DEV from the line in loop.env.
set -euo pipefail

FILE="${LOOP_ENV:-$HOME/.config/aboveloop/loop.env}"
APP_PEM="${APP_PEM:-$HOME/.config/aboveloop/github-app.pem}"
EVERY_REPO=(CURSOR_API_KEY GH_APP_KEY_DEV)

# The value of a name: the App's key file, or else the line in loop.env.
value() {
  if [ "$1" = GH_APP_KEY_DEV ]; then
    [ -s "$APP_PEM" ] && cat "$APP_PEM"
    return 0
  fi
  local line
  line="$(grep -h -m1 "^$1=" "$FILE" 2>/dev/null | head -1 || true)"
  printf '%s' "${line#*=}"
}

# Where `secrets` looks for a name, for the "not set" line.
source_of() {
  if [ "$1" = GH_APP_KEY_DEV ]; then printf '%s' "$(basename "$APP_PEM")"
  else printf '%s' "$(basename "$FILE")"; fi
}

known() {
  local n
  for n in "${EVERY_REPO[@]}"; do [ "$n" = "$1" ] && return 0; done
  return 1
}

case "${1:-}" in
  key)
    name="${2:-}"
    # The App key is the pem file. This check is before the store path: no prompt, no stdin, no loop.env.
    if [ "$name" = GH_APP_KEY_DEV ]; then
      echo "copy the file to $APP_PEM" >&2
      exit 2
    fi
    # GH_APP_ID_DEV is a repo variable, not a secret, so it is not in EVERY_REPO.
    if ! known "$name" && [ "$name" != GH_APP_ID_DEV ]; then
      echo "用法：make loop-key NAME=<secret>；认得的：CURSOR_API_KEY GH_APP_ID_DEV" >&2
      exit 2
    fi
    mkdir -p "$(dirname "$FILE")"
    umask 077
    touch "$FILE"
    chmod 600 "$FILE"
    printf '%s 的值（粘贴，不回显）：' "$name" >&2
    IFS= read -rs value
    echo >&2
    if [ -z "$value" ]; then
      echo "空值，没存" >&2
      exit 1
    fi
    tmp="$(mktemp "$FILE.XXXXXX")"
    { grep -v "^$name=" "$FILE" || true; printf '%s=%s\n' "$name" "$value"; } >"$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$FILE"
    echo "存好了：${name} → $FILE"
    ;;
  secrets)
    repo="${2:-}"
    if ! [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
      echo "用法：make loop-secrets REPO=<owner>/<repo>" >&2
      exit 2
    fi
    if [ ! -f "$FILE" ]; then
      echo "没有 $FILE：先 make loop-key NAME=<secret>" >&2
      exit 1
    fi
    set_names=()
    skipped=()
    for name in "${EVERY_REPO[@]}"; do
      if [ -z "$(value "$name")" ]; then
        skipped+=("${name}（$(source_of "$name") 里没有）")
        continue
      fi
      value "$name" | gh secret set "$name" -R "$repo" >/dev/null
      set_names+=("$name")
    done
    app_id="$(value GH_APP_ID_DEV)"
    if [ -n "$app_id" ]; then
      gh variable set GH_APP_ID_DEV -R "$repo" --body "$app_id" >/dev/null
      set_names+=("GH_APP_ID_DEV（变量）")
    else
      skipped+=("GH_APP_ID_DEV（$(basename "$FILE") 里没有）")
    fi
    echo "设了：${set_names[*]:-（无）}"
    echo "没设：${skipped[*]:-（无）}"
    ;;
  *)
    echo "用法：keys.sh key NAME | keys.sh secrets OWNER/REPO" >&2
    exit 2
    ;;
esac
