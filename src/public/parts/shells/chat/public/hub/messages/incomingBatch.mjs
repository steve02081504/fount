/**
 * 【文件】public/hub/messages/incomingBatch.mjs
 * 【职责】增量批次 → 替换/追加行的纯分类（供 applyIncomingMessageBatch 使用）。
 * 对 batch 内重复 eventId 与本批已 append 的行去重，杜绝同一条消息被 append 两次进 DOM。
 */
/**
 * @param {object[]} batch 入站批次
 * @param {object[]} source 当前 channelMessagesSource（合并前）
 * @param {object[]} view 当前展示列表 channelMessages（合并后）
 * @param {Iterable<string>} [queuedEventIds] 虚拟列表当前队列中的 eventId；命中视为已在列表中，避免重复 append
 * @returns {{ replaceRows: Array<{ index: number, row: object }>, appendRows: object[] }} 分类结果
 */
export function classifyIncomingBatch(batch, source, view, queuedEventIds = null) {
	const oldIds = new Set((source || []).map(row => String(row.eventId || '')).filter(Boolean))
	// 已到达 source 或已进入虚拟列表队列的行都算「已知」，只需 replace，不得再 append。
	for (const eventId of queuedEventIds || [])
		if (eventId) oldIds.add(String(eventId))
	const replaceRows = []
	const appendRows = []
	const appended = new Set()
	const replacedIndices = new Set()
	for (const message of batch || []) {
		const eventId = String(message?.eventId || '')
		if (!eventId) continue
		const viewIndex = (view || []).findIndex(row => String(row.eventId) === eventId)
		if (viewIndex < 0) continue
		if (oldIds.has(eventId)) {
			if (replacedIndices.has(viewIndex)) continue
			replacedIndices.add(viewIndex)
			replaceRows.push({ index: viewIndex, row: view[viewIndex] })
		}
		else {
			if (appended.has(eventId)) continue
			appended.add(eventId)
			appendRows.push(view[viewIndex])
		}
	}
	return { replaceRows, appendRows }
}
