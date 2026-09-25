/**
 * 【文件】public/src/lib/cacheBadge.mjs — 最低缓存命中率徽章
 * 【职责】把列表页预计算的最低缓存复用率渲染为带颜色的徽章。
 * 【原理】与 conversation 详情的逐生成徽章同阈值（≥60% 绿，否则红）；无有效数据时不渲染。
 * 【关联】lib/conversationItem.mjs、lib/generationItem.mjs、views/dashboard.mjs。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

/** 缓存复用率的合格阈值。 */
export const CACHE_GOOD_RATIO = 0.6

/**
 * 构造最低缓存命中率徽章；无有效数据时返回 null。
 * @param {number | null | undefined} rate 最低缓存复用率
 * @returns {HTMLElement | null} 徽章元素
 */
export function createCacheBadge(rate) {
	if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
	const badge = document.createElement('span')
	badge.className = `badge badge-sm ${rate >= CACHE_GOOD_RATIO ? 'badge-success' : 'badge-error'}`
	badge.textContent = geti18n('agent_studio.conversation.cache.lowest', { rate: Math.round(rate * 100) })
	badge.title = geti18n('agent_studio.conversation.cache.hint')
	return badge
}
