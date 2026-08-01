#!/usr/bin/env bash
# 等待「Promote test data cache」对指定 head 分支跑完（合并删分支 / 默认分支 Run Tests 用）。
# 环境：BRANCH（PR head 短名）GH_TOKEN；可选 APPEAR_SEC TIMEOUT_SEC PROMOTE_WORKFLOW
# 输出：result=skipped|promoted|failed|timeout → $GITHUB_OUTPUT（有则写）
set -euo pipefail

BRANCH="${BRANCH:?BRANCH required}"
WORKFLOW="${PROMOTE_WORKFLOW:-promote_test_data_cache.yaml}"
APPEAR_SEC="${APPEAR_SEC:-120}"
TIMEOUT_SEC="${TIMEOUT_SEC:-300}"

emit_result() {
	local result="$1"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "result=${result}" >> "${GITHUB_OUTPUT}"
	fi
	echo "result=${result}"
}

# 无近期合并的同 head PR → 立刻返回（手动删分支等）
recent_pr="$(
	gh pr list --state merged --head "${BRANCH}" --limit 10 --json number,mergedAt \
		| jq -r --argjson now "$(date -u +%s)" '
			.[]
			| select(.mergedAt != null)
			| (.mergedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $merged_at_epoch
			| select(($now - $merged_at_epoch) < 900)
			| .number
		' \
		| head -n1
)"
if [[ -z "${recent_pr}" ]]; then
	echo "no PR from ${BRANCH} merged in last 15m; skip wait"
	emit_result skipped
	exit 0
fi
echo "PR #${recent_pr} recently merged from ${BRANCH}; waiting for ${WORKFLOW}"

# 用目标 PR 的 head SHA 关联 promote run（删分支后 pull_requests[] 常空）
head_sha="$(gh pr view "${recent_pr}" --json headRefOid --jq .headRefOid)"

find_run() {
	gh run list --workflow="${WORKFLOW}" --event pull_request --limit 30 \
		--json databaseId,status,conclusion,headBranch,headSha,createdAt \
		| jq -r --arg branch "${BRANCH}" --arg sha "${head_sha}" '
			[.[] | select(.headBranch == $branch and .headSha == $sha)]
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
	echo "promote run did not appear within ${APPEAR_SEC}s"
	emit_result timeout
	exit 0
fi

watch_deadline=$((SECONDS + TIMEOUT_SEC))
while true; do
	meta="$(gh run view "${run_id}" --json status,conclusion)"
	status="$(jq -r '.status' <<<"${meta}")"
	conclusion="$(jq -r '.conclusion // empty' <<<"${meta}")"
	echo "promote run ${run_id}: status=${status} conclusion=${conclusion}"
	if [[ "${status}" == "completed" ]]; then
		if [[ "${conclusion}" == "success" ]]; then
			emit_result promoted
		else
			emit_result failed
		fi
		exit 0
	fi
	if (( SECONDS >= watch_deadline )); then
		echo "timed out waiting for promote run ${run_id}"
		emit_result timeout
		exit 0
	fi
	sleep 5
done
