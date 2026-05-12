/**
 * VOLATILE 流：stream_chunk + chunkSeq 本地缓冲，直至 stream_end 线性化。
 * 不入 DAG；联邦不提供 stream_chunk_nack（计划 6.4），缺口仅本地 UI 提示。
 *
 * @returns {object} 带 addChunk / end / linearize / getChunk / clear 的缓冲 API
 */
export function createVolatileStreamBuffer() {
	/** @type {Map<string, { chunks: Map<number, string>, ended: boolean }>} */
	const streams = new Map()

	return {
		/**
		 * 追加一个分片；同一 pendingStreamId 下按 chunkSeq 去重覆盖
		 *
		 * @param {string} pendingStreamId 流标识（与 stream_chunk 等消息中的 pendingStreamId 一致）
		 * @param {number} chunkSeq 分片序号，从 1 递增
		 * @param {string} text 本分片正文
		 */
		addChunk(pendingStreamId, chunkSeq, text) {
			let s = streams.get(pendingStreamId)
			if (!s) {
				s = { chunks: new Map(), ended: false }
				streams.set(pendingStreamId, s)
			}
			if (!s.ended) s.chunks.set(chunkSeq, text)
		},
		/**
		 * 标记流已结束；linearize 时不再在末尾期待更高序号
		 *
		 * @param {string} pendingStreamId 流标识
		 */
		end(pendingStreamId) {
			const s = streams.get(pendingStreamId)
			if (s) s.ended = true
		},
		/**
		 * 返回从 1..max 连续前缀文本；遇首个缺失序号则返回 gapAt
		 *
		 * @param {string} pendingStreamId 流标识
		 * @returns {{ text: string, gapAt: number | null }} 已拼连续前缀；gapAt 为首个缺失的 chunkSeq，无缺口则为 null
		 */
		linearize(pendingStreamId) {
			const s = streams.get(pendingStreamId)
			if (!s) return { text: '', gapAt: null }
			const keys = [...s.chunks.keys()].sort((a, b) => a - b)
			if (!keys.length) return { text: '', gapAt: s.ended ? null : 1 }
			let expect = 1
			let text = ''
			for (const k of keys) {
				if (k !== expect) return { text, gapAt: expect }
				text += s.chunks.get(k) || ''
				expect++
			}
			if (!s.ended) return { text, gapAt: expect }
			return { text, gapAt: null }
		},
		/**
		 * 取单个 chunkSeq 的文本（仅本地调试/扩展；非联邦补传协议）
		 *
		 * @param {string} pendingStreamId 流标识
		 * @param {number} chunkSeq 要读取的分片序号
		 * @returns {string | null} 该序号已有正文则返回；流不存在或该序号尚无数据则 null
		 */
		getChunk(pendingStreamId, chunkSeq) {
			const s = streams.get(pendingStreamId)
			if (!s) return null
			return s.chunks.has(chunkSeq) ? s.chunks.get(chunkSeq) ?? null : null
		},
		/**
		 * 从缓冲中移除整条流及其分片
		 *
		 * @param {string} pendingStreamId 流标识
		 */
		clear(pendingStreamId) {
			streams.delete(pendingStreamId)
		},
	}
}
