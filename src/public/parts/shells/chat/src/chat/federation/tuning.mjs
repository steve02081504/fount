/**
 * 【文件】federation/tuning.mjs
 * 【职责】联邦分区/RTC 预算调参：校验后写 group_settings_update 并失效房间缓存。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'

import { invalidateFederationRoomCache } from './room.mjs'

/**
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {{
 *   federationPartitionCount?: number,
 *   rtcConnectionBudgetMax?: number,
 *   rtcJoinRatePerMin?: number,
 * }} fields 调参字段
 * @param {{ entityHash?: string }} [signOptions] 自签选项
 * @returns {Promise<object>} 实际写入的 patch
 */
export async function setFederationTuning(username, groupId, fields = {}, signOptions = {}) {
	const patch = {}
	const partitionCount = Number(fields.federationPartitionCount)
	if (Number.isFinite(partitionCount))
		patch.federationPartitionCount = Math.max(2, Math.min(64, Math.floor(partitionCount)))
	const rtcBudget = Number(fields.rtcConnectionBudgetMax)
	if (Number.isFinite(rtcBudget))
		patch.rtcConnectionBudgetMax = Math.max(8, Math.min(128, Math.floor(rtcBudget)))
	const rtcJoinRate = Number(fields.rtcJoinRatePerMin)
	if (Number.isFinite(rtcJoinRate))
		patch.rtcJoinRatePerMin = Math.max(4, Math.min(60, Math.floor(rtcJoinRate)))
	if (!Object.keys(patch).length)
		throw httpError(400, 'no valid tuning fields')
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: patch,
	}, signOptions)
	invalidateFederationRoomCache(username, groupId)
	return patch
}
