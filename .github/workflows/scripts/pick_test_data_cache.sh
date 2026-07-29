#!/usr/bin/env bash
# 为本分支挑选 data/test 缓存 key：
# 1) 精确命中 fount-test-data-<本分支>
# 2) 否则在仍有 origin/<branch> tip 的候选里，选与 HEAD 文件 diff 最小者
#    （同分优先默认分支，再比 createdAt 更新）
# 输出：restore_key → $GITHUB_OUTPUT
set -euo pipefail

PREFIX="${TEST_DATA_CACHE_PREFIX:-fount-test-data-}"
CURRENT_BRANCH="${GITHUB_REF_NAME:?GITHUB_REF_NAME required}"
DEFAULT_BRANCH="${GITHUB_DEFAULT_BRANCH:?GITHUB_DEFAULT_BRANCH required}"
CURRENT_KEY="${PREFIX}${CURRENT_BRANCH}"
DEFAULT_KEY="${PREFIX}${DEFAULT_BRANCH}"

emit() {
	local key="$1"
	echo "restore_key=${key}" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT required}"
	echo "picked restore_key=${key}"
}

# 其它分支 tip 需要完整 refs；checkout fetch-depth:0 通常已带，再补一次更稳
git fetch --prune --no-tags origin '+refs/heads/*:refs/remotes/origin/*' 2>/dev/null || true

json="$(gh cache list --key "${PREFIX}" --limit 100 --json key,createdAt 2>/dev/null || true)"
if [[ -z "${json}" || "${json}" == '[]' ]]; then
	echo "no caches with prefix ${PREFIX}; fallback ${DEFAULT_KEY}"
	emit "${DEFAULT_KEY}"
	exit 0
fi

if jq -e --arg k "${CURRENT_KEY}" 'map(select(.key == $k)) | length > 0' <<<"${json}" >/dev/null; then
	echo "exact branch cache hit: ${CURRENT_KEY}"
	emit "${CURRENT_KEY}"
	exit 0
fi

best_key=""
best_score=""
best_created=""
best_is_default=0

while IFS=$'\t' read -r key created; do
	[[ "${key}" == "${PREFIX}"* ]] || continue
	branch="${key#"${PREFIX}"}"
	[[ -n "${branch}" ]] || continue

	tip=""
	if git rev-parse --verify -q "refs/remotes/origin/${branch}" >/dev/null; then
		tip="refs/remotes/origin/${branch}"
	else
		echo "skip orphaned cache (no origin/${branch}): ${key}"
		continue
	fi

	score="$(git diff --name-only HEAD "${tip}" | wc -l | tr -d '[:space:]')"
	is_default=0
	[[ "${branch}" == "${DEFAULT_BRANCH}" ]] && is_default=1
	echo "candidate key=${key} tip=${tip} diff_files=${score} createdAt=${created}"

	pick=0
	if [[ -z "${best_key}" ]]; then
		pick=1
	elif (( score < best_score )); then
		pick=1
	elif (( score == best_score )); then
		if (( is_default && !best_is_default )); then
			pick=1
		elif (( is_default == best_is_default )) && [[ "${created}" > "${best_created}" ]]; then
			pick=1
		fi
	fi

	if (( pick )); then
		best_key="${key}"
		best_score="${score}"
		best_created="${created}"
		best_is_default="${is_default}"
	fi
done < <(jq -r '.[] | [.key, (.createdAt // "")] | @tsv' <<<"${json}")

if [[ -z "${best_key}" ]]; then
	echo "no scorable caches; fallback ${DEFAULT_KEY}"
	emit "${DEFAULT_KEY}"
	exit 0
fi

echo "nearest cache: ${best_key} (diff_files=${best_score})"
emit "${best_key}"
