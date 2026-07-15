/**
 * Social 时间线远程入站验证链（不含磁盘写入）。
 */
import { computeEventId, eventBodyForSign } from 'npm:@steve02081504/fount-p2p/dag/index'
import { isPubKeyHashBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { verifyTimelineRemoteSignature } from 'npm:@steve02081504/fount-p2p/timeline/verify_remote'

import { SOCIAL_TIMELINE_EVENT_TYPES, timelineGroupId } from '../namespace.mjs'
import { isTimelineWriteAuthorized } from '../write_auth.mjs'

/**
 * @param {object} event 签名事件
 * @param {string} entityHash 时间线 owner
 * @param {{ canonicalize: (event: object) => object, priorEvents?: object[], username?: string }} deps 规范化依赖
 * @returns {Promise<{ accepted: true, row: object } | { accepted: false }>} 验证结果
 */
export async function validateRemoteTimelineEvent(event, entityHash, { canonicalize, priorEvents = [], username } = {}) {
	if (!SOCIAL_TIMELINE_EVENT_TYPES.has(event.type)) return { accepted: false }
	if (event.groupId !== timelineGroupId(entityHash)) return { accepted: false }
	const sender = event.sender.trim().toLowerCase()
	if (isPubKeyHashBlocked(sender)) return { accepted: false }
	const body = eventBodyForSign(event)
	if (computeEventId(body) !== event.id) return { accepted: false }
	if (!await verifyTimelineRemoteSignature(event)) return { accepted: false }
	if (!await isTimelineWriteAuthorized(entityHash, sender, {
		eventType: event.type,
		eventContent: event.content,
		priorEvents,
		username,
	})) return { accepted: false }
	try {
		return { accepted: true, row: canonicalize(event) }
	}
	catch {
		return { accepted: false }
	}
}
