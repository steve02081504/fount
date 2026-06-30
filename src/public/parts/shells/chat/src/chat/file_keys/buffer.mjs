/**
 * 频道 ckg / 文件主密钥解密待重试缓冲（联邦先到未来代密文时计数，轮换后 flush）。
 */

/** @type {Map<string, Map<number, number>>} */
const pendingByGroup = new Map()

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @returns {string} 复合键
 */
function bufKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * 记录一条因缺少对应 generation 密钥而未能解密的密文。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {number | null} generation 信封 generation
 * @returns {void}
 */
export function recordPendingChannelDecrypt(username, groupId, generation) {
	if (generation == null || !Number.isFinite(generation)) return
	const k = bufKey(username, groupId)
	let m = pendingByGroup.get(k)
	if (!m) {
		m = new Map()
		pendingByGroup.set(k, m)
	}
	m.set(Math.floor(generation), (m.get(Math.floor(generation)) || 0) + 1)
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @returns {{ total: number, byGeneration: Record<string, number> }} 待解密统计
 */
export function getPendingDecryptBufferStats(username, groupId) {
	const m = pendingByGroup.get(bufKey(username, groupId))
	if (!m || !m.size) return { total: 0, byGeneration: {} }
	/** @type {Record<string, number>} */
	const byGeneration = {}
	let total = 0
	for (const [gen, n] of m) {
		byGeneration[String(gen)] = n
		total += n
	}
	return { total, byGeneration }
}

/**
 * 文件主密钥轮换后清除已覆盖代数及以下的缓冲计数。
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {number} newGeneration 已写入的最新代数
 * @returns {number} 清除的待解密条数
 */
export function flushPendingDecryptAfterFileKeyRotation(username, groupId, newGeneration) {
	const k = bufKey(username, groupId)
	const m = pendingByGroup.get(k)
	if (!m || !m.size) return 0
	let cleared = 0
	for (const [gen, n] of [...m.entries()])
		if (gen <= newGeneration) {
			cleared += n
			m.delete(gen)
		}

	if (!m.size) pendingByGroup.delete(k)
	return cleared
}
