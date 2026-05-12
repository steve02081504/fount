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
		return () => {}

	const suspend = /** @param {HTMLIFrameElement|HTMLVideoElement} el 正在播放或加载的嵌入元素 */ (el) => {
		if (!(el instanceof HTMLIFrameElement || el instanceof HTMLVideoElement)) return
		const src = el.getAttribute('src')
		if (src && !el.hasAttribute('data-suspended-src')) {
			el.setAttribute('data-suspended-src', src)
			el.removeAttribute('src')
		}
	}
	const resume = /** @param {HTMLIFrameElement|HTMLVideoElement} el 已挂起待恢复的嵌入元素 */ (el) => {
		if (!(el instanceof HTMLIFrameElement || el instanceof HTMLVideoElement)) return
		const s = el.getAttribute('data-suspended-src')
		if (s) {
			el.setAttribute('src', s)
			el.removeAttribute('data-suspended-src')
		}
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				const t = e.target
				if (!(t instanceof HTMLElement)) continue
				if (e.isIntersecting)
					t.querySelectorAll('iframe[data-suspended-src],video[data-suspended-src]').forEach(resume)
				else
					t.querySelectorAll('iframe[src],video[src]').forEach(suspend)
			}
		},
		{ root: null, rootMargin: '120px 0px', threshold: 0 },
	)
	io.observe(root)
	return () => io.disconnect()
}

/** §8：分叉时提示用户当前为本地物化视图（占位，供 UI 绑定文案） */
export const LOCAL_VIEW_HINT_KEY = 'chat.group.localMaterializedView'
