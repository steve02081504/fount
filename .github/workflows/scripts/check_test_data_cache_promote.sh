#!/usr/bin/env bash
# PR 合并后资格检查：head 相对合并前 base 完全领先且 merge tip 与 head 同 tree，
# 且源缓存 fount-test-data-<head> 存在 → promoted=true。
# 环境：HEAD_SHA MERGE_SHA HEAD_REF BASE_REF GH_TOKEN；可选 TEST_DATA_CACHE_PREFIX
# 输出：promoted=true|false → $GITHUB_OUTPUT
set -euo pipefail

HEAD_SHA="${HEAD_SHA:?HEAD_SHA required}"
MERGE_SHA="${MERGE_SHA:?MERGE_SHA required}"
HEAD_REF="${HEAD_REF:?HEAD_REF required}"
BASE_REF="${BASE_REF:?BASE_REF required}"
PREFIX="${TEST_DATA_CACHE_PREFIX:-fount-test-data-}"
SOURCE_KEY="${PREFIX}${HEAD_REF}"

emit_promoted() {
	local v="$1"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "promoted=${v}" >> "${GITHUB_OUTPUT}"
	fi
	echo "promoted=${v}"
}

git fetch --no-tags origin "${MERGE_SHA}" "${HEAD_SHA}" 2>/dev/null || true

if ! git cat-file -e "${MERGE_SHA}^{commit}" 2>/dev/null; then
	echo "merge commit ${MERGE_SHA} missing; skip"
	emit_promoted false
	exit 0
fi
if ! git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
	echo "head commit ${HEAD_SHA} missing; skip"
	emit_promoted false
	exit 0
fi

old_base="$(git rev-parse "${MERGE_SHA}^1")"
if ! git merge-base --is-ancestor "${old_base}" "${HEAD_SHA}"; then
	echo "head diverged from pre-merge base (${old_base}); skip promote"
	emit_promoted false
	exit 0
fi

merge_tree="$(git rev-parse "${MERGE_SHA}^{tree}")"
head_tree="$(git rev-parse "${HEAD_SHA}^{tree}")"
if [[ "${merge_tree}" != "${head_tree}" ]]; then
	echo "merge tree ${merge_tree} != head tree ${head_tree}; skip promote"
	emit_promoted false
	exit 0
fi

echo "ahead + same tree: eligible ${SOURCE_KEY} → ${PREFIX}${BASE_REF}"

if ! gh cache list --key "${SOURCE_KEY}" --limit 5 --json key \
	| jq -e --arg k "${SOURCE_KEY}" 'map(select(.key == $k)) | length > 0' >/dev/null; then
	echo "source cache missing: ${SOURCE_KEY}; skip"
	emit_promoted false
	exit 0
fi

emit_promoted true
