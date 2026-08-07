/**
 * 群 UI 通用安全钩子：离屏 embed 守卫、不可信 Markdown 揭示按钮。
 */
import { mountMdRevealButton } from './ui/mdRevealButton.mjs'

/**
 * Markdown 气泡离屏时卸掉 iframe/video 的活跃 src，回屏恢复。
 * @param {HTMLElement} root 含富 HTML 的容器（通常为消息气泡根）
 * @returns {() => void} 断开观察器
 */
export function attachOffscreenEmbedGuard(root) {
	const suspend = /** @param {Element} el iframe/video */ (el) => {
		const src = el.getAttribute('src')
		if (!src || el.hasAttribute('data-suspended-src')) return
		el.setAttribute('data-suspended-src', src)
		el.removeAttribute('src')
	}
	const resume = /** @param {Element} el 已挂起待恢复的嵌入元素 */ (el) => {
		const suspendedSrc = el.getAttribute('data-suspended-src')
		if (!suspendedSrc) return
		el.setAttribute('src', suspendedSrc)
		el.removeAttribute('data-suspended-src')
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries)
				if (entry.isIntersecting)
					entry.target.querySelectorAll('iframe[data-suspended-src],video[data-suspended-src]').forEach(resume)
				else
					entry.target.querySelectorAll('iframe[src],video[src]').forEach(suspend)
		},
		{ root: null, rootMargin: '120px 0px', threshold: 0 },
	)
	observer.observe(root)
	return () => observer.disconnect()
}

/**
 * 未信任远端 Markdown 离屏时挂「展开全文」；回屏点击后再 hydrate 完整内容。
 * @param {HTMLElement} bubble 消息正文气泡
 * @param {{ onReveal: () => void }} options 用户确认后回调（重新 hydrate）
 * @returns {() => void} 断开观察器
 */
export function attachUntrustedMarkdownOffscreenGuard(bubble, { onReveal }) {
	const observer = new IntersectionObserver(
		async (entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) continue
				if (
					bubble.dataset.mdHydrated !== '1'
					|| bubble.dataset.mdMounting === '1'
					|| bubble.querySelector('.markdown-reveal-button')
				) continue
				bubble.dataset.mdMounting = '1'
				bubble.dataset.mdStash = bubble.innerHTML
				bubble.replaceChildren()
				try {
					await mountMdRevealButton(bubble, onReveal)
				}
				finally {
					delete bubble.dataset.mdMounting
				}
			}
		},
		{ root: null, rootMargin: '80px 0px', threshold: 0 },
	)
	observer.observe(bubble)
	return () => observer.disconnect()
}

/**
 * 合并多个清理函数。
 * @param  {...() => void} fns 清理回调
 * @returns {() => void} 一次性调用全部
 */
export function combineDisposers(...fns) {
	return () => {
		for (const fn of fns) fn()
	}
}
