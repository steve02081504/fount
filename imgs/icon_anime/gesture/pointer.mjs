/**
 * Shared press / drag / release for pointer gestures (`.down`, `.x`, `.y`).
 */

/**
 * @param {{ down: boolean, x: number, y: number }} gesture gesture state
 * @param {number} x view column
 * @param {number} y view row
 * @param {boolean} pressed button down
 * @param {{ onDown?: () => void, onUp?: () => void }} [hooks] edge callbacks
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
 * Trim an array to the last `cap` entries (in place).
 * @param {unknown[]} items array
 * @param {number} cap max length
 * @returns {void}
 */
export const trimCap = (items, cap) => {
	if (items.length > cap) items.splice(0, items.length - cap)
}
