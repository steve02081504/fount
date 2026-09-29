import { sortedPrevEventIds } from 'npm:@steve02081504/fount-p2p/dag/index'

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
 * @param {Set<string>} [referencedIds] 被保留行引用的 id（含 checkpoint 锚点与被折叠行重新引用的父）
 * @returns {boolean} true = 从 DAG 删除
 */
export function shouldDropDagEvent(event, archivedMessageIds, protectedHotIds, dagFoldAfterArchive, tipIds = null, referencedIds = null) {
	const { type } = event
	const id = String(event.id).trim()
	const referenced = referencedIds?.has(id) === true
	if (FOLDABLE_PROCESS_EVENT_TYPES.has(type)) {
		// 过程事件仅在仍为 tip / 被保留行引用（或为 checkpoint 锚点）时保留；
		// 否则后续事件会因父节点被删而成为孤儿，物化折叠选支会丢链路。
		if (referenced || tipIds?.has(id)) return false
		return true
	}
	if (type === 'message') {
		// message 保持既有语义：热区/tip 保留，已归档则删除（允许悬挂父，正文已入冷归档）。
		// 只有可折叠过程事件才因「被引用」而保留，否则归档 GC 会因引用链而永远无法删除旧消息。
		if (protectedHotIds.has(id)) return false
		if (tipIds?.has(id)) return false
		if (dagFoldAfterArchive && archivedMessageIds.has(id)) return true
		return false
	}
	return false
}

/**
 * 计算折叠时必须保留的「被引用 id」闭包。
 *
 * 从所有不会因过程折叠而消失的行出发（非可折叠类型、热区/tip/未归档 message），沿
 * `prev_event_ids` 向父扩散；被引用的父即使是可折叠过程事件也纳入集合，从而保证保留行
 * 不会指向被删父。checkpoint 锚点始终纳入。已被折叠而缺失的 id 同样记入集合
 * （视为已引用），避免其经 gossip 重新出现时被误判为新 fork。
 * @param {object[]} rows 全部事件行
 * @param {{
 *   archivedMessageIds: Set<string>,
 *   protectedHotIds: Set<string>,
 *   dagFoldAfterArchive: boolean,
 *   tipIds?: Set<string> | null,
 *   anchorId?: string | null,
 * }} options 折叠判定参数
 * @returns {Set<string>} 被引用（须保留）的事件 id 集
 */
export function computeFoldReferencedIds(rows, options) {
	const { archivedMessageIds, protectedHotIds, dagFoldAfterArchive, tipIds = null, anchorId = null } = options
	/** @type {Map<string, object>} */
	const byId = new Map()
	for (const row of rows) {
		const id = String(row?.id ?? '').trim()
		if (id) byId.set(id, row)
	}
	/** @type {Set<string>} */
	const referencedIds = new Set()
	const anchor = String(anchorId ?? '').trim()
	if (anchor) referencedIds.add(anchor)

	// 初始保留集：不依赖「被引用」即应保留的行。
	/** @type {string[]} */
	const queue = []
	for (const row of rows) {
		const id = String(row?.id ?? '').trim()
		if (!id) continue
		if (!shouldDropDagEvent(row, archivedMessageIds, protectedHotIds, dagFoldAfterArchive, tipIds, null))
			queue.push(id)
	}

	while (queue.length) {
		const id = queue.pop()
		const row = byId.get(id)
		if (!row) continue
		for (const parentId of sortedPrevEventIds(row.prev_event_ids)) {
			const pid = String(parentId ?? '').trim()
			if (!pid || referencedIds.has(pid)) continue
			// 无论父是否仍在本地事件集（可能已被折叠）都记为被引用。
			referencedIds.add(pid)
			const parent = byId.get(pid)
			if (!parent) continue
			// 仅继续上溯最终策略下会被保留的父（避免把已归档 message 的父也拉进保留集）。
			if (!shouldDropDagEvent(parent, archivedMessageIds, protectedHotIds, dagFoldAfterArchive, tipIds, referencedIds))
				queue.push(pid)
		}
	}
	return referencedIds
}
