#!/usr/bin/env bash
#
# Is this app set up? One line for each part (L3-loop-components), ✓ or ✗, and
# the exit code is the number of ✗ (0 = all set). Read-only: it reads GitHub,
# and never prints a secret (only names).
#
#   skills/setup-app/scripts/check.sh <owner>/<repo>
#
# Run it from anywhere; it finds aboveloop from its own path. Needs `gh` (logged in).

set -uo pipefail
REPO="${1:-}"
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "usage: check.sh <owner>/<repo>" >&2
  exit 2
fi
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
KIT_REPO="shiyuann/aboveloop"
bad=0
ok() { printf '  ✓ %-36s %s\n' "$1" "$2"; }
no() { printf '  ✗ %-36s %s\n' "$1" "$2"; bad=$((bad + 1)); }
hand() { printf '  · %-36s %s\n' "$1" "$2"; }
# A file on the repo's default branch, as text (empty when it is not there). On a 404, gh prints GitHub's JSON
# error on stdout, so only the output of a call that worked counts.
file() { local out; out=$(gh api -H "Accept: application/vnd.github.raw+json" "repos/$1/contents/$2" 2>/dev/null) && printf '%s\n' "$out"; }

echo "Loop: $REPO"

# loop.yml checks out the latest release of aboveloop with a token of the App,
# so no other repo needs Actions access to it: a stale copy with `uses: …@main` then fails at once.
access=$(gh api "repos/$KIT_REPO/actions/permissions/access" -q .access_level 2>/dev/null)
[ "$access" = none ] && ok "aboveloop Actions access" "none" || no "aboveloop Actions access" "is '${access:-?}', want none"

wf=$(file "$REPO" .github/workflows/loop.yml)
if [ -z "$wf" ]; then
  no "workflow loop.yml" "not on the default branch"
elif [ "$wf" = "$(cat "$KIT/skills/setup-app/references/loop.yml")" ]; then
  ok "workflow loop.yml" "same as references/loop.yml"
else
  no "workflow loop.yml" "differs from references/loop.yml: copy it again"
fi
state=$(gh api "repos/$REPO/actions/workflows/loop.yml" -q .state 2>/dev/null)
[ "$state" = active ] && ok "workflow state" "active" || no "workflow state" "${state:-not found}, want active"

# The labels every repo of the loop has (references/labels.tsv: name, color, description).
while IFS=$'\t' read -r l _ _; do
  enc=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$l")
  gh api "repos/$REPO/labels/$enc" </dev/null >/dev/null 2>&1 && ok "label $l" "exists" || no "label $l" "missing: references/loop.md step 1"
done <"$KIT/skills/setup-app/references/labels.tsv"

# GitHub deletes the branch of a merged PR (L2-loop-builder §5): "Automatically delete head branches".
del=$(gh api "repos/$REPO" --jq .delete_branch_on_merge 2>/dev/null)
[ "$del" = true ] && ok "delete head branches" "on" || no "delete head branches" "is '${del:-?}', want true: gh repo edit $REPO --delete-branch-on-merge"

secrets=$(gh secret list -R "$REPO" --json name -q '.[].name' 2>/dev/null)
for s in CURSOR_API_KEY GH_APP_KEY_DEV; do
  grep -qx "$s" <<<"$secrets" && ok "secret $s" "set" || no "secret $s" "missing: make loop-secrets REPO=$REPO"
done
app_id=$(gh variable get GH_APP_ID_DEV -R "$REPO" 2>/dev/null)
[ -n "$app_id" ] && ok "variable GH_APP_ID_DEV" "$app_id" || no "variable GH_APP_ID_DEV" "missing: make loop-secrets REPO=$REPO"

# The configuration of builder (L3-loop-builder §1).
cfg=$(file "$REPO" .agents/builder.md)
if [ -z "$cfg" ]; then
  no ".agents/builder.md" "missing"
