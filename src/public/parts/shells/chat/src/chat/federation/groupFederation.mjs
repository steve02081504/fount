/**
 * 群级联邦生命周期：首次邀请或 DM 创世时激活；mqttRoomSecret 写入后不可撤销。
 */
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { getState } from '../dag/materialize.mjs'

import { DEFAULT_MQTT_APP_ID, mintMqttRoomSecret, mqttCredentialsFromGroupSettings } from './mqttCredentials.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache } from './room.mjs'

/**
 * @param {object} [groupSettings] 物化群设置
 * @returns {boolean} 群是否已激活联邦同步（DAG 含 mqttRoomSecret）
 */
export function isGroupFederationActive(groupSettings = {}) {
	return !!mqttCredentialsFromGroupSettings(groupSettings)
}

/**
 * 首次邀请时写入 mqttRoomSecret 并加入联邦房间；已激活则直接返回凭证。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<{ mqttAppId: string, mqttRoomSecret: string }>} MQTT 凭证
 */
export async function activateGroupFederation(username, groupId) {
	const { state } = await getState(username, groupId)
	const existing = mqttCredentialsFromGroupSettings(state.groupSettings)
	if (existing) return existing

	const gs = state.groupSettings
	await appendSignedLocalEvent(username, groupId, {
		type: 'group_settings_update',
		timestamp: Date.now(),
		content: {
			mqttAppId: gs.mqttAppId || DEFAULT_MQTT_APP_ID,
			mqttRoomSecret: mintMqttRoomSecret(),
			...gs.federationPartitionCount == null ? { federationPartitionCount: 8 } : {},
			...gs.rtcConnectionBudgetMax == null ? { rtcConnectionBudgetMax: 32 } : {},
			...gs.rtcJoinRatePerMin == null ? { rtcJoinRatePerMin: 12 } : {},
		},
	})
	invalidateFederationRoomCache(username, groupId)
	const { state: after } = await getState(username, groupId)
	const creds = mqttCredentialsFromGroupSettings(after.groupSettings)
	if (!creds) throw new Error('failed to activate group federation')
	void ensureFederationRoom(username, groupId).catch(console.error)
	return creds
}
