/**
 * 浮动面板定位与外侧点击关闭（emoji / sticker picker 共用）。
 */

/**
 * @param {HTMLElement} panel 浮动面板
 * @param {HTMLElement} anchor 定位锚点
 * @param {{ panelWidth?: number, heightOffset?: number }} [options] 尺寸选项
 * @returns {void}
 */
export function positionFloatingPanel(panel, anchor, { panelWidth = 320, heightOffset = 280 } = {}) {
	const rect = anchor.getBoundingClientRect()
	panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 10))}px`
	panel.style.top = `${Math.max(8, rect.top - heightOffset)}px`
}

/**
 * @param {HTMLElement} panel 浮动面板
 * @param {() => void} onClose 关闭回调
 * @param {HTMLElement} [alsoInside] 点击其内部时不关闭
 * @returns {void}
 */
export function wireOutsideClickClose(panel, onClose, alsoInside) {
	setTimeout(() => {
		/**
		 * @param {Event} event 文档点击
		 * @returns {void}
		 */
		const close = event => {
			if (panel.contains(event.target) || alsoInside?.contains(event.target)) return
			onClose()
			document.removeEventListener('click', close, true)
		}
		document.addEventListener('click', close, true)
	}, 0)
}
