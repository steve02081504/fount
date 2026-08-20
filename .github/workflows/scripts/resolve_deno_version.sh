#!/usr/bin/env bash
# Resolve the repo deno pin (`.deno-version`) for CI install.
# Emits to $GITHUB_OUTPUT:
#   deno-version  — spec setup-deno can consume at install time (channel/semver/hash)
#   pr-upgrade    — `pr N` spec (setup-deno cannot parse it) to apply via `deno upgrade` after install
# Missing or empty file -> deno-version=canary, pr-upgrade empty (original CI behavior).
set -euo pipefail

FILE="${1:-.deno-version}"
deno_version="canary"
pr_upgrade=""
if [ -f "$FILE" ]; then
	spec=$(awk 'NR==1{ sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); print }' "$FILE")
	if [ -n "$spec" ]; then
		if [[ "$spec" == pr\ * ]]; then
			pr_upgrade="$spec"
		else
			deno_version="$spec"
		fi
	fi
fi

echo "deno-version=$deno_version" >>"$GITHUB_OUTPUT"
echo "pr-upgrade=$pr_upgrade" >>"$GITHUB_OUTPUT"
