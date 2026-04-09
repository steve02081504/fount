/**
 * VOLATILE 流：stream_chunk + chunkSeq + NACK 直至 stream_end
 * 不入 DAG；供 UI/联邦层使用
 */
export function createVolatileStreamBuffer() {
	/** @type {Map<string, { chunks: Map<number, string>, ended: boolean }>} */
	const streams = new Map()

	return {
		/**
		 * @param {string} pendingStreamId
		 * @param {number} chunkSeq
		 * @param {string} text
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
		 * @param {string} pendingStreamId
		 */
		end(pendingStreamId) {
			const s = streams.get(pendingStreamId)
			if (s) s.ended = true
		},
		/**
		 * 返回从 1..max 连续前缀文本；缺口则返回 { gapAt }
		 * @param {string} pendingStreamId
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
		clear(pendingStreamId) {
			streams.delete(pendingStreamId)
		},
	}
}
