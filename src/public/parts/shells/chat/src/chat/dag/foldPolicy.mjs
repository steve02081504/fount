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
 * @param {Set<string>} [tipIds] 当前 DAG tip id；仍为 tip 的 message 不得折叠（否则对端 tip_merge 缺父死锁）
 * @returns {boolean} true = 从 DAG 删除
 */
export function shouldDropDagEvent(event, archivedMessageIds, protectedHotIds, dagFoldAfterArchive, tipIds = null) {
	const type = event.type
	if (FOLDABLE_PROCESS_EVENT_TYPES.has(type)) return true
	if (type === 'message') {
		const id = String(event.id).trim()
		if (protectedHotIds.has(id)) return false
		if (tipIds?.has(id) || tipIds?.has(id)) return false
		if (dagFoldAfterArchive && archivedMessageIds.has(id)) return true
		return false
	}
	return false
}
