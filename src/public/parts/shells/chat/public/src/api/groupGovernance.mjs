/**
 * 【文件】public/src/api/groupGovernance.mjs
 * 【职责】群治理 API：fork、封对立分支、声誉、群主继任、轮换群钥、合并 DAG tips。
 * 【关联】groupClient.mjs；groupBan、审计与 Hub 管理 UI。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 将现有群 fork 为新群。
 * @param {string} sourceGroupId 源群 ID
 * @param {object} [opts] fork 请求体
 * @returns {Promise<any>} fork API 响应
 */
export async function forkGroupAsNew(sourceGroupId, opts = {}) {
	return groupFetch(groupPath(sourceGroupId, 'fork'), { method: 'POST', json: opts })
}

/**
 * 拉黑对立治理分支上的签发者（采纳叶 = 当前选支）。
 * @param {string} groupId 群 ID
 * @param {string} acceptedTipId 64 hex 叶 id
 * @returns {Promise<{ blocked: string[] }>} 被拉黑公钥哈希列表
 */
export async function blockOpposingForkBranch(groupId, acceptedTipId) {
	return groupFetch(groupPath(groupId, 'fork', 'block-opposing'), {
		method: 'POST',
		json: { acceptedTipId },
	})
}

/**
 * 追加用户级拉黑（`denylist.json`）。
 * @param {string|{ scope: string, value: string, groupId?: string }} entry 主体或 `{ scope, value }`
 * @param {string} [groupId] 来源群 ID（`entry` 为字符串时使用）
 * @returns {Promise<void>}
 */
export async function blockUser(entry, groupId) {
	const body = entry?.scope
		? { scope: entry.scope, value: entry.value, groupId: entry.groupId || groupId }
		: { scope: 'subject', value: entry, groupId }
	const response = await fetch('/api/p2p/denylist', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	const data = await response.json()
	if (!response.ok) throw new Error(data.error || 'denylist failed')
}

/**
 * 设置当前采纳的治理分支 tip。
 * @param {string} groupId 群 ID
 * @param {string} tipId 分支 tip 事件 ID
 * @returns {Promise<{ consensusBranchTip: string|null, localViewBranchTip: string|null, governanceFork: boolean }>} 更新后的分支状态
 */
export async function setGovernanceBranch(groupId, tipId) {
	const data = await groupFetch(groupPath(groupId, 'governance-branch'), {
		method: 'PUT',
		json: { tipId },
	})
	return {
		consensusBranchTip: data.consensusBranchTip ?? null,
		localViewBranchTip: data.localViewBranchTip ?? null,
		governanceFork: !!data.governanceFork,
	}
}

/**
 * 读取群主观信誉表。
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} `{ reputation }`
 */
export async function getGroupReputation() {
	return groupFetch('/api/parts/shells:chat/reputation')
}

/**
 * 发布 reputation_reset 事件。
 * @param {string} groupId 群 ID
 * @param {string} targetPubKeyHash 目标 64 hex
 * @returns {Promise<{ applied: number }>} 应用计数
 */
export async function postReputationReset(groupId, targetPubKeyHash) {
	return groupFetch(groupPath(groupId, 'reputation', 'reset'), {
		method: 'POST',
		json: { targetPubKeyHash: String(targetPubKeyHash || '').trim().toLowerCase() },
	})
}

/**
 * 发布声誉扣减事件。
 * @param {string} groupId 群 ID
 * @param {object} body 扣减参数（`targetPubKeyHash`、`claim`、`verified`、`proof` 等）
 * @returns {Promise<{ applied: number }>} 实际应用的事件数
 */
export async function postReputationSlash(groupId, body) {
	const payload = {
		targetPubKeyHash: String(body.targetPubKeyHash || '').trim().toLowerCase(),
		claim: Number(body.claim ?? 0.25),
	}
	if (body.verified) {
		payload.verified = true
		if (body.proof?.eventId) payload.proof = { eventId: String(body.proof.eventId).trim().toLowerCase() }
	}
	const data = await groupFetch(groupPath(groupId, 'reputation', 'slash'), {
		method: 'POST',
		json: payload,
	})
	return { applied: Number(data.applied) || 0 }
}

/**
 * 合并 DAG 分叉 tip（§8 治理）。
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} merge API 响应
 */
export async function mergeDagTips(groupId) {
	return groupFetch(groupPath(groupId, 'dag', 'merge-tips'), { method: 'POST', json: {} })
}

/**
 * 手动轮换群 GSH 密钥。
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} file-key-rotate 响应
 */
export async function rotateGroupKey(groupId) {
	return groupFetch(groupPath(groupId, 'file-key-rotate'), { method: 'POST', json: {} })
}

/**
 * 群主继任联署提交。
 * @param {string} groupId 群 ID
 * @param {object} body `{ proposedOwnerPubKeyHash, ballotId, adminSignatures?, thresholdRatio? }`
 * @returns {Promise<object>} 服务端 JSON 响应
 */
export async function submitOwnerSuccession(groupId, body) {
	return groupFetch(groupPath(groupId, 'owner-succession'), { method: 'POST', json: body })
}

/**
 * 解封成员。
 * @param {string} groupId 群 ID
 * @param {string} pubKeyHash 成员公钥哈希（用户名键）
 * @returns {Promise<void>}
 */
export async function unbanMember(groupId, pubKeyHash) {
	await groupFetch(groupPath(groupId, 'members', pubKeyHash, 'unban'), { method: 'POST', json: {} })
}
