#!/usr/bin/env bash
# Apply a repo-pinned deno version (`.deno-version`) if present.
# The file holds a single line consumed by `deno upgrade`, e.g.:
#   pr 36606   (denoland/deno PR build)
#   canary     (channel)
#   2.9.5      (specific release)
# Empty or missing file -> keep the currently-installed deno unchanged.
set -euo pipefail

FILE="${1:-.deno-version}"
if [ ! -f "$FILE" ]; then
	echo "No ${FILE} pin; keeping current deno"
	exit 0
fi

spec=$(awk 'NR==1{ sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); print }' "$FILE")
if [ -z "$spec" ]; then
	echo "${FILE} is empty; keeping current deno"
	exit 0
fi

echo "Applying deno version spec from ${FILE}: ${spec}"
# shellcheck disable=SC2086
deno upgrade $spec
