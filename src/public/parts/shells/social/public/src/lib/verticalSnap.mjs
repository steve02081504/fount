/**
 * 竖向全屏 scroll-snap 容器绑定工具。
 */

/**
 * @param {HTMLElement} container snap 容器
 * @param {object} [options] 回调选项
 * @param {(index: number, el: HTMLElement) => void} [options.onEnter] 进入回调（可见度 ≥ 60%）
 * @param {(index: number, el: HTMLElement) => void} [options.onLeave] 离开回调
 * @returns {{ disconnect: () => void, observe: (el: HTMLElement) => void }} 观察控制
 */
export function bindVerticalSnap(container, { onEnter, onLeave } = {}) {
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			const el = entry.target
			const index = [...container.children].indexOf(el)
			if (entry.isIntersecting)
				onEnter?.(index, el)
			else
				onLeave?.(index, el)
		}
	}, { root: container, threshold: 0.6 })

	for (const child of container.children)
		observer.observe(child)

	return {
		/** @returns {void} */
		disconnect: () => observer.disconnect(),
		/**
		 * @param {HTMLElement} el 新 slide
		 * @returns {void}
		 */
		observe: el => observer.observe(el),
	}
}
