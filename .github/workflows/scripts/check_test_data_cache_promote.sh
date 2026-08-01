#!/usr/bin/env bash
# PR 合并后资格检查：head 相对合并前 base 完全领先且 merge tip 与 head 同 tree → eligible=true。
# 源缓存是否存在、是否抄到 base，由 promote workflow 的 restore/save 判定，不在这里用 gh cache list 冒充成功。
# 环境：HEAD_SHA MERGE_SHA HEAD_REF BASE_REF；可选 TEST_DATA_CACHE_PREFIX
# 输出：eligible=true|false → $GITHUB_OUTPUT
set -euo pipefail

HEAD_SHA="${HEAD_SHA:?HEAD_SHA required}"
MERGE_SHA="${MERGE_SHA:?MERGE_SHA required}"
HEAD_REF="${HEAD_REF:?HEAD_REF required}"
BASE_REF="${BASE_REF:?BASE_REF required}"
CACHE_PREFIX="${TEST_DATA_CACHE_PREFIX:-fount-test-data-}"
SOURCE_KEY="${CACHE_PREFIX}${HEAD_REF}"
DEST_KEY="${CACHE_PREFIX}${BASE_REF}"

emit_eligible() {
	local eligible="$1"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "eligible=${eligible}" >> "${GITHUB_OUTPUT}"
	fi
	echo "eligible=${eligible}"
}

git fetch --no-tags origin "${MERGE_SHA}" "${HEAD_SHA}" 2>/dev/null || true

if ! git cat-file -e "${MERGE_SHA}^{commit}" 2>/dev/null; then
	echo "merge commit ${MERGE_SHA} missing; skip"
	emit_eligible false
	exit 0
fi
if ! git cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null; then
	echo "head commit ${HEAD_SHA} missing; skip"
	emit_eligible false
	exit 0
fi

old_base="$(git rev-parse "${MERGE_SHA}^1")"
if ! git merge-base --is-ancestor "${old_base}" "${HEAD_SHA}"; then
	echo "head diverged from pre-merge base (${old_base}); skip promote"
	emit_eligible false
	exit 0
fi

merge_tree="$(git rev-parse "${MERGE_SHA}^{tree}")"
head_tree="$(git rev-parse "${HEAD_SHA}^{tree}")"
if [[ "${merge_tree}" != "${head_tree}" ]]; then
	echo "merge tree ${merge_tree} != head tree ${head_tree}; skip promote"
	emit_eligible false
	exit 0
fi

echo "ahead + same tree: eligible ${SOURCE_KEY} → ${DEST_KEY}"
emit_eligible true
