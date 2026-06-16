/**
 * Hub 消息 eventId 比较（DAG hex64 小写；保留 `pending:` 前缀临时 ID）。
 * @param {unknown} id 原始 ID
 * @returns {string} 规范化后的比较键
 */
export function normalizeEventId(id) {
	const raw = String(id ?? '').trim()
	if (raw.toLowerCase().startsWith('pending:'))
		return raw.toLowerCase()
	return raw.toLowerCase().replace(/^0x/iu, '')
}

/**
 * @param {unknown} a ID A
 * @param {unknown} b ID B
 * @returns {boolean} 是否同一 eventId
 */
export function eventIdsEqual(a, b) {
	return normalizeEventId(a) === normalizeEventId(b)
}
