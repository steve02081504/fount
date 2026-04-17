/**
 * 监听点击元素外部事件，返回清理函数。
 * @param {Element} el 目标元素（点击在其外部时触发回调）
 * @param {(e: MouseEvent) => void} callback 触发回调
 * @param {{ capture?: boolean }} [opts] addEventListener 选项
 * @returns {() => void} 调用后取消监听
 */
export function onClickOutside(el, callback, { capture = true } = {}) {
	/**
	 * @param {MouseEvent} e 文档点击
	 */
	const handler = (e) => {
		if (!el.contains(/** @type {Node} */ e.target)) callback(e)
	}
	document.addEventListener('click', handler, capture)
	return () => document.removeEventListener('click', handler, capture)
}
