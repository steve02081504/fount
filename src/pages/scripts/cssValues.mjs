const root = document.documentElement
export function setCssVariable(name, value) {
	root.style.setProperty(name, value)
}
const functions = []
export function registerCssUpdater(func) {
	func()
	functions.push(func)
}
// 在窗口大小改变时更新CSS变量
window.addEventListener('resize', () => {
	for (const func of functions)
		func()
})
