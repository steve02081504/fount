/**
 * View Transition 共享元素命名辅助。
 *
 * 共享元素过渡要求新旧两侧的 DOM 在同一时刻带有相同的 `view-transition-name`。
 * 本模块记录已命名的元素，便于在过渡结束后统一清理，避免跨视图残留。
 * 页面级过渡仍走 `motion/viewTransition.mjs`，不要直接调用 `document.startViewTransition`。
 */

/** 已被本模块命名、待清理的元素。 */
const namedElements = new Set()

/**
 * 为元素设置 `view-transition-name` 并纳入清理集合。
 * @param {HTMLElement} element 目标元素
 * @param {string} name 过渡名称（同一时刻全局唯一）
 * @returns {void}
 */
export function setViewTransitionName(element, name) {
	if (!(element instanceof HTMLElement) || !name) return
	element.style.setProperty('view-transition-name', name)
	namedElements.add(element)
}

/**
 * 移除单个元素的过渡名称。
 * @param {HTMLElement} element 目标元素
 * @returns {void}
 */
export function clearViewTransitionName(element) {
	if (!(element instanceof HTMLElement)) return
	element.style.removeProperty('view-transition-name')
	namedElements.delete(element)
}

/**
 * 清理本模块设置的全部过渡名称。
 * @returns {void}
 */
export function clearViewTransitionNames() {
	for (const element of namedElements) element.style.removeProperty('view-transition-name')
	namedElements.clear()
}
