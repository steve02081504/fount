/**
 * 【文件】stream/groupWsRateLimit.mjs
 * 【职责】群 WebSocket 接入防护：按 IP 滑动窗口限流，以及 joinPolicy=pow 时的 PoW 质询签发与校验。
 * 【原理】checkWsRateLimit 维护 ipWsRequests 计数；setPowChallenge/verifyPowSolution 一次性 challenge，解为 sha256(groupId:challenge:nonce) 前导零位数达标。与 governance/joinPolicy 配合入群门槛。
 * 【数据结构】ipWsRequests Map；powChallenges Map→{ challenge, expires }。
 * 【关联】governance/joinPolicy.mjs、session/wsLifecycle 握手；HTTP GET pow-challenge 路由。
 */
import { createHash } from 'node:crypto'

/** IP 限流：{ip} -> { count, resetAt } */
const ipWsRequests = new Map()
const IP_WS_WINDOW_MS = 60_000
const IP_WS_MAX = 60

/** GET /pow-challenge 下发的质询，单次使用 */
/** @type {Map<string, { challenge: string, expires: number }>} */
const powChallenges = new Map()

/**
 * PoW 质询在内存 Map 中的复合键
 * @param {string} username 用户名
 * @param {string} groupId 群组 id
 * @returns {string} 内部 Map 键
 */
function powChallengeKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * WS 升级前 IP 限流检查（每分钟最多 60 次）。
 * @param {string} ip 客户端 IP（可取 X-Forwarded-For 首段）
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

/**
 * 注册 PoW 质询（由 GET …/pow-challenge 调用，约 10 分钟内有效）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 id
 * @param {string} challenge 服务端下发的随机质询串
 * @param {number} [ttlMs] 过期毫秒数，默认 10 分钟
 * @returns {void}
 */
export function setPowChallenge(username, groupId, challenge, ttlMs = 600_000) {
	powChallenges.set(powChallengeKey(username, groupId), {
		challenge,
		expires: Date.now() + ttlMs,
	})
}

/**
 * 校验 PoW：`sha256(utf8(\`${groupId}:${challenge}:${nonce}\`))` 的 hex 字符串前 `difficulty` 个字符均为 `0`。
 * @param {string} username 用户名（与注册质询时一致）
 * @param {string} groupId 群组 id
 * @param {number} difficulty 0–64，为 0 时视为不校验
 * @param {{ challenge?: unknown, nonce?: unknown }} [powSolution] 客户端提交的质询与 nonce
 * @returns {boolean} 校验通过或难度为 0 时为 true；否则 false
 */
export function verifyPowSolution(username, groupId, difficulty, powSolution) {
	const difficultyBits = Math.max(0, Math.min(64, Math.floor(Number(difficulty) || 0)))
	if (difficultyBits <= 0) return true
	const { challenge, nonce } = powSolution || {}
	if (challenge == null || nonce == null) return false
	const key = powChallengeKey(username, groupId)
	const entry = powChallenges.get(key)
	if (!entry || entry.expires < Date.now()) return false
	if (String(challenge) !== entry.challenge) return false
	const hex = createHash('sha256')
		.update(`${groupId}:${String(challenge)}:${String(nonce)}`, 'utf8')
		.digest('hex')
	if (!hex.startsWith('0'.repeat(difficultyBits))) return false
	powChallenges.delete(key)
	return true
}
