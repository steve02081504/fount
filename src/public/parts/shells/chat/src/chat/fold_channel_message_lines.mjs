import { DEFAULT_LOGICAL_STREAM_IDLE_MS } from '../../../../../../scripts/p2p/constants.mjs'

/**
 *
 */
export { DEFAULT_LOGICAL_STREAM_IDLE_MS }

/**
 * 将频道 JSONL 时间线中的 `message` 与同 `logical_stream_id` 的后续 `message_append` 折叠为单条展示行。
 * 相邻分片间隔超过 `streamIdleMs` 则置 `content._logicalStreamTruncated` 并丢弃同流后续孤儿分片。
 *
 * @param {object[]} lines 原始消息行（时间顺序）
 * @param {number} [streamIdleMs] 空闲阈值
 * @returns {object[]} 折叠后的新数组（深拷贝头行，不修改磁盘结构语义）
 */
export function foldMessageAppendStreamLines(lines, streamIdleMs = DEFAULT_LOGICAL_STREAM_IDLE_MS) {
	if (!Array.isArray(lines) || !lines.length) return lines || []
	const idle = Number(streamIdleMs)
	const ms = Number.isFinite(idle) && idle > 0 ? idle : DEFAULT_LOGICAL_STREAM_IDLE_MS
	/** @type {object[]} */
	const out = []
	let i = 0
	while (i < lines.length) {
		const line = lines[i]
		if (line.type !== 'message') {
			out.push(line)
			i++
			continue
		}
		const head = line
		const c0 = head.content && typeof head.content === 'object' ? head.content : {}
		const sid = (typeof c0.logical_stream_id === 'string' && c0.logical_stream_id.trim())
			|| head.eventId
		const merged = JSON.parse(JSON.stringify(head))
		if (!merged.content || typeof merged.content !== 'object') merged.content = {}
		let lastTs = Number(head.timestamp) || 0
		let j = i + 1
		/** @type {{ chunk_index: number | null, text: string, ts: number }[]} */
		const pieces = []
		while (j < lines.length) {
			const n = lines[j]
			if (n.type !== 'message_append') break
			const c = n.content && typeof n.content === 'object' ? n.content : {}
			const ls = typeof c.logical_stream_id === 'string' ? c.logical_stream_id.trim() : ''
			if (!ls || ls !== sid) break
			const ts = Number(n.timestamp) || 0
			if (lastTs && ts - lastTs > ms) {
				merged.content._logicalStreamTruncated = true
				break
			}
			pieces.push({
				chunk_index: typeof c.chunk_index === 'number' ? c.chunk_index : null,
				text: String(c.text ?? ''),
				ts,
			})
			lastTs = ts
			j++
		}
		if (pieces.length) {
			pieces.sort((a, b) => {
				if (a.chunk_index != null && b.chunk_index != null) return a.chunk_index - b.chunk_index
				return a.ts - b.ts
			})
			merged.content.text = String(merged.content.text ?? '') + pieces.map(p => p.text).join('')
		}
		out.push(merged)
		let skip = j
		while (skip < lines.length && lines[skip].type === 'message_append') {
			const c = lines[skip].content && typeof lines[skip].content === 'object' ? lines[skip].content : {}
			const ls = typeof c.logical_stream_id === 'string' ? c.logical_stream_id.trim() : ''
			if (ls !== sid) break
			skip++
		}
		i = skip > i + 1 ? skip : i + 1
	}
	return out
}
