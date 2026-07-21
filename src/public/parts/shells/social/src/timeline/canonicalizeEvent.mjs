/**
 * Social 时间线事件入库 canonicalize。
 */
import { canonicalizeSignedRow } from 'npm:@steve02081504/fount-p2p/dag/canonicalize_row'
import { validateRemoteEventShape } from 'npm:@steve02081504/fount-p2p/schemas/remote_event'

/** Social 时间线 canonicalize 选项 */
export const SOCIAL_TIMELINE_ROW_OPTS = {
	contentHexKeys: new Set([
		'targetPostId',
		'targetId',
		'noteEventId',
	]),
	entityHashKeys: new Set([
		'targetEntityHash',
	]),
}

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
