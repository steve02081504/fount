/**
 * 入群前 MQTT 凭证 bootstrap（物化 state 尚无 mqttRoomSecret 时，供 ensureFederationRoom 首次 catch-up）。
 */

/** @type {Map<string, { mqttAppId: string, mqttRoomSecret: string, setAt: number, settingsEventId?: string }>} */
const bootstrapByKey = new Map()

/** @type {Map<string, { mqttAppId: string, mqttRoomSecret: string, fromNodeId: string, setAt: number, settingsEventId?: string }>} */
const peerHintByKey = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} Map 键
 */
export function federationBootstrapKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ mqttAppId?: string, mqttRoomSecret: string }} creds 邀请/bootstrap 凭证
 * @returns {void}
 */
export function setFederationBootstrap(username, groupId, creds) {
	if (!creds.mqttRoomSecret) return
	bootstrapByKey.set(federationBootstrapKey(username, groupId), {
		mqttAppId: creds.mqttAppId || 'fount-group-fed',
		mqttRoomSecret: creds.mqttRoomSecret,
		setAt: Date.now(),
		settingsEventId: creds.settingsEventId?.trim() || undefined,
	})
	peerHintByKey.delete(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ mqttAppId?: string, mqttRoomSecret: string, fromNodeId: string, settingsEventId?: string }} hint 邻居提供的口令提示
 * @returns {void}
 */
export function setPeerMqttHint(username, groupId, hint) {
	if (!hint.mqttRoomSecret) return
	peerHintByKey.set(federationBootstrapKey(username, groupId), {
		mqttAppId: hint.mqttAppId || 'fount-group-fed',
		mqttRoomSecret: hint.mqttRoomSecret,
		fromNodeId: String(hint.fromNodeId || '').trim(),
		setAt: Date.now(),
		settingsEventId: hint.settingsEventId?.trim() || undefined,
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ mqttAppId: string, mqttRoomSecret: string } | undefined} 暂存凭证或 undefined
 */
export function peekFederationBootstrap(username, groupId) {
	return bootstrapByKey.get(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ mqttAppId: string, mqttRoomSecret: string, fromNodeId: string, setAt: number, settingsEventId?: string } | undefined} 邻居 MQTT 提示
 */
export function peekPeerMqttHint(username, groupId) {
	return peerHintByKey.get(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ bootstrap?: object, peerHint?: object } | undefined} 优先 bootstrap，其次 peer hint
 */
export function peekPreferredMqttOverride(username, groupId) {
	return peekFederationBootstrap(username, groupId) || peekPeerMqttHint(username, groupId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function clearFederationBootstrap(username, groupId) {
	const key = federationBootstrapKey(username, groupId)
	bootstrapByKey.delete(key)
	peerHintByKey.delete(key)
}
