/**
 * 入群前房间凭证 bootstrap（物化 state 尚无 roomSecret 时，供 ensureFederationRoom 首次 catch-up）。
 */

/** @type {Map<string, { signalingAppId: string, roomSecret: string, dmSessionTag?: string, setAt: number, settingsEventId?: string, powAnchorRef?: string, powAnchors?: string[] }>} */
const bootstrapByKey = new Map()

/** @type {Map<string, { signalingAppId: string, roomSecret: string, dmSessionTag?: string, fromNodeId: string, setAt: number, settingsEventId?: string }>} */
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
 * @param {{ signalingAppId?: string, roomSecret: string, dmSessionTag?: string, powAnchorRef?: string, powAnchors?: string[] }} creds 邀请/bootstrap 凭证
 * @returns {void}
 */
export function setFederationBootstrap(username, groupId, creds) {
	if (!creds.roomSecret) return
	bootstrapByKey.set(federationBootstrapKey(username, groupId), {
		signalingAppId: creds.signalingAppId || 'fount-group-fed',
		roomSecret: creds.roomSecret,
		dmSessionTag: String(creds.dmSessionTag || '').trim().toLowerCase() || undefined,
		setAt: Date.now(),
		settingsEventId: creds.settingsEventId?.trim() || undefined,
		powAnchorRef: creds.powAnchorRef?.trim() || undefined,
		powAnchors: Array.isArray(creds.powAnchors) ? creds.powAnchors.map(String) : undefined,
	})
	peerHintByKey.delete(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ signalingAppId?: string, roomSecret: string, dmSessionTag?: string, fromNodeId: string, settingsEventId?: string }} hint 邻居提供的口令提示
 * @returns {void}
 */
export function setPeerRoomHint(username, groupId, hint) {
	if (!hint.roomSecret) return
	peerHintByKey.set(federationBootstrapKey(username, groupId), {
		signalingAppId: hint.signalingAppId || 'fount-group-fed',
		roomSecret: hint.roomSecret,
		dmSessionTag: String(hint.dmSessionTag || '').trim().toLowerCase() || undefined,
		fromNodeId: String(hint.fromNodeId || '').trim(),
		setAt: Date.now(),
		settingsEventId: hint.settingsEventId?.trim() || undefined,
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ signalingAppId: string, roomSecret: string, dmSessionTag?: string } | undefined} 暂存凭证或 undefined
 */
export function peekFederationBootstrap(username, groupId) {
	return bootstrapByKey.get(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ signalingAppId: string, roomSecret: string, dmSessionTag?: string, fromNodeId: string, setAt: number, settingsEventId?: string } | undefined} 邻居房间凭证提示
 */
export function peekPeerRoomHint(username, groupId) {
	return peerHintByKey.get(federationBootstrapKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ bootstrap?: object, peerHint?: object } | undefined} 优先 bootstrap，其次 peer hint
 */
export function peekPreferredRoomOverride(username, groupId) {
	return peekFederationBootstrap(username, groupId) || peekPeerRoomHint(username, groupId)
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
