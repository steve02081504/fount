/**
 * 【文件】public/src/api/groupFederation.mjs
 * 【职责】群联邦同步 API：向对等节点 catch-up、拉取缺失 DAG 事件。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 向联邦对等节点拉取缺失事件。
 * @param {string} groupId 群 ID
 * @param {object} [opts] catch-up 请求体
 * @returns {Promise<object>} 同步统计
 */
export async function federationCatchUp(groupId, opts = {}) {
	return groupFetch(groupPath(groupId, 'federation', 'catchup'), {
		method: 'POST',
		json: opts,
	})
}

/**
 * 重绑联邦分区（按当前活跃频道确保对应 ch-XX 房间已加入）。
 * @param {string} groupId 群 ID
 * @param {{ channelId?: string }} [opts] 活跃频道
 * @returns {Promise<{ ok: boolean, channelId: string | null }>} 重绑结果
 */
export async function rebindFederationRoom(groupId, opts = {}) {
	return groupFetch(groupPath(groupId, 'federation', 'rebind'), {
		method: 'POST',
		json: {
			channelId: opts.channelId || null,
		},
	})
}

/**
 * 更新联邦调优参数（分区数、RTC 连接预算、加入速率）。
 * @param {string} groupId 群 ID
 * @param {{ federationPartitionCount?: number, rtcConnectionBudgetMax?: number, rtcJoinRatePerMin?: number }} patch 调优字段
 * @returns {Promise<object>} API 响应
 */
export async function postFederationTuning(groupId, patch = {}) {
	return groupFetch(groupPath(groupId, 'federation', 'tuning'), {
		method: 'POST',
		json: patch,
	})
}

/**
 * 轮换群 房间口令（需 ADMIN / MANAGE_ADMINS）。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ roomSecret: string }>} 新口令
 */
export async function rotateFederationRoomSecret(groupId) {
	return groupFetch(groupPath(groupId, 'federation', 'rotate-room-secret'), { method: 'POST', json: {} })
}

/**
 * 向联邦邻居请求入群快照并本地应用（GSH + 频道历史）。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ applied: boolean, channels: number, skipped?: boolean }>} 应用统计
 */
export async function repairJoinSnapshot(groupId) {
	return groupFetch(groupPath(groupId, 'federation', 'join-snapshot'), { method: 'POST', json: {} })
}

/**
 * 增量拉取群事件。
 * @param {string} groupId 群 ID
 * @param {{ since?: string, channelId?: string, limit?: number }} [opts] 分页与过滤
 * @returns {Promise<{ events: object[], truncated: boolean }>} 事件列表及是否截断
 */
export async function pullGroupEvents(groupId, opts = {}) {
	const params = new URLSearchParams()
	if (opts.since) params.set('since', opts.since)
	if (opts.channelId) params.set('channelId', opts.channelId)
	if (opts.limit) params.set('limit', String(opts.limit))
	const query = params.toString()
	const data = await groupFetch(
		`${groupPath(groupId, 'events')}${query ? `?${query}` : ''}`,
		{ method: 'GET' },
	)
	return {
		events: Array.isArray(data.events) ? data.events : [],
		truncated: !!data.truncated,
	}
}
