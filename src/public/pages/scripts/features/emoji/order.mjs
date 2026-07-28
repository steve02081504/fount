/**
 * emoji pack 五档排序纯函数。
 *
 * 档位：
 * 1. 最近使用（700 窗口内单表情次数降序）
 * 2. 当前上下文默认包
 * 3. 窗口内用过的包（次数降序）
 * 4. 其余可用默认包（lastUsedAt 降序，未用过按加入时间降序）
 * 5. Unicode 原生分组（由调用方追加）
 */

/**
 * 使用统计窗口大小（条数）。
 */
export const USAGE_WINDOW = 700

/**
 * @param {string} packId 包 id
 * @param {string} emojiId 表情 id
 * @returns {string} 日志 id
 */
export function packEmojiUsageId(packId, emojiId) {
	return `p:${packId}/${emojiId}`
}

/**
 * @param {string} unicode unicode 字形
 * @returns {string} 日志 id
 */
export function unicodeUsageId(unicode) {
	return `u:${unicode}`
}

/**
 * @param {{ id: string, at?: number }[]} log 使用日志（新在后）
 * @param {number} [windowSize] 保留条数上限
 * @returns {{ id: string, at: number }[]} 裁剪后的窗口
 */
export function trimUsageLog(log, windowSize = USAGE_WINDOW) {
	const list = Array.isArray(log) ? log : []
	if (list.length <= windowSize) return list.map(e => ({ id: String(e.id), at: Number(e.at) || 0 }))
	return list.slice(-windowSize).map(e => ({ id: String(e.id), at: Number(e.at) || 0 }))
}

/**
 * @param {{ id: string }[]} log 使用日志窗口
 * @returns {Map<string, number>} id → 次数
 */
export function countUsageInWindow(log) {
	/** @type {Map<string, number>} */
	const counts = new Map()
	for (const entry of log || []) {
		const id = String(entry?.id || '')
		if (!id) continue
		counts.set(id, (counts.get(id) || 0) + 1)
	}
	return counts
}

/**
 * @param {string} usageId `p:packId/emojiId` 或 `u:…`
 * @returns {{ kind: 'pack', packId: string, emojiId: string } | { kind: 'unicode', unicode: string } | null} 解析结果
 */
export function parseUsageId(usageId) {
	const id = String(usageId || '')
	if (id.startsWith('u:')) {
		const unicode = id.slice(2)
		return unicode ? { kind: 'unicode', unicode } : null
	}
	if (id.startsWith('p:')) {
		const body = id.slice(2)
		const slash = body.indexOf('/')
		if (slash <= 0) return null
		const packId = body.slice(0, slash)
		const emojiId = body.slice(slash + 1)
		if (!packId || !emojiId) return null
		return { kind: 'pack', packId, emojiId }
	}
	// 兼容旧 g:groupId/emojiId
	if (id.startsWith('g:')) {
		const body = id.slice(2)
		const slash = body.indexOf('/')
		if (slash <= 0) return null
		return { kind: 'pack', packId: body.slice(0, slash), emojiId: body.slice(slash + 1) }
	}
	return null
}

/**
 * 从窗口日志得到「最近使用」表情项（次数降序）。
 * @param {{ id: string }[]} log 使用日志窗口
 * @returns {{ usageId: string, count: number, parsed: object }[]} 按次数降序
 */
export function recentEmojisFromLog(log) {
	const counts = countUsageInWindow(log)
	return [...counts.entries()]
		.map(([usageId, count]) => ({ usageId, count, parsed: parseUsageId(usageId) }))
		.filter(e => e.parsed)
		.sort((a, b) => b.count - a.count || a.usageId.localeCompare(b.usageId))
}

/**
 * @param {{ id: string }[]} log 使用日志窗口
 * @returns {Map<string, number>} packId → 窗口内次数
 */
export function packCountsFromLog(log) {
	/** @type {Map<string, number>} */
	const counts = new Map()
	for (const entry of log || []) {
		const parsed = parseUsageId(entry?.id)
		if (parsed?.kind !== 'pack') continue
		counts.set(parsed.packId, (counts.get(parsed.packId) || 0) + 1)
	}
	return counts
}

/**
 * 五档中的包顺序（不含最近使用项与 Unicode）。
 * @param {object} input 排序输入 排序输入
 * @param {object[]} input.packs 可用且可见的包（含 packId、defaultFor?、joinedAt?）
 * @param {string[]} [input.contextDefaultPackIds] 当前群 / 回复对象默认包
 * @param {{ id: string }[]} input.log 已裁剪的 700 日志
 * @param {Record<string, number>} [input.lastUsedAtByPack] 包级最近使用时间戳
 * @returns {{ tier: number, packId: string }[]} 档位与 packId（tier 2–4）
 */
export function orderPackSections({ packs, contextDefaultPackIds = [], log, lastUsedAtByPack = {} }) {
	const packById = new Map((packs || []).map(p => [p.packId, p]))
	const packCounts = packCountsFromLog(log)
	const contextSet = new Set((contextDefaultPackIds || []).filter(id => packById.has(id)))
	/** @type {Set<string>} */
	const placed = new Set()
	/** @type {{ tier: number, packId: string }[]} */
	const out = []

	for (const packId of contextDefaultPackIds || []) {
		if (!packById.has(packId) || placed.has(packId)) continue
		placed.add(packId)
		out.push({ tier: 2, packId })
	}

	const usedPacks = [...packCounts.entries()]
		.filter(([packId]) => packById.has(packId) && !placed.has(packId))
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
	for (const [packId] of usedPacks) {
		placed.add(packId)
		out.push({ tier: 3, packId })
	}

	const rest = [...packById.keys()]
		.filter(id => !placed.has(id))
		.sort((a, b) => {
			const la = Number(lastUsedAtByPack[a]) || 0
			const lb = Number(lastUsedAtByPack[b]) || 0
			if (la !== lb) return lb - la
			const ja = Number(packById.get(a)?.joinedAt) || 0
			const jb = Number(packById.get(b)?.joinedAt) || 0
			if (ja !== jb) return jb - ja
			return a.localeCompare(b)
		})
	for (const packId of rest)
		out.push({ tier: 4, packId })

	void contextSet
	return out
}
