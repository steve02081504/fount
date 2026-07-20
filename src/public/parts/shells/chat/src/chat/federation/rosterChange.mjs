const FEDERATION_ROSTER_EVENT_TYPES = new Set([
	'member_join',
	'member_leave',
	'member_kick',
	'member_ban',
	'member_unban',
])

/**
 * @param {{ type?: unknown, content?: unknown } | null | undefined} event DAG 事件
 * @returns {boolean} 是否应因成员/房间密钥变更重绑 federation room
 */
export function shouldRebindFederationRoomForEvent(event) {
	const type = String(event?.type || '').trim()
	if (FEDERATION_ROSTER_EVENT_TYPES.has(type)) return true
	if (type !== 'group_settings_update') return false
	const roomSecret = String(event?.content?.roomSecret || '').trim()
	return !!roomSecret
}
