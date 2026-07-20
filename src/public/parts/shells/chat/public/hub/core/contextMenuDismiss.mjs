/**
 * 文档级点击/右键关闭浮动层（capture 阶段，setTimeout 0 避免同次打开即关）。
 * @param {() => void} dismiss 关闭回调（监听触发时调用；手动 `close()` 也会调用）
 * @param {{ contextMenu?: boolean, ignoreSelectors?: string[] }} [options] contextMenu 默认 true；ignoreSelectors 命中则不关
 * @returns {(() => void) & { unbind: () => void }} 手动关闭并解绑；`.unbind()` 仅解绑不调 dismiss
 */
export function bindDismissOnDocumentInteraction(dismiss, { contextMenu = true, ignoreSelectors = [] } = {}) {
	let active = true
	/**
	 * @param {Event} [event] 交互事件；无 event 时强制关闭（如 Escape）
	 * @returns {void}
	 */
	const closeOnce = (event) => {
		if (!active) return
		if (event?.target instanceof Element && ignoreSelectors.length)
			for (const selector of ignoreSelectors)
				if (event.target.closest(selector)) return
		active = false
		unbind()
		dismiss()
	}
	/**
	 * @returns {void}
	 */
	const unbind = () => {
		active = false
		document.removeEventListener('click', closeOnce, true)
		if (contextMenu) document.removeEventListener('contextmenu', closeOnce, true)
	}
	setTimeout(() => {
		if (!active) return
		document.addEventListener('click', closeOnce, true)
		if (contextMenu) document.addEventListener('contextmenu', closeOnce, true)
	}, 0)
	closeOnce.unbind = unbind
	return closeOnce
}
