/**
 * 【文件】public/src/lib/activate.mjs — 模拟按钮的键盘激活
 * 【职责】为 `role="button"` 的非按钮元素补齐 Enter / Space 激活，满足可访问性。
 * 【原理】统一绑定 click 与 keydown，避免各视图重复实现。
 * 【关联】views/*。
 */

/**
 * 绑定点击与键盘激活。
 * @param {HTMLElement | null} element 目标元素
 * @param {() => void} handler 激活回调
 * @returns {void}
 */
export function bindActivate(element, handler) {
	if (!element) return
	element.addEventListener('click', handler)
	element.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return
		event.preventDefault()
		handler()
	})
}
