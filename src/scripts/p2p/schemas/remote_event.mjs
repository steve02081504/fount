import { assertHex64 } from '../hexIds.mjs'

/**
 * 远程入站事件形状校验（仅 federation / P2P 路径调用）。
 * @param {object} event DAG 事件
 * @returns {void}
 */
export function validateRemoteEventShape(event) {
	if (!event?.type || typeof event.type !== 'string')
		throw new Error('remote event: type required')
	assertHex64(event.id, 'remote event.id')
	if (!Array.isArray(event.prev_event_ids))
		throw new Error('remote event: prev_event_ids must be array')
	for (const parentId of event.prev_event_ids)
		assertHex64(parentId, 'remote event.prev_event_id')
	assertHex64(event.sender, 'remote event.sender')
}