elif grep -qi '^#.*explore' <<<"$cfg" && grep -qi '^#.*implement' <<<"$cfg"; then
  ok ".agents/builder.md" "has Explore and Implement"
else
  no ".agents/builder.md" "needs an Explore part and an Implement part"
fi

# The configuration of dev (L3-loop-dev §3) is optional: with no file (HTTP 404), the default rank. The session entry
# of dev reads its ## Rank and says when it cannot; this check does not parse it.
if ! dev=$(gh api -H "Accept: application/vnd.github.raw+json" "repos/$REPO/contents/.agents/dev.md" 2>&1); then
  if grep -q "HTTP 404" <<<"$dev"; then
    hand ".agents/dev.md" "default rank"
  else
    no ".agents/dev.md" "cannot be read: $(head -1 <<<"$dev")"
  fi
else
  ok ".agents/dev.md" "on the default branch: dev reads its ## Rank"
fi

last=$(gh run list -R "$REPO" -w loop.yml -L 1 --json conclusion,status -q '.[] | "\(.status) \(.conclusion)"' 2>/dev/null)
case "$last" in
  "completed success") ok "last run of loop.yml" "success" ;;
  "") no "last run of loop.yml" "none yet: do the dry run (references/loop.md step 6)" ;;
  *) no "last run of loop.yml" "$last" ;;
esac

# The GitHub App of the loop must be installed on the repo: ask GitHub as the App (its key file is on this machine).
APP_PEM="${APP_PEM:-$HOME/.config/aboveloop/github-app.pem}"
if [ -n "$app_id" ] && [ -s "$APP_PEM" ]; then
  jwt=$(node -e '
    const { createSign } = require("node:crypto"); const fs = require("node:fs");
    const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const t = Math.floor(Date.now() / 1000);
    const d = b({ alg: "RS256", typ: "JWT" }) + "." + b({ iat: t - 60, exp: t + 540, iss: process.argv[1] });
    process.stdout.write(d + "." + createSign("RSA-SHA256").update(d).sign(fs.readFileSync(process.argv[2], "utf8")).toString("base64url"));' "$app_id" "$APP_PEM" 2>/dev/null)
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $jwt" "https://api.github.com/repos/$REPO/installation")
  [ "$code" = 200 ] && ok "GitHub App of the loop" "installed on $REPO" || no "GitHub App of the loop" "not installed on $REPO ($code): Install App → add the repo"
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $jwt" "https://api.github.com/repos/$KIT_REPO/installation")
  [ "$code" = 200 ] && ok "GitHub App on aboveloop" "installed: loop.yml reads the latest release with it" || no "GitHub App on aboveloop" "not installed on $KIT_REPO ($code)"
  # The release variable (L2-release §2.3): the App reads it, and never writes it.
  vars=$(curl -s -H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" "https://api.github.com/app" |
    node -e 'try { const a = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(a.permissions ? a.permissions.actions_variables || "none" : "?"); } catch { process.stdout.write("?"); }')
  [ "$vars" = read ] && ok "GitHub App of the loop: Variables" "read, not write" || no "GitHub App of the loop: Variables" "is '$vars', want read (Settings › Developer settings › GitHub Apps › <your GitHub App> › Permissions)"
else
  hand "GitHub App of the loop" "cannot be read here (no GH_APP_ID_DEV or no $APP_PEM): the owner checks that it is installed on $REPO"
fi

# The Cursor GitHub App stays on the repos for the owner's own agents: it must have no Variables permission,
# so it cannot write the release variable (L2-release §2.3). `GET /apps/cursor` needs no key.
cursor=$(gh api apps/cursor -q '.permissions.actions_variables // "none"' 2>/dev/null)
[ "$cursor" = none ] && ok "Cursor GitHub App Variables" "none" || no "Cursor GitHub App Variables" "is '${cursor:-not readable}', want none: it could write the release variable"

echo
[ "$bad" -eq 0 ] && echo "All set." || echo "$bad not set."
exit "$bad"
