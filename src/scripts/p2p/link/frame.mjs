import { randomBytes } from 'node:crypto'

export const FRAME_VERSION = 1
export const FRAME_MSG_ID_BYTES = 16
export const FRAME_HEADER_BYTES = 1 + FRAME_MSG_ID_BYTES + 4 + 4
export const DEFAULT_MAX_FRAME_CHUNK_BYTES = 15 * 1024
export const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
export const DEFAULT_MAX_PARTIAL_MESSAGES = 32
export const DEFAULT_PARTIAL_TIMEOUT_MS = 30_000

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
function normalizeBytes(value) {
	if (value instanceof Uint8Array) return value
	if (value instanceof ArrayBuffer) return new Uint8Array(value)
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
	throw new Error('p2p: frame bytes must be Uint8Array-compatible')
}

/**
 * @param {unknown} msgId
 * @returns {Uint8Array}
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
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function msgIdBytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @returns {string}
 */
export function randomMsgIdHex() {
	return msgIdBytesToHex(randomBytes(FRAME_MSG_ID_BYTES))
}

/**
 * @param {string | Uint8Array} msgId
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} bytes
 * @param {number} [maxChunkBytes=DEFAULT_MAX_FRAME_CHUNK_BYTES]
 * @returns {Uint8Array[]}
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
 * @param {Uint8Array | ArrayBuffer | ArrayBufferView} frame
 * @returns {{ version: number, msgId: string, seq: number, total: number, chunk: Uint8Array }}
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
 * @param {Uint8Array[]} chunks
 * @returns {Uint8Array}
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
 * @param {{ maxMessageBytes?: number, maxPartials?: number, partialTimeoutMs?: number }} [opts]
 * @returns {{ push: (frame: Uint8Array | ArrayBuffer | ArrayBufferView, now?: number) => Uint8Array | null, prune: (now?: number) => string[], clear: () => void, size: () => number }}
 */
export function createReassembler(opts = {}) {
	const maxMessageBytes = Math.max(1024, Number(opts.maxMessageBytes) || DEFAULT_MAX_MESSAGE_BYTES)
	const maxPartials = Math.max(1, Number(opts.maxPartials) || DEFAULT_MAX_PARTIAL_MESSAGES)
	const partialTimeoutMs = Math.max(1000, Number(opts.partialTimeoutMs) || DEFAULT_PARTIAL_TIMEOUT_MS)
	/** @type {Map<string, { total: number, chunks: Uint8Array[], seen: boolean[], bytes: number, firstSeenAt: number, lastSeenAt: number }>} */
	const partials = new Map()

	/**
	 * @param {string} msgId
	 * @returns {void}
	 */
	function drop(msgId) {
		partials.delete(msgId)
	}

	return {
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
		clear() {
			partials.clear()
		},
		size() {
			return partials.size
		},
	}
}
