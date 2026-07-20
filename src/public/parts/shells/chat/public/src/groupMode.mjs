/**
 * 【文件】public/src/groupMode.mjs
 * 【职责】群 UI 通用安全钩子：离屏 embed 守卫、不可信 Markdown 揭示按钮、本地物化视图提示键。
 * 【原理】attachOffscreenEmbedGuard 监听 visibility；attachUntrustedMarkdownOffscreenGuard 延迟渲染。
 * 【数据结构】无全局状态；回调 onReveal。
 * 【关联】ui/mdRevealButton.mjs；Hub 消息渲染。
 */
import { mountMdRevealButton } from './ui/mdRevealButton.mjs'

/**
 * 群壳模式与 §17 离屏安全：Hub / 群 UI 可复用。
 * 权限物化分叉等仍由服务端 state 与 dag 折叠负责，此处仅客户端通用钩子。
 */

/**
 * Markdown 气泡离屏时卸掉 iframe/video 的活跃 src，回屏恢复（减轻后台 embed 与计划 §17 对齐）。
 * @param {HTMLElement} root 含富 HTML 的容器（通常为消息气泡根）
 * @returns {() => void} 断开观察器
 */
export function attachOffscreenEmbedGuard(root) {
	if (!(root instanceof HTMLElement) || typeof IntersectionObserver === 'undefined')
		return () => { }

	const suspend = /** @param {HTMLIFrameElement|HTMLVideoElement} el 正在播放或加载的嵌入元素 */ (el) => {
		if (!(el instanceof HTMLIFrameElement || el instanceof HTMLVideoElement)) return
		const src = el.getAttribute('src')
		if (src && !el.hasAttribute('data-suspended-src')) {
			el.setAttribute('data-suspended-src', src)
			el.removeAttribute('src')
		}
	}
	const resume = /** @param {HTMLIFrameElement|HTMLVideoElement} embed 已挂起待恢复的嵌入元素 */ (embed) => {
		if (!(embed instanceof HTMLIFrameElement || embed instanceof HTMLVideoElement)) return
		const suspendedSrc = embed.getAttribute('data-suspended-src')
		if (suspendedSrc) {
			embed.setAttribute('src', suspendedSrc)
			embed.removeAttribute('data-suspended-src')
		}
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const intersectionEntry of entries) {
				const { target } = intersectionEntry
				if (!(target instanceof HTMLElement)) continue
				if (intersectionEntry.isIntersecting)
					target.querySelectorAll('iframe[data-suspended-src],video[data-suspended-src]').forEach(resume)
				else
					target.querySelectorAll('iframe[src],video[src]').forEach(suspend)
			}
		},
		{ root: null, rootMargin: '120px 0px', threshold: 0 },
	)
	io.observe(root)
	return () => io.disconnect()
}

/**
 * §17：未信任远端 Markdown 离屏时挂「展开全文」；回屏点击后再 hydrate 完整内容。
 * @param {HTMLElement} bubble 消息正文气泡
 * @param {{ onReveal: () => void }} options 用户确认后回调（重新 hydrate）
 * @returns {() => void} 断开观察器
 */
export function attachUntrustedMarkdownOffscreenGuard(bubble, { onReveal }) {
	if (!(bubble instanceof HTMLElement) || typeof IntersectionObserver === 'undefined')
		return () => { }

	/**
	 * 在气泡离屏且已 hydrate 时挂载「显示 Markdown」按钮。
	 * @returns {void}
	 */
	const showRevealButton = () => {
		if (bubble.querySelector('.markdown-reveal-button')) return
		void mountMdRevealButton(bubble, onReveal)
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const intersectionEntry of entries) {
				if (!(intersectionEntry.target instanceof HTMLElement) || intersectionEntry.target !== bubble) continue
				if (intersectionEntry.isIntersecting) continue
				if (bubble.dataset.mdHydrated === '1' && !bubble.querySelector('.markdown-reveal-button')) {
					bubble.dataset.mdStash = bubble.innerHTML
					bubble.replaceChildren()
					showRevealButton()
				}
			}
		},
		{ root: null, rootMargin: '80px 0px', threshold: 0 },
	)
	io.observe(bubble)
	return () => io.disconnect()
}

/**
 * 合并多个清理函数。
 * @param  {...() => void} fns 清理回调
 * @returns {() => void} 一次性调用全部
 */
export function combineDisposers(...fns) {
	return () => {
		for (const fn of fns)
			fn?.()
	}
}
