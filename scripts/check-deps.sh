#!/usr/bin/env bash
# Ensures every runtime dependency in cli/package.json is also in the root package.json.
# The root is what npm publishes — missing deps there means broken installs.

set -euo pipefail

root_deps=$(node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(Object.keys(p.dependencies||{}).join('\n'))")
cli_deps=$(node -e "const p=JSON.parse(require('fs').readFileSync('cli/package.json','utf8')); console.log(Object.keys(p.dependencies||{}).join('\n'))")

missing=0
while IFS= read -r dep; do
  [ -z "$dep" ] && continue
  if ! echo "$root_deps" | grep -qx "$dep"; then
    echo "ERROR: cli dependency '$dep' is missing from root package.json"
    missing=1
  fi
done <<< "$cli_deps"

if [ "$missing" -eq 1 ]; then
  echo ""
  echo "Add missing dependencies to the root package.json so they're included in the published package."
  exit 1
fi

echo "All cli dependencies are present in root package.json."
