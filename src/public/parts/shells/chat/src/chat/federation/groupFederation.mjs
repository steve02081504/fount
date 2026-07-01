/**
 * 群级联邦生命周期：首次邀请或 DM 创世时激活；roomSecret 写入后不可撤销。
 */
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { getState } from '../dag/materialize.mjs'

import { ensureFederationRoom } from './room.mjs'
import { DEFAULT_SIGNALING_APP_ID, mintRoomSecret, roomCredentialsFromGroupSettings } from './roomCredentials.mjs'

/**
 * 激活联邦时的联邦发布 join 上限（毫秒）。
 *
 * roomSecret 写入 DAG 后即可凭票邀请；relay 不可达时不应阻塞 HTTP 响应，
 * 故 publish 最多等待该窗口，实际 relay 接入交由末尾的后台 ensureFederationRoom 兜底。
 * 与 `leaveFast.mjs` 的 `LEAVE_FEDERATION_JOIN_TIMEOUT_MS` 保持一致语义。
 */
const ACTIVATE_FEDERATION_JOIN_TIMEOUT_MS = 4000

/**
 * @param {object} [groupSettings] 物化群设置
 * @returns {boolean} 群是否已激活联邦同步（DAG 含 roomSecret）
 */
export function isGroupFederationActive(groupSettings = {}) {
	return !!roomCredentialsFromGroupSettings(groupSettings)
}

/**
 * 首次邀请时写入 roomSecret 并加入联邦房间；已激活则直接返回凭证。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<{ signalingAppId: string, roomSecret: string }>} 房间凭证
 */
export async function activateGroupFederation(username, groupId) {
	const { state } = await getState(username, groupId)
	const existing = roomCredentialsFromGroupSettings(state.groupSettings)
	if (existing) return existing

	const gs = state.groupSettings
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			signalingAppId: gs.signalingAppId || DEFAULT_SIGNALING_APP_ID,
			roomSecret: mintRoomSecret(),
			...gs.federationPartitionCount == null ? { federationPartitionCount: 8 } : {},
			...gs.rtcConnectionBudgetMax == null ? { rtcConnectionBudgetMax: 32 } : {},
			...gs.rtcJoinRatePerMin == null ? { rtcJoinRatePerMin: 12 } : {},
		},
	}, { federationJoinTimeoutMs: ACTIVATE_FEDERATION_JOIN_TIMEOUT_MS })
	const { state: after } = await getState(username, groupId)
	const creds = roomCredentialsFromGroupSettings(after.groupSettings)
	if (!creds) throw new Error('failed to activate group federation')
	// append 已通过 publishSignedEventToFederation 有界 join 建好 slot；切勿 invalidate 后 teardown 再异步 rejoin（会断链）。
	await ensureFederationRoom(username, groupId)
	return creds
}
