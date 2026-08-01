#!/usr/bin/env bash
# 等待「Promote test data cache」对指定 head 分支跑完（合并删分支 / 默认分支 Run Tests 用）。
# 环境：BRANCH（PR head 短名）GH_TOKEN；可选 APPEAR_SEC TIMEOUT_SEC PROMOTE_WORKFLOW
set -euo pipefail

BRANCH="${BRANCH:?BRANCH required}"
WORKFLOW="${PROMOTE_WORKFLOW:-promote_test_data_cache.yaml}"
APPEAR_SEC="${APPEAR_SEC:-120}"
TIMEOUT_SEC="${TIMEOUT_SEC:-300}"

# 无近期合并的同 head PR → 立刻返回（手动删分支等）
now="$(date -u +%s)"
recent_pr="$(
	gh pr list --state merged --head "${BRANCH}" --limit 10 --json number,mergedAt \
		| jq -r --argjson now "${now}" '
			.[]
			| select(.mergedAt != null)
			| (.mergedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $t
			| select(($now - $t) < 900)
			| .number
		' \
		| head -n1
)"
if [[ -z "${recent_pr}" ]]; then
	echo "no PR from ${BRANCH} merged in last 15m; skip wait"
	exit 0
fi
echo "PR #${recent_pr} recently merged from ${BRANCH}; waiting for ${WORKFLOW}"

find_run() {
	gh run list --workflow="${WORKFLOW}" --event pull_request --limit 30 \
		--json databaseId,status,conclusion,headBranch,createdAt \
		| jq -r --arg b "${BRANCH}" '
			[.[] | select(.headBranch == $b)]
			| sort_by(.createdAt)
			| reverse
			| .[0].databaseId // empty
		'
}

run_id=""
appear_deadline=$((SECONDS + APPEAR_SEC))
while (( SECONDS < appear_deadline )); do
	run_id="$(find_run)"
	if [[ -n "${run_id}" ]]; then
		echo "found promote run ${run_id}"
		break
	fi
	sleep 5
done

if [[ -z "${run_id}" ]]; then
	echo "promote run did not appear within ${APPEAR_SEC}s; continuing"
	exit 0
fi

watch_deadline=$((SECONDS + TIMEOUT_SEC))
while true; do
	meta="$(gh run view "${run_id}" --json status,conclusion)"
	status="$(jq -r '.status' <<<"${meta}")"
	conclusion="$(jq -r '.conclusion // empty' <<<"${meta}")"
	echo "promote run ${run_id}: status=${status} conclusion=${conclusion}"
	if [[ "${status}" == "completed" ]]; then
		exit 0
	fi
	if (( SECONDS >= watch_deadline )); then
		echo "timed out waiting for promote run ${run_id}; continuing"
		exit 0
	fi
	sleep 5
done
