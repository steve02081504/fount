/**
 * VOLATILE 流：`stream_chunk` 按 chunkSeq 缓冲 slices JSON；终稿由 DAG message_edit 结束（§6.4）。
 *
 * @returns {object} addChunk / end / listChunks / clear
 */
export function createVolatileStreamBuffer() {
	/** @type {Map<string, { chunks: Map<number, string>, ended: boolean }>} */
	const streams = new Map()

	return {
		/**
		 * @param {string} pendingStreamId 流 ID
		 * @param {number} chunkSeq 分片序号
		 * @param {string} payload JSON 序列化的 slices
		 * @returns {void}
		 */
		addChunk(pendingStreamId, chunkSeq, payload) {
			let stream = streams.get(pendingStreamId)
			if (!stream) {
				stream = { chunks: new Map(), ended: false }
				streams.set(pendingStreamId, stream)
			}
			if (!stream.ended) stream.chunks.set(chunkSeq, payload)
		},
		/**
		 * @param {string} pendingStreamId 流 ID
		 * @returns {void}
		 */
		end(pendingStreamId) {
			const stream = streams.get(pendingStreamId)
			if (stream) stream.ended = true
		},
		/**
		 * @param {string} pendingStreamId 流 ID
		 * @returns {{ chunkSeq: number, payload: string }[]} 升序分片列表
		 */
		listChunks(pendingStreamId) {
			const stream = streams.get(pendingStreamId)
			if (!stream) return []
			return [...stream.chunks.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([chunkSeq, payload]) => ({ chunkSeq, payload }))
		},
		/**
		 * @param {string} pendingStreamId 流 ID
		 * @returns {void}
		 */
		clear(pendingStreamId) {
			streams.delete(pendingStreamId)
		},
	}
}
