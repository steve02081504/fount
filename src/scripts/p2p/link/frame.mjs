import { randomBytes } from 'node:crypto'

/**
 * 二进制帧协议版本号。
 */
export const FRAME_VERSION = 1
/**
 * msgId 字段字节长度（128 位）。
 */
export const FRAME_MSG_ID_BYTES = 16
/**
 * 帧头字节长度：version(1) + msgId(16) + seq(4) + total(4)。
 */
export const FRAME_HEADER_BYTES = 1 + FRAME_MSG_ID_BYTES + 4 + 4
/**
 * 默认单帧最大 chunk 大小（15 KiB）。
 */
export const DEFAULT_MAX_FRAME_CHUNK_BYTES = 15 * 1024
/**
 * 重组后消息最大字节数（8 MiB）。
 */
export const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
/**
 * 同时进行中的分片消息数量上限。
 */
export const DEFAULT_MAX_PARTIAL_MESSAGES = 32
/**
 * 分片消息超时时间（毫秒）。
 */
export const DEFAULT_PARTIAL_TIMEOUT_MS = 30_000

/**
 * 将输入规范化为 Uint8Array。
 * @param {unknown} value 原始字节数据
 * @returns {Uint8Array} 字节视图
 */
function normalizeBytes(value) {
	if (value instanceof Uint8Array) return value
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
	throw new Error('p2p: frame bytes must be Uint8Array-compatible')
}

/**
 * 将 msgId 规范化为 16 字节 Uint8Array。
 * @param {unknown} msgId hex 字符串或 16 字节 Uint8Array
 * @returns {Uint8Array} 16 字节 msgId
 */
function normalizeMsgIdBytes(msgId) {
	if (msgId instanceof Uint8Array) {
		if (msgId.byteLength !== FRAME_MSG_ID_BYTES)
			throw new Error(`p2p: msgId must be ${FRAME_MSG_ID_BYTES} bytes`)
		return msgId
	}
	const text = String(msgId ?? '').trim().toLowerCase()
	if (!/^[\da-f]{32}$/u.test(text))
		throw new Error('p2p: msgId must be 32 hex characters')
	return Uint8Array.from(text.match(/../g).map(chunk => Number.parseInt(chunk, 16)))
}

/**
 * 将 msgId 字节转为 32 字符小写 hex。
 * @param {Uint8Array} bytes 16 字节 msgId
 * @returns {string} hex 字符串
 */
export function msgIdBytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 生成随机 msgId hex 字符串。
 * @returns {string} 32 字符 hex msgId
 */
export function randomMsgIdHex() {
	return msgIdBytesToHex(randomBytes(FRAME_MSG_ID_BYTES))
}

/**
 * 将消息体拆分为带帧头的二进制帧数组。
 * @param {string | Uint8Array} msgId 消息 ID
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} bytes 消息体字节
 * @param {number} [maxChunkBytes=DEFAULT_MAX_FRAME_CHUNK_BYTES] 单帧最大 chunk 大小
 * @returns {Uint8Array[]} 帧数组
 */
export function encodeFrames(msgId, bytes, maxChunkBytes = DEFAULT_MAX_FRAME_CHUNK_BYTES) {
	const body = normalizeBytes(bytes)
	const idBytes = normalizeMsgIdBytes(msgId)
	const chunkBytes = Math.max(256, Math.min(DEFAULT_MAX_MESSAGE_BYTES, Number(maxChunkBytes) || DEFAULT_MAX_FRAME_CHUNK_BYTES))
	const total = Math.max(1, Math.ceil(body.byteLength / chunkBytes))
	/** @type {Uint8Array[]} */
	const frames = []
	for (let seq = 0; seq < total; seq++) {
		const start = seq * chunkBytes
		const end = Math.min(body.byteLength, start + chunkBytes)
		const chunk = body.subarray(start, end)
		const frame = new Uint8Array(FRAME_HEADER_BYTES + chunk.byteLength)
		frame[0] = FRAME_VERSION
		frame.set(idBytes, 1)
		const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
		view.setUint32(1 + FRAME_MSG_ID_BYTES, seq, false)
		view.setUint32(1 + FRAME_MSG_ID_BYTES + 4, total, false)
		frame.set(chunk, FRAME_HEADER_BYTES)
		frames.push(frame)
	}
	return frames
}

/**
 * 解析单帧二进制数据。
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} frame 原始帧字节
 * @returns {{ version: number, msgId: string, seq: number, total: number, chunk: Uint8Array }} 帧字段
 */
