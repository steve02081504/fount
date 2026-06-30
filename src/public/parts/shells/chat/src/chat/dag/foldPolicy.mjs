/** 归档后可从 DAG 删除的过程事件类型。reaction_* 保留在 events.jsonl 以便联邦 gossip 按 id 补洞。 */
export const FOLDABLE_PROCESS_EVENT_TYPES = new Set([
	'message_edit',
	'pin_message',
	'unpin_message',
])

/**
 * @param {object} event DAG 事件
 * @param {Set<string>} archivedMessageIds 已归档 message id
 * @param {Set<string>} protectedHotIds 热区 message id
 * @param {boolean} dagFoldAfterArchive 是否删除已归档 message
 * @returns {boolean} true = 从 DAG 删除
 */
export function shouldDropDagEvent(event, archivedMessageIds, protectedHotIds, dagFoldAfterArchive) {
	const type = event.type
	if (FOLDABLE_PROCESS_EVENT_TYPES.has(type)) return true
	if (type === 'message') {
		const id = String(event.id).trim()
		if (protectedHotIds.has(id)) return false
		if (dagFoldAfterArchive && archivedMessageIds.has(id)) return true
		return false
	}
	return false
}
