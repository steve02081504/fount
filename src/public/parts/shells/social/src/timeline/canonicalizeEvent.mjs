/**
 * Social 时间线事件入库 canonicalize。
 */
import { SOCIAL_TIMELINE_ROW_OPTS } from '../../../../../../scripts/p2p/dag/canonicalize_presets.mjs'
import { canonicalizeSignedRow } from '../../../../../../scripts/p2p/dag/canonicalizeRow.mjs'
import { validateRemoteEventShape } from '../../../../../../scripts/p2p/schemas/remote_event.mjs'

/**
 * @param {object} event 签名事件
 * @returns {object} canonical 行
 */
export function canonicalizeLocalTimelineEvent(event) {
	return canonicalizeSignedRow(event, SOCIAL_TIMELINE_ROW_OPTS)
}

/**
 * @param {object} event 远程入站事件
 * @returns {object} canonical 行
 */
export function canonicalizeSignedTimelineEvent(event) {
	validateRemoteEventShape(event)
	return canonicalizeLocalTimelineEvent(event)
}
