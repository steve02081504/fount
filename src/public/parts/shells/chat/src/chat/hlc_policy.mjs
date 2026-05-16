/** §0：治理类事件在 HLC wall 远超当前时钟时硬拒绝（防排序前端霸占）。 */

/**
 * `hlcMaxSkewMs` 默认（毫秒）；可被 `groupSettings.hlcMaxSkewMs` 覆盖。
 */
export const DEFAULT_HLC_MAX_SKEW_MS = 3_600_000

/**
 * 须在 skew 超出阈值时硬拒绝的类型（折叠/权限链相关）。
 * @type {ReadonlySet<string>}
 */
/** 超 skew 时隔离、不入库（§0 消息类软处理简化为丢弃） */
export const MESSAGE_HLC_QUARANTINE_TYPES = new Set([
	'message',
	'message_append',
	'message_edit',
	'message_delete',
	'reaction_add',
	'reaction_remove',
	'message_feedback',
])

/**
 *
 */
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
 * @param {{ groupSettings?: { hlcMaxSkewMs?: unknown } } | null | undefined} state 物化群状态
 * @returns {number} 正整数 skew 上限（毫秒）
 */
export function resolveHlcMaxSkewMs(state) {
	const raw = state?.groupSettings?.hlcMaxSkewMs
	const n = Number(raw)
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HLC_MAX_SKEW_MS
}

/**
 * @param {{ type?: unknown, hlc?: unknown }} event DAG 事件
 * @param {number} maxSkewMs skew 上限（毫秒）
 * @returns {number | null} 未来偏移毫秒；无法计算时为 null
 */
export function hlcFutureDriftMs(event, maxSkewMs) {
	void maxSkewMs
	if (!event || typeof event !== 'object') return null
	const hlc = event.hlc && typeof event.hlc === 'object' ? event.hlc : null
	const wall = hlc && typeof hlc.wall === 'number' && Number.isFinite(hlc.wall) ? hlc.wall : null
	if (wall == null) return null
	const drift = wall - Date.now()
	return drift > 0 ? drift : null
}

/**
 * 消息类事件 HLC 是否超出允许未来偏移（§0 隔离语义）。
 * @param {{ type?: unknown, hlc?: unknown }} event DAG 事件
 * @param {number} maxSkewMs 允许的未来偏移上限（毫秒）
 * @returns {boolean} 是否应隔离（消息类超远未来戳）
 */
export function isMessageHlcQuarantined(event, maxSkewMs) {
	const t = typeof event.type === 'string' ? event.type : ''
	if (!MESSAGE_HLC_QUARANTINE_TYPES.has(t)) return false
	const drift = hlcFutureDriftMs(event, maxSkewMs)
	return drift != null && drift > maxSkewMs
}

/**
 * 治理类事件 HLC 超 skew 时抛出（§0 硬拒绝）。
 * @param {{ type?: unknown, hlc?: unknown }} event DAG 事件
 * @param {number} maxSkewMs 允许的未来偏移上限（毫秒）
 * @returns {void}
 */
export function assertGovernanceHlcSkewAllowed(event, maxSkewMs) {
	if (!event || typeof event !== 'object') return
	const t = typeof event.type === 'string' ? event.type : ''
	if (!GOVERNANCE_HLC_HARD_REJECT_TYPES.has(t)) return
	const drift = hlcFutureDriftMs(event, maxSkewMs)
	if (drift != null && drift > maxSkewMs)
		throw new Error(`governance event HLC skew too large (${t}, max ${maxSkewMs}ms)`)
}
