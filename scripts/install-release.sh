#!/usr/bin/env bash
# Install a release of aboveloop on the owner's machine (L2-plugin §5).
#
#   scripts/install-release.sh [TAG]     (make install-release [TAG=…])
#
# TAG is a release tag on origin; without it, the latest release (L2-release §0).
# - Claude Code: the marketplace comes from GitHub, pinned to the tag. When it is
#   not GitHub at this tag (a local folder, or GitHub at another tag), it is removed,
#   added at the tag (`claude plugin marketplace add "shiyuann/aboveloop#<tag>"`),
#   and the plugin is installed. Claude Code refuses `add` with another
#   source when the user settings declare the marketplace (`extraKnownMarketplaces`)
#   or when it comes from a folder; `remove` also takes it out of the settings
#   (measured, L2-plugin §3).
# - Cursor: a real copy of the tree of the tag in ~/.cursor/plugins/local/aboveloop
#   (Cursor skips a symlink that points outside that folder).
# Then it checks that Claude Code's install is the tag's commit.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REPO=shiyuann/aboveloop
NAME=aboveloop

tag="${1:-}"
if [ -z "$tag" ]; then
  tag="$(node --experimental-strip-types --no-warnings skills/prerelease/scripts/scope.ts --latest)" || { echo "no latest release: $tag" >&2; exit 1; }
fi
[[ "$tag" =~ ^[0-9]{8}\.[0-9]+$ ]] || { echo "not a release tag: $tag" >&2; exit 2; }
git fetch -q origin "refs/tags/$tag:refs/tags/$tag"
sha="$(git rev-list -n 1 "$tag")"
version="$(git show "$tag:VERSION" | tr -d '[:space:]')"
[ "$version" = "$tag" ] || { echo "VERSION at $tag is $version, not $tag" >&2; exit 1; }

# Claude Code
marketplace="$(claude plugin marketplace list --json | python3 -c "
import json, sys
m = [m for m in json.load(sys.stdin) if m.get('name') == '$NAME']
if not m: print('none')
elif m[0].get('source') == 'github' and m[0].get('repo') == '$REPO' and m[0].get('ref') == '$tag': print('tag')
else: print('other')")"
if [ "$marketplace" = tag ]; then
  claude plugin install "$NAME@$NAME"
  claude plugin update "$NAME@$NAME"
else
  if [ "$marketplace" = other ]; then
    echo "The marketplace $NAME is not GitHub at $tag: it is removed, and added again at $tag."
    # After the remove, a failed add or install leaves no aboveloop: say how to recover.
    trap 'echo "The install stopped after the marketplace was removed. Run again: make install-release TAG=$tag (or start Claude Code with --plugin-dir, see setup-dev)." >&2' ERR
    claude plugin marketplace remove "$NAME" >/dev/null
  fi
  claude plugin marketplace add "$REPO#$tag"
  claude plugin install "$NAME@$NAME"
fi
installed="$(python3 -c "
import json, os
d = json.load(open(os.path.join(os.environ.get('CLAUDE_CONFIG_DIR') or os.path.expanduser('~/.claude'), 'plugins/installed_plugins.json')))['plugins']['$NAME@$NAME'][0]
print(d.get('version', ''), d.get('gitCommitSha', ''))")"
[ "$installed" = "$tag $sha" ] || { echo "Claude Code has '$installed', not '$tag $sha'" >&2; exit 1; }
echo "Claude Code: $NAME $tag ($sha)"

# Cursor: the tree of the tag, no working-copy files
if [ -d "$HOME/.cursor/plugins/local" ]; then
  tree="$(mktemp -d)"
  git archive "$tag" | tar -x -C "$tree"
  rsync -a --delete --exclude '.env.*' "$tree/" "$HOME/.cursor/plugins/local/$NAME/"
  rm -rf "$tree"
  echo "Cursor: ~/.cursor/plugins/local/$NAME is the tree of $tag"
fi
echo "Restart the Claude Code sessions; in Cursor, run Developer: Reload Window."
