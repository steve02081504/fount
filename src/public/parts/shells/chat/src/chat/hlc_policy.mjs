/** §0：治理类事件在 HLC wall 远超当前时钟时硬拒绝（防排序前端霸占）。 */

/**
 * `hlcMaxSkewMs` 默认（毫秒）；可被 `groupSettings.hlcMaxSkewMs` 覆盖。
 */
export const DEFAULT_HLC_MAX_SKEW_MS = 3_600_000

/**
 * 须在 skew 超出阈值时硬拒绝的类型（折叠/权限链相关）。
 * @type {ReadonlySet<string>}
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
 * 若事件的 HLC wall 晚于本地时钟超过 `maxSkewMs` 且类型属治理硬拒绝集合，抛出错误。
 *
 * @param {{ type?: unknown, hlc?: unknown }} event DAG 事件
 * @param {number} maxSkewMs 允许的未来偏移（毫秒）
 * @returns {void}
 */
export function assertGovernanceHlcSkewAllowed(event, maxSkewMs) {
	if (!event || typeof event !== 'object') return
	const t = typeof event.type === 'string' ? event.type : ''
	if (!GOVERNANCE_HLC_HARD_REJECT_TYPES.has(t)) return
	const hlc = event.hlc && typeof event.hlc === 'object' ? event.hlc : null
	const wall = hlc && typeof hlc.wall === 'number' && Number.isFinite(hlc.wall) ? hlc.wall : null
	if (wall == null) return
	const drift = wall - Date.now()
	if (drift > maxSkewMs)
		throw new Error(`governance event HLC skew too large (${t}, max ${maxSkewMs}ms)`)
}
