#!/usr/bin/env bash
# Fail if captured `fount remove` output matches remove-noise.patterns.
set -euo pipefail
patterns_file=$1
output_file=$2
output=$(cat -- "$output_file")
while IFS= read -r pattern || [ -n "$pattern" ]; do
	case "$pattern" in
	'' | \#*) continue ;;
	esac
	if grep -E -q -- "$pattern" <<< "$output"; then
		echo "remove output matched noise pattern: $pattern" >&2
		echo "--- captured output ---" >&2
		printf '%s\n' "$output" >&2
		exit 1
	fi
done < "$patterns_file"
