/**
 * Mailbox 重要性分层与评分（纯函数）。
 */

/** @typedef {'trusted' | 'normal' | 'quarantine'} MailboxTier */

const TIER_ORDER = { quarantine: 0, normal: 1, trusted: 2 }

/**
 * @param {number} score 信誉分
 * @returns {MailboxTier} 分层
 */
export function mailboxTierFromScore(score) {
	const numericScore = Number(score)
	if (!Number.isFinite(numericScore)) return 'quarantine'
	if (numericScore >= 0.45) return 'trusted'
	if (numericScore >= 0.12) return 'normal'
	return 'quarantine'
}

/**
 * @param {object} opts 参数
 * @param {number} [opts.senderScore] 发件方信誉
 * @param {number} [opts.recipientScore] 收件方关系信誉（可选）
 * @param {boolean} [opts.knownMember] 是否本地已知成员/节点
 * @param {number} [opts.hop] 转发跳数
 * @returns {{ tier: MailboxTier, score: number }} 分层与分数
 */
export function scoreMailboxImportance(opts = {}) {
	const sender = Number(opts.senderScore ?? 0)
	const recipient = Number(opts.recipientScore ?? sender)
	const known = !!opts.knownMember
	const hop = Math.max(0, Number(opts.hop) || 0)
	let score = sender * 0.65 + recipient * 0.35
	if (known) score += 0.15
	score -= hop * 0.08
	if (score < 0) score = 0
	if (score > 1) score = 1
	return { tier: mailboxTierFromScore(score), score }
}

/**
 * 按 tier 与 storedAt 排序（低 tier 先淘汰）。
 * @param {object[]} rows 记录
 * @returns {object[]} 排序后
 */
export function sortMailboxForRetention(rows) {
	return [...rows].sort((a, b) => {
		const ta = TIER_ORDER[a.tier || 'normal'] ?? 1
		const tb = TIER_ORDER[b.tier || 'normal'] ?? 1
		if (ta !== tb) return ta - tb
		return (a.storedAt || 0) - (b.storedAt || 0)
	})
}

/**
 * @param {MailboxTier} tier 分层
 * @returns {number} 默认 TTL 毫秒
 */
export function defaultTtlMsForTier(tier) {
	if (tier === 'trusted') return 30 * 24 * 3600 * 1000
	if (tier === 'normal') return 7 * 24 * 3600 * 1000
	return 24 * 3600 * 1000
}

/**
 * @param {MailboxTier} tier 分层
 * @returns {boolean} 是否允许继续转发
 */
export function allowMailboxRelayForTier(tier) {
	return tier !== 'quarantine'
}
