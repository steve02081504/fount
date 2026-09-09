/**
 * `fount.user.send` 在 social 的触发帖定位（纯函数，Deno / 浏览器共用）。
 * 勿 import `/scripts/*` 或 `/parts/…` URL：可被 `public/src` 与纯测试引入。
 */
import { parseActionKey } from '../src/lib/actionKey.mjs'

/**
 * 从触发 `fount.user.send` 的元素向上定位其所属帖子。
 * 优先 `.post-card` 的 `data-author-entity` / `data-post-id`；回复行（非卡片内）兜底取
 * 最近 `[data-replies-for]` 面板的 actionKey。
 * @param {Element | { closest?: (selector: string) => object | null, dataset?: Record<string, string> } | null} element 触发元素
 * @returns {{ entityHash: string, postId: string } | null} 帖子定位；找不到为 `null`
 */
export function resolveTriggerPost(element) {
	const card = element?.closest?.('.post-card')
	if (card?.dataset?.authorEntity && card?.dataset?.postId)
		return {
			entityHash: card.dataset.authorEntity,
			postId: card.dataset.postId,
		}
	const panel = element?.closest?.('[data-replies-for]')
	if (panel?.dataset?.repliesFor) {
		const parsed = parseActionKey(panel.dataset.repliesFor)
		if (parsed?.entityHash && parsed?.postId) return parsed
	}
	return null
}
