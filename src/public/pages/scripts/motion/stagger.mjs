/**
 * 列表入场错峰：为一批元素分配 `--stagger-i`，供 CSS 计算 animation-delay。
 * 总时长用 `--duration-stagger` 控制（见 motion/styles.css / motion-patterns.md）。
 */

/** 默认最大错峰条目数，超过则不再延迟，避免长列表入场过慢。 */
export const MAX_STAGGER_ITEMS = 7

/**
 * 为元素集合分配 `--stagger-i` 序号。
 * @param {Element | Element[] | HTMLCollection | NodeList} target 宿主元素（取其子元素）或元素集合
 * @param {{ max?: number }} [options] 选项
 * @returns {void}
 */
export function applyStagger(target, { max = MAX_STAGGER_ITEMS } = {}) {
	const elements = target instanceof Element ? target.children : target
	let index = 0
	for (const element of elements) {
		if (!(element instanceof HTMLElement)) continue
		if (index < max) element.style.setProperty('--stagger-i', String(index))
		else element.style.removeProperty('--stagger-i')
		index++
	}
}

/**
 * 清除元素集合上的 `--stagger-i`。
 * @param {Element | Element[] | HTMLCollection | NodeList} target 宿主元素（取其子元素）或元素集合
 * @returns {void}
 */
export function clearStagger(target) {
	const elements = target instanceof Element ? target.children : target
	for (const element of elements)
		if (element instanceof HTMLElement) element.style.removeProperty('--stagger-i')
}
