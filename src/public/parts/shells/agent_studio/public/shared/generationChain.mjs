/**
 * 【文件】generationChain.mjs — 生成记录纯函数
 * 【职责】按 `conversationId`/`chatId` 聚合生成记录，并按 `parentId` 构建父子链；前后端共用，无副作用。
 * 【原理】记录以 `id` 为节点、`parentId` 为边；找不到父节点的记录作为链根。
 * 【关联】agent_studio/src/generation_history.mjs 重导出；前端链视图。
 */

/**
 * @typedef {object} generationRecordSummary_t
 * @property {string} id
 * @property {string | null} [parentId]
 * @property {string} charId
 * @property {string} [charname]
 * @property {object} [subAgent]
 * @property {string} [chatId]
 * @property {string} [conversationId]
 * @property {string} source
 * @property {number} startedAt
 * @property {number} [finishedAt]
 * @property {string} [model]
 * @property {boolean} [hasError]
 */

/**
 * 按 `conversationId`（缺失时回退 `chatId`）聚合生成记录。
 * @param {generationRecordSummary_t[]} records 生成记录
 * @returns {Map<string, generationRecordSummary_t[]>} 会话键 → 记录列表
 */
export function groupByConversation(records) {
	const groups = new Map()
	for (const record of records || []) {
		const key = record.conversationId || record.chatId || ''
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key).push(record)
	}
	return groups
}

/**
 * 会话键：优先 `conversationId`，其次 `chatId`，都缺失时以记录自身 id 独立成组。
 * @param {generationRecordSummary_t} record 记录
 * @returns {string} 会话键
 */
export function conversationKey(record) {
	return record?.conversationId || record?.chatId || record?.id || ''
}

/**
 * 把生成记录摘要聚合为会话摘要列表（按最近活动倒序）。
 * @param {generationRecordSummary_t[]} records 生成记录摘要
 * @returns {Array<{ key: string, conversationId: string, chatId: string, source: string, charId: string, charname: string, startedAt: number|null, finishedAt: number|null, generationCount: number, errorCount: number, requestCount: number, lastModel: string|null }>} 会话摘要
 */
export function summarizeConversations(records) {
	const groups = new Map()
	for (const record of records || []) {
		const key = conversationKey(record)
		if (!groups.has(key)) groups.set(key, {
			key,
			conversationId: record.conversationId || '',
			chatId: record.chatId || '',
			source: record.source || '',
			charId: record.charId || '',
			charname: record.charname || '',
			startedAt: record.startedAt ?? null,
			finishedAt: record.finishedAt ?? record.startedAt ?? null,
			generationCount: 0,
			errorCount: 0,
			requestCount: 0,
			lastModel: record.model || null,
		})
		const group = groups.get(key)
		group.generationCount++
		if (record.hasError) group.errorCount++
		group.requestCount += record.requestCount ?? 0
		const startedAt = record.startedAt ?? null
		const finishedAt = record.finishedAt ?? record.startedAt ?? null
		if (startedAt != null) group.startedAt = group.startedAt == null ? startedAt : Math.min(group.startedAt, startedAt)
		if (finishedAt != null) group.finishedAt = group.finishedAt == null ? finishedAt : Math.max(group.finishedAt, finishedAt)
		if (record.model) group.lastModel = record.model
		if (record.charname) group.charname = record.charname
	}
	return [...groups.values()].sort((a, b) => (b.finishedAt ?? b.startedAt ?? 0) - (a.finishedAt ?? a.startedAt ?? 0))
}

/**
 * 按 `parentId` 构建生成链森林。
 * @param {generationRecordSummary_t[]} records 生成记录
 * @returns {Array<{ record: generationRecordSummary_t, children: object[] }>} 链根列表
 */
export function buildChains(records) {
	/** @type {Map<string, { record: generationRecordSummary_t, children: object[] }>} */
	const nodes = new Map()
	for (const record of records || [])
		nodes.set(record.id, { record, children: [] })
	const roots = []
	for (const node of nodes.values()) {
		const parent = node.record.parentId ? nodes.get(node.record.parentId) : null
		if (parent) parent.children.push(node)
		else roots.push(node)
	}
	return roots
}
