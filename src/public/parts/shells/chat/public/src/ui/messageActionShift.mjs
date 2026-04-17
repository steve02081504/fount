import { onElementRemoved } from '../../../../../../pages/scripts/onElementRemoved.mjs'

/**
 * 与 master `messageList` 一致：按住 Shift 在 `.normal-buttons` 与 `.shift-buttons` 之间切换。
 * 若仅一侧有按钮则固定显示该侧，不注册全局键盘监听。
 *
 * @param {HTMLElement} lifetimeHost 消息行宿主（移除时卸载 document 监听）
 * @param {HTMLElement} actionsRoot 内含 `.normal-buttons` / `.shift-buttons` 的根节点
 * @returns {void}
 */
export function attachShiftToggleMessageActions(lifetimeHost, actionsRoot) {
	const normalButtons = actionsRoot.querySelector('.normal-buttons')
	const shiftButtons = actionsRoot.querySelector('.shift-buttons')
	if (!normalButtons || !shiftButtons) return

	const normalCount = normalButtons.childElementCount
	const shiftCount = shiftButtons.childElementCount
	if (normalCount === 0 && shiftCount === 0) return

	if (normalCount > 0 && shiftCount === 0) {
		normalButtons.style.display = 'flex'
		shiftButtons.style.display = 'none'
		return
	}
	if (normalCount === 0 && shiftCount > 0) {
		normalButtons.style.display = 'none'
		shiftButtons.style.display = 'flex'
		return
	}

	let isShiftPressed = false
	/**
	 *
	 */
	const updateButtonVisibility = () => {
		if (isShiftPressed) {
			normalButtons.style.display = 'none'
			shiftButtons.style.display = 'flex'
		}
		else {
			normalButtons.style.display = 'flex'
			shiftButtons.style.display = 'none'
		}
	}

	/**
	 * @param {KeyboardEvent} e 键盘事件
	 */
	const handleKeyDown = e => {
		if (e.key !== 'Shift' || isShiftPressed) return
		isShiftPressed = true
		updateButtonVisibility()
	}
	/**
	 * @param {KeyboardEvent} e 键盘事件
	 */
	const handleKeyUp = e => {
		if (e.key !== 'Shift' || !isShiftPressed) return
		isShiftPressed = false
		updateButtonVisibility()
	}
	/**
	 *
	 */
	const handleBlur = () => {
		if (!isShiftPressed) return
		isShiftPressed = false
		updateButtonVisibility()
	}

	document.addEventListener('keydown', handleKeyDown)
	document.addEventListener('keyup', handleKeyUp)
	window.addEventListener('blur', handleBlur)
	onElementRemoved(lifetimeHost, () => {
		document.removeEventListener('keydown', handleKeyDown)
		document.removeEventListener('keyup', handleKeyUp)
		window.removeEventListener('blur', handleBlur)
	})
	updateButtonVisibility()
}