export function decodeFrame(frame) {
	const bytes = normalizeBytes(frame)
	if (bytes.byteLength < FRAME_HEADER_BYTES)
		throw new Error('p2p: frame too short')
	const version = bytes[0]
	if (version !== FRAME_VERSION)
		throw new Error(`p2p: unsupported frame version ${version}`)
	const msgId = msgIdBytesToHex(bytes.subarray(1, 1 + FRAME_MSG_ID_BYTES))
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const seq = view.getUint32(1 + FRAME_MSG_ID_BYTES, false)
	const total = view.getUint32(1 + FRAME_MSG_ID_BYTES + 4, false)
	if (!total || seq >= total)
		throw new Error('p2p: invalid frame sequence')
	return {
		version,
		msgId,
		seq,
		total,
		chunk: bytes.subarray(FRAME_HEADER_BYTES),
	}
}

/**
 * 按序拼接多个 chunk 为完整消息体。
 * @param {Uint8Array[]} chunks 已排序的 chunk 数组
 * @returns {Uint8Array} 拼接后的消息体
 */
function concatChunks(chunks) {
	const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
	const out = new Uint8Array(totalBytes)
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.byteLength
	}
	return out
}

/**
 * 创建分片消息重组器。
 * @param {{ maxMessageBytes?: number, maxPartials?: number, partialTimeoutMs?: number }} [opts] 大小、并发分片数与超时配置
 * @returns {{ push: (frame: Uint8Array | ArrayBuffer | ArrayBufferView, now?: number) => Uint8Array | null, prune: (now?: number) => string[], clear: () => void, size: () => number }} 重组器 API
 */
export function createReassembler(opts = {}) {
	const maxMessageBytes = Math.max(1024, Number(opts.maxMessageBytes) || DEFAULT_MAX_MESSAGE_BYTES)
	const maxPartials = Math.max(1, Number(opts.maxPartials) || DEFAULT_MAX_PARTIAL_MESSAGES)
	const partialTimeoutMs = Math.max(1000, Number(opts.partialTimeoutMs) || DEFAULT_PARTIAL_TIMEOUT_MS)
	/** @type {Map<string, { total: number, chunks: Uint8Array[], seen: boolean[], bytes: number, firstSeenAt: number, lastSeenAt: number }>} */
	const partials = new Map()

	/**
	 * 丢弃指定 msgId 的分片状态。
	 * @param {string} msgId 消息 ID
	 * @returns {void}
	 */
	function drop(msgId) {
		partials.delete(msgId)
	}

	return {
		/**
		 * 喂入一帧，收齐全部分片时返回完整消息体。
		 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} frame 原始帧字节
		 * @param {number} [now=Date.now()] 当前时间戳（毫秒）
		 * @returns {Uint8Array | null} 完整消息体，未收齐时返回 null
		 */
		push(frame, now = Date.now()) {
			const parsed = decodeFrame(frame)
			if (!partials.has(parsed.msgId) && partials.size >= maxPartials)
				throw new Error('p2p: too many partial messages')
			let partial = partials.get(parsed.msgId)
			if (!partial) {
				partial = {
					total: parsed.total,
					chunks: new Array(parsed.total),
					seen: new Array(parsed.total).fill(false),
					bytes: 0,
					firstSeenAt: now,
					lastSeenAt: now,
				}
				partials.set(parsed.msgId, partial)
			}
			if (partial.total !== parsed.total) {
				drop(parsed.msgId)
				throw new Error('p2p: frame total mismatch')
			}
			partial.lastSeenAt = now
			if (!partial.seen[parsed.seq]) {
				partial.chunks[parsed.seq] = parsed.chunk
				partial.seen[parsed.seq] = true
				partial.bytes += parsed.chunk.byteLength
				if (partial.bytes > maxMessageBytes) {
					drop(parsed.msgId)
					throw new Error('p2p: reassembled message exceeds limit')
				}
			}
			if (partial.seen.every(Boolean)) {
				const out = concatChunks(partial.chunks)
				drop(parsed.msgId)
				return out
			}
			return null
		},
		/**
		 * 清理超时的分片消息。
		 * @param {number} [now=Date.now()] 当前时间戳（毫秒）
		 * @returns {string[]} 被丢弃的 msgId 列表
		 */
		prune(now = Date.now()) {
			/** @type {string[]} */
			const expired = []
			for (const [msgId, partial] of partials.entries())
				if (now - partial.lastSeenAt > partialTimeoutMs) {
					expired.push(msgId)
					partials.delete(msgId)
				}
			return expired
		},
		/**
		 * 清空所有进行中的分片状态。
		 * @returns {void}
		 */
		clear() {
			partials.clear()
		},
		/**
		 * 返回当前进行中的分片消息数量。
		 * @returns {number} 分片 msgId 数量
		 */
		size() {
			return partials.size
		},
	}
}
