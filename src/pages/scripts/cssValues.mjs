const root = document.documentElement
/**
 * @description 设置 CSS 变量。
 * @param {string} name - 变量名。
 * @param {string} value - 变量值。
 * @returns {void}
 */
export function setCssVariable(name, value) {
	root.style.setProperty(name, value)
}
const functions = []
/**
 * @description 注册一个 CSS 更新器函数。
 * @param {Function} func - 更新器函数。
 * @returns {void}
 */
export function registerCssUpdater(func) {
	func()
	functions.push(func)
}
/**
 * @description 在窗口大小改变时更新CSS变量。
 * @returns {void}
 */
window.addEventListener('resize', () => {
	for (const func of functions)
		func()
})
