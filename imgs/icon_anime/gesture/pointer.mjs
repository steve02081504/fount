/**
 * 指针手势共用的按下 / 拖拽 / 释放（`.down`、`.x`、`.y`）。
 */

/**
 * @param {{ down: boolean, x: number, y: number }} gesture 手势状态
 * @param {number} x 视口列
 * @param {number} y 视口行
 * @param {boolean} pressed 按键按下
 * @param {{ onDown?: () => void, onUp?: () => void }} [hooks] 边沿回调
 * @returns {void}
 */
export const applyPointer = (gesture, x, y, pressed, { onDown, onUp } = {}) => {
	if (!pressed) {
		if (gesture.down) onUp?.()
		gesture.down = false
		return
	}
	if (!gesture.down) {
		gesture.down = true
		gesture.x = x
		gesture.y = y
		onDown?.()
		return
	}
	gesture.x = x
	gesture.y = y
}

/**
 * 原地截断数组，仅保留末尾 `cap` 项。
 * @param {unknown[]} items 数组
 * @param {number} cap 最大长度
 * @returns {void}
 */
export const trimCap = (items, cap) => {
	if (items.length > cap) items.splice(0, items.length - cap)
}
