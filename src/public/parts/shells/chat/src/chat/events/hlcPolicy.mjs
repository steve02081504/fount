/**
 * 【文件】`events/hlcPolicy.mjs` — HLC（Hybrid Logical Clock）时钟偏移策略。
 * 【职责】统一判定未来 HLC skew：`allow` / `quarantine`（消息类）/ `reject`（联邦 ACL 与其它）。
 * 【原理】阈值 `hlcMaxSkewMs`；消息类超 skew 隔离；aclGated 非 session 超 skew 硬拒；联邦入站 session_* 硬拒。
 * 【关联】`append.mjs`、`remoteIngest.mjs`、`event_types.mjs`、`quarantine.mjs`。
 */
import {
	FEDERATION_ACL_GATED_EVENT_TYPES,
	SESSION_EVENT_TYPES,
} from '../dag/eventTypes.mjs'

/**
 * `hlcMaxSkewMs` 默认（毫秒）；可被 `groupSettings.hlcMaxSkewMs` 覆盖。
 */
export const DEFAULT_HLC_MAX_SKEW_MS = 3_600_000

/** 超 skew 时隔离、不入主 DAG（§0 消息类） */
export const MESSAGE_HLC_QUARANTINE_TYPES = new Set([
	'message',
	'message_edit',
	'message_delete',
	'reaction_add',
	'reaction_remove',
	'message_feedback',
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
 * 未来 HLC skew 处置（单一入口）。
 * @param {{ type?: string, hlc?: { wall?: number } }} event DAG 事件
 * @param {number} maxSkewMs 允许的未来偏移上限（毫秒）
 * @param {{ source?: 'local' | 'federation' }} [opts] local 允许 session_* 超 skew
 * @returns {'allow' | 'quarantine' | 'reject'} 未来 skew 处置
 */
export function classifyHlcSkewAction(event, maxSkewMs, opts = {}) {
	const drift = hlcFutureDriftMs(event)
	if (drift == null || drift <= maxSkewMs) return 'allow'

	const type = String(event?.type || '')
	if (MESSAGE_HLC_QUARANTINE_TYPES.has(type)) return 'quarantine'

	if (SESSION_EVENT_TYPES.has(type))
		return opts.source === 'federation' ? 'reject' : 'allow'

	if (FEDERATION_ACL_GATED_EVENT_TYPES.has(type)) return 'reject'

	return 'reject'
}
