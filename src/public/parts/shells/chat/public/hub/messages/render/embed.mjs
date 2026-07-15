/**
 * 【文件】public/hub/messages/render/embed.mjs
 * 【职责】消息气泡离屏 embed / 未信任 Markdown 守卫。
 */
import {
	attachOffscreenEmbedGuard,
	attachUntrustedMarkdownOffscreenGuard,
	combineDisposers,
} from '../../../src/groupMode.mjs'

/** @type {WeakMap<HTMLElement, () => void>} */
const embedGuardDisposers = new WeakMap()

/**
 * @param {HTMLElement} bubble 正文气泡
 * @returns {void}
 */
export function disposeEmbedGuard(bubble) {
	const prev = embedGuardDisposers.get(bubble)
	if (prev) prev()
	embedGuardDisposers.delete(bubble)
}

/**
 * 在气泡上挂载离屏守卫（embed + 未信任 Markdown）。
 * @param {HTMLElement} bubble 正文气泡
 * @param {boolean} trusted 是否可信作者
 * @param {() => void} [onUntrustedReveal] 用户确认展开未信任全文后的回调
 * @returns {void}
 */
export function wireBubbleOffscreenGuards(bubble, trusted, onUntrustedReveal) {
	disposeEmbedGuard(bubble)
	if (trusted) {
		bubble.dataset.mdUntrusted = '0'
		embedGuardDisposers.set(bubble, attachOffscreenEmbedGuard(bubble))
		return
	}
	bubble.dataset.mdUntrusted = '1'
	embedGuardDisposers.set(bubble, combineDisposers(
		attachOffscreenEmbedGuard(bubble),
		attachUntrustedMarkdownOffscreenGuard(bubble, { onReveal: onUntrustedReveal }),
	))
}

/**
 * §17：离屏时挂起 iframe/video src，减轻后台嵌入。
 * @param {HTMLElement} container 消息列表根
 * @returns {void}
 */
export function wireMessageEmbedGuards(container) {
	if (!(container instanceof HTMLElement)) return
	for (const bubble of container.querySelectorAll('.hub-message-content')) {
		if (!(bubble instanceof HTMLElement)) continue
		disposeEmbedGuard(bubble)
		embedGuardDisposers.set(bubble, attachOffscreenEmbedGuard(bubble))
	}
}
