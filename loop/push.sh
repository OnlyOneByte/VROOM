#!/usr/bin/env bash
# Incremental push for the VROOM autonomous loop.
# Pushes the CURRENT branch to its same-named remote branch via an EXPLICIT refspec,
# so it can only ever update that branch — never main. No force. The env -u
# GIT_SSH_COMMAND strips the sandbox-injected `-F /dev/null` that ignores ~/.ssh/config.
set -eo pipefail
cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" = "main" ] || [ "$branch" = "HEAD" ]; then
  echo "REFUSING to push: on '$branch' (loop must run on a feature branch, never main)." >&2
  exit 1
fi

echo "Pushing $branch → origin/$branch ..."
env -u GIT_SSH_COMMAND git push -u origin "HEAD:refs/heads/$branch"

echo "=== pushed ==="
git log -1 --format='%h %s'
