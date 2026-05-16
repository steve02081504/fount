/** §0：治理类事件在 HLC wall 远超当前时钟时硬拒绝（防排序前端霸占）。 */

/**
 * `hlcMaxSkewMs` 默认（毫秒）；可被 `groupSettings.hlcMaxSkewMs` 覆盖。
 */
export const DEFAULT_HLC_MAX_SKEW_MS = 3_600_000

/** 超 skew 时隔离、不入库（§0 消息类） */
export const MESSAGE_HLC_QUARANTINE_TYPES = new Set([
	'message',
	'message_append',
	'message_edit',
	'message_delete',
	'reaction_add',
	'reaction_remove',
	'message_feedback',
])

/** 超 skew 时硬拒绝的治理类事件（§0） */
export const GOVERNANCE_HLC_HARD_REJECT_TYPES = new Set([
	'member_kick',
	'member_ban',
	'member_unban',
	'role_create',
	'role_update',
	'role_delete',
	'role_assign',
	'role_revoke',
	'reputation_slash',
	'reputation_reset',
	'group_settings_update',
	'channel_permission_update',
	'owner_succession_ballot',
	'dag_tip_merge',
	'peer_invite',
])

/**
 * @param {{ groupSettings?: { hlcMaxSkewMs?: unknown } }} state 物化群状态
 * @returns {number} skew 上限（毫秒）
 */
export function resolveHlcMaxSkewMs(state) {
	const n = Number(state.groupSettings?.hlcMaxSkewMs)
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HLC_MAX_SKEW_MS
}

/**
 * @param {{ hlc?: { wall?: number } }} event DAG 事件
 * @returns {number | null} 未来偏移毫秒；非未来时为 null
 */
export function hlcFutureDriftMs(event) {
	const wall = event.hlc?.wall
	if (!Number.isFinite(wall)) return null
	const drift = wall - Date.now()
	return drift > 0 ? drift : null
}

/**
 * 消息类事件 HLC 是否超出允许未来偏移（§0 隔离语义）。
 * @param {{ type?: string, hlc?: { wall?: number } }} event DAG 事件
 * @param {number} maxSkewMs 允许的未来偏移上限（毫秒）
 * @returns {boolean} 是否应隔离
 */
export function isMessageHlcQuarantined(event, maxSkewMs) {
	if (!MESSAGE_HLC_QUARANTINE_TYPES.has(event.type)) return false
	const drift = hlcFutureDriftMs(event)
	return drift != null && drift > maxSkewMs
}

/**
 * 治理类事件 HLC 超 skew 时抛出（§0 硬拒绝）。
 * @param {{ type?: string, hlc?: { wall?: number } }} event DAG 事件
 * @param {number} maxSkewMs 允许的未来偏移上限（毫秒）
 * @returns {void}
 */
export function assertGovernanceHlcSkewAllowed(event, maxSkewMs) {
	if (!GOVERNANCE_HLC_HARD_REJECT_TYPES.has(event.type)) return
	const drift = hlcFutureDriftMs(event)
	if (drift != null && drift > maxSkewMs)
		throw new Error(`governance event HLC skew too large (${event.type}, max ${maxSkewMs}ms)`)
}
