/**
 * Social 时间线事件入库 canonicalize。
 */
import { canonicalizeSignedRow } from '../../../../../../scripts/p2p/dag/canonicalizeRow.mjs'
import { validateRemoteEventShape } from '../../../../../../scripts/p2p/schemas/remote_event.mjs'

const TIMELINE_CONTENT_HEX_KEYS = new Set([
	'targetPostId',
	'targetId',
])

const TIMELINE_ENTITY_HASH_KEYS = new Set([
	'targetEntityHash',
])

const TIMELINE_ROW_OPTS = {
	contentHexKeys: TIMELINE_CONTENT_HEX_KEYS,
	entityHashKeys: TIMELINE_ENTITY_HASH_KEYS,
}

/**
 * @param {object} event 签名事件
 * @returns {object} canonical 行
 */
export function canonicalizeLocalTimelineEvent(event) {
	return canonicalizeSignedRow(event, TIMELINE_ROW_OPTS)
}

/**
 * @param {object} event 远程入站事件
 * @returns {object} canonical 行
 */
export function canonicalizeSignedTimelineEvent(event) {
	validateRemoteEventShape(event)
	return canonicalizeLocalTimelineEvent(event)
}
