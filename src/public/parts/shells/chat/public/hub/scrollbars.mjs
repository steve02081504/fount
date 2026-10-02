/**
 * 只在滚动期间显示列表滚动条；固定槽宽避免显隐时挤动内容。
 * @param {HTMLElement} element 滚动容器
 * @returns {() => void} 解除监听并清理淡出计时器
 */
export function bindScrollingScrollbar(element) {
	let timer
	/** 移除滚动中样式并清空计时。 */
	const hide = () => {
		element.classList.remove('is-scrolling')
		timer = undefined
	}
	/** 标记滚动中并重置隐藏计时。 */
	const show = () => {
		element.classList.add('is-scrolling')
		clearTimeout(timer)
		timer = setTimeout(hide, 800)
	}
	element.addEventListener('scroll', show, { passive: true })
	return () => {
		element.removeEventListener('scroll', show)
		clearTimeout(timer)
		hide()
	}
}
