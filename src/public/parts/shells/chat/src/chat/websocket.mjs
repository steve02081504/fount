import { createHash } from 'node:crypto'

import { createVolatileStreamBuffer } from '../../../../../../scripts/p2p/volatile_streams.mjs'

// ─── IP 限流 ────────────────────────────────────────────────────────────────

/** IP 限流：{ip} -> { count, resetAt } */
const ipWsRequests = new Map()
const IP_WS_WINDOW_MS = 60_000
const IP_WS_MAX = 60

/**
 * WS 升级前 IP 限流检查（每分钟最多 60 次）。
 * @param {string} ip
 * @returns {boolean} true=允许，false=拒绝
 */
export function checkWsRateLimit(ip) {
	const now = Date.now()
	let entry = ipWsRequests.get(ip)
	if (!entry || now > entry.resetAt) {
		entry = { count: 0, resetAt: now + IP_WS_WINDOW_MS }
		ipWsRequests.set(ip, entry)
	}
	entry.count++
	return entry.count <= IP_WS_MAX
}

// ─── PoW 质询 ───────────────────────────────────────────────────────────────

/** GET /pow-challenge 下发的质询，单次使用 */
/** @type {Map<string, { challenge: string, expires: number }>} */
const powChallenges = new Map()

function powChallengeKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * 注册 PoW 质询（由 GET …/pow-challenge 调用，约 10 分钟内有效）。
 * @param {string} username
 * @param {string} groupId
 * @param {string} challenge
 * @param {number} [ttlMs]
 */
export function setPowChallenge(username, groupId, challenge, ttlMs = 600_000) {
	powChallenges.set(powChallengeKey(username, groupId), {
		challenge,
		expires: Date.now() + ttlMs,
	})
}

/**
 * 校验 PoW：`sha256(utf8(\`${groupId}:${challenge}:${nonce}\`))` 的 hex 字符串前 `difficulty` 个字符均为 `0`。
 * 须与已注册的 challenge 一致，通过后删除质询（单次使用）。
 * @param {string} username
 * @param {string} groupId
 * @param {number} difficulty 0–64，为 0 时视为不校验
 * @param {{ challenge?: unknown, nonce?: unknown }} [powSolution]
 * @returns {boolean}
 */
export function verifyPowSolution(username, groupId, difficulty, powSolution) {
	const d = Math.max(0, Math.min(64, Math.floor(Number(difficulty) || 0)))
	if (d <= 0) return true
	if (!powSolution || typeof powSolution !== 'object') return false
	const ch = powSolution.challenge
	const nonce = powSolution.nonce
	if (ch == null || nonce == null) return false
	const key = powChallengeKey(username, groupId)
	const entry = powChallenges.get(key)
	if (!entry || entry.expires < Date.now()) return false
	if (String(ch) !== entry.challenge) return false
	const hex = createHash('sha256')
		.update(`${groupId}:${String(ch)}:${String(nonce)}`, 'utf8')
		.digest('hex')
	if (!hex.startsWith('0'.repeat(d))) return false
	powChallenges.delete(key)
	return true
}

// ─── WebSocket 广播 ──────────────────────────────────────────────────────────

/** @type {Map<string, Set<import('npm:websocket-express').WebSocket>>} */
const sockets = new Map()

/**
 * @param {string} chatId
 * @param {import('npm:websocket-express').WebSocket} ws
 */
export function registerSocket(chatId, ws) {
	if (!sockets.has(chatId)) sockets.set(chatId, new Set())
	sockets.get(chatId).add(ws)
	ws.on('close', () => {
		sockets.get(chatId)?.delete(ws)
	})
}

/**
 * @param {string} chatId
 * @param {object} payload
 */
export function broadcastEvent(chatId, payload) {
	const set = sockets.get(chatId)
	if (!set) return
	const raw = JSON.stringify({ ...payload, t: Date.now() })
	for (const ws of set)
		try {
			ws.send(raw)
		}
		catch (e) {
			console.error('broadcast failed', e)
		}
}

// ─── 流式 AI chunk 缓冲（用于 NACK 补传）────────────────────────────────────

/**
 * `${chatId}:${pendingStreamId}` -> VolatileStreamBuffer
 * @type {Map<string, ReturnType<typeof createVolatileStreamBuffer>>}
 */
const streamBuffers = new Map()

function streamBufferKey(chatId, pendingStreamId) {
	return `${chatId}\0${pendingStreamId}`
}

/**
 * 将 AI 流式 chunk 存入服务端缓冲（供 NACK 补传）。
 * @param {string} chatId
 * @param {string} pendingStreamId
 * @param {number} chunkSeq
 * @param {string} text
 */
export function bufferStreamChunk(chatId, pendingStreamId, chunkSeq, text) {
	const key = streamBufferKey(chatId, pendingStreamId)
	if (!streamBuffers.has(key))
		streamBuffers.set(key, createVolatileStreamBuffer())
	streamBuffers.get(key).addChunk(pendingStreamId, chunkSeq, text)
}

/**
 * 标记流结束，60 秒后自动清理缓冲（留余量让迟到 NACK 仍能补传）。
 * @param {string} chatId
 * @param {string} pendingStreamId
 */
export function finishStreamBuffer(chatId, pendingStreamId) {
	const key = streamBufferKey(chatId, pendingStreamId)
	const buf = streamBuffers.get(key)
	if (buf) {
		buf.end(pendingStreamId)
		setTimeout(() => {
			buf.clear(pendingStreamId)
			streamBuffers.delete(key)
		}, 60_000)
	}
}

/**
 * 取单个 chunk（用于 NACK 补传响应）。
 * @param {string} chatId
 * @param {string} pendingStreamId
 * @param {number} chunkSeq
 * @returns {string | null}
 */
export function getBufferedChunk(chatId, pendingStreamId, chunkSeq) {
	const key = streamBufferKey(chatId, pendingStreamId)
	return streamBuffers.get(key)?.getChunk(pendingStreamId, chunkSeq) ?? null
}
