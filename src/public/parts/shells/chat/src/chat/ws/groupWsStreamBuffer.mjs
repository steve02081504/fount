/**
 * 进行中角色回复的 VOLATILE 分片内存缓冲（晚加入 WS / HTTP 补拉）。
 */
import { createVolatileStreamBuffer } from 'npm:@steve02081504/fount-p2p/federation/volatile_streams'

/** @type {Map<string, ReturnType<typeof createVolatileStreamBuffer>>} */
const streamBuffers = new Map()

/**
 * @param {string} groupId 群 ID
 * @param {string} pendingStreamId 流 ID
 * @returns {string} 缓冲 Map 键
 */
function streamBufferKey(groupId, pendingStreamId) {
	return `${groupId}\0${pendingStreamId}`
}

/**
 * @param {string} groupId 群 ID
 * @param {string} pendingStreamId 流 ID
 * @param {number} chunkSeq 分片序号
 * @param {object[]} slices 差异切片
 * @returns {void}
 */
export function bufferStreamChunk(groupId, pendingStreamId, chunkSeq, slices) {
	const key = streamBufferKey(groupId, pendingStreamId)
	if (!streamBuffers.has(key))
		streamBuffers.set(key, createVolatileStreamBuffer())
	streamBuffers.get(key).addChunk(pendingStreamId, chunkSeq, JSON.stringify(slices))
}

/**
 * @param {string} groupId 群 ID
 * @param {string} pendingStreamId 流 ID
 * @returns {void}
 */
export function finishStreamBuffer(groupId, pendingStreamId) {
	const key = streamBufferKey(groupId, pendingStreamId)
	const buffer = streamBuffers.get(key)
	if (buffer) {
		buffer.end(pendingStreamId)
		setTimeout(() => {
			buffer.clear(pendingStreamId)
			streamBuffers.delete(key)
		}, 60_000)
	}
}

/**
 * @param {string} groupId 群 ID
 * @param {string} pendingStreamId 流 ID
 * @returns {{ chunkSeq: number, slices: object[] }[]} 已缓冲分片
 */
export function getBufferedStreamChunks(groupId, pendingStreamId) {
	const key = streamBufferKey(groupId, pendingStreamId)
	return streamBuffers.get(key)?.listChunks(pendingStreamId).map(({ chunkSeq, payload }) => ({
		chunkSeq,
		slices: JSON.parse(payload),
	})) ?? []
}
