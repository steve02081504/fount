/**
 * 文档级点击/右键关闭浮动菜单（capture 阶段，setTimeout 0 避免同次打开即关）。
 * @param {() => void} dismiss 关闭菜单
 * @param {{ contextMenu?: boolean }} [options] 是否监听 contextmenu
 * @returns {() => void} 可手动调用以提前关闭并解绑监听
 */
export function bindDismissOnDocumentInteraction(dismiss, { contextMenu = true } = {}) {
	/**
	 *
	 */
	const closeOnce = () => {
		dismiss()
		document.removeEventListener('click', closeOnce, true)
		if (contextMenu) document.removeEventListener('contextmenu', closeOnce, true)
	}
	setTimeout(() => {
		document.addEventListener('click', closeOnce, true)
		if (contextMenu) document.addEventListener('contextmenu', closeOnce, true)
	}, 0)
	return closeOnce
}
