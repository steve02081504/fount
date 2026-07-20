/**
 * 批量退群：单请求内按有限并发处理多个群。
 */
import { mapPool } from 'npm:@steve02081504/fount-p2p/utils/map_pool'

import { CHAT_LEAVE_BATCH_MAX } from '../lib/batchLimits.mjs'


import { appendMemberLeaveFast, resolveLeaveMembership } from './leaveFast.mjs'
import { removeLocalGroupReplica } from './lifecycle.mjs'

const DEFAULT_CONCURRENCY = 4

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [entityHash] 签名实体；缺省为 operator
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>} 成功或失败原因
 */
export async function performLocalGroupLeave(username, groupId, entityHash) {
	const leaveCtx = await resolveLeaveMembership(username, groupId, entityHash)
	if (!leaveCtx)
		return { ok: false, error: 'Not a member' }
	await appendMemberLeaveFast(username, groupId, leaveCtx)
	await removeLocalGroupReplica(username, groupId, { state: leaveCtx.state })
	return { ok: true }
}

/**
 * @param {string} username 用户
 * @param {string[]} groupIds 群 ID 列表（去重）
 * @param {{ concurrency?: number }} [options] 并发上限（默认 4，最大 8）
 * @returns {Promise<{ ok: string[], failed: { groupId: string, error: string }[] }>} 成功与失败群 ID 列表
 */
export async function leaveManyGroupsForUser(username, groupIds, options = {}) {
	const ids = [...new Set(
		(Array.isArray(groupIds) ? groupIds : [])
			.map(id => String(id ?? '').trim())
			.filter(Boolean),
	)]
	if (ids.length > CHAT_LEAVE_BATCH_MAX) {
		const err = new Error(`At most ${CHAT_LEAVE_BATCH_MAX} groups per leave request`)
		err.code = 'BATCH_LIMIT'
		throw err
	}
	if (!ids.length)
		return { ok: [], failed: [] }

	const concurrency = Math.max(1, Math.min(8, Number(options.concurrency) || DEFAULT_CONCURRENCY))
	/** @type {string[]} */
	const ok = []
	/** @type {{ groupId: string, error: string }[]} */
	const failed = []

	await mapPool(ids, async groupId => {
		try {
			const result = await performLocalGroupLeave(username, groupId)
			if (result.ok)
				ok.push(groupId)
			else failed.push({ groupId, error: result.error })
		}
		catch (err) {
			failed.push({ groupId, error: err?.message || String(err) })
		}
	}, concurrency)

	return { ok, failed }
}
