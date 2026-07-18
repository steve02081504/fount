/** DAG 事件 id：64 位小写 hex（不含乐观 `pending:`）。 */
const DAG_EVENT_ID_RE = /^[\da-f]{64}$/u

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

/**
 * 是否为可写入 DAG 的真实消息 eventId（排除乐观 `pending:`）。
 * @param {unknown} id 原始 ID
 * @returns {boolean} 是否为 64 hex
 */
export function isDagEventId(id) {
	return DAG_EVENT_ID_RE.test(normalizeEventId(id))
}
