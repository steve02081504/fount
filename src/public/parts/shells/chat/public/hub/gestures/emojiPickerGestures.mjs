const GROUP_EMOJI_LONG_PRESS_MS = 500

/**
 * Hub 群表情长按 / 右键：作为贴纸发送（不渗入共享 emojiPicker）。
 * @param {HTMLElement} gridElement 表情网格
 * @param {HTMLElement} pickerElement 选择器根节点
 * @param {(item: object) => Promise<void>} onSendAsSticker 发送贴纸回调
 * @returns {void}
 */
export function wireHubGroupEmojiStickerGestures(gridElement, pickerElement, onSendAsSticker) {
	/** @type {ReturnType<typeof setTimeout> | null} */
	let longPressTimer = null
	let longPressFired = false

	/**
	 *
	 */
	function clearLongPress() {
		if (longPressTimer) {
			clearTimeout(longPressTimer)
			longPressTimer = null
		}
	}

	/**
	 * @param {HTMLElement} groupButton 群表情按钮
	 * @returns {object} 群表情项
	 */
	function groupEmojiItem(groupButton) {
		return {
			kind: 'custom',
			emojiId: groupButton.dataset.groupEmojiId,
			emojiRef: groupButton.dataset.groupEmojiRef,
		}
	}

	gridElement.addEventListener('pointerdown', event => {
		const groupButton = event.target.closest('[data-group-emoji-ref]')
		if (!groupButton) return
		longPressFired = false
		clearLongPress()
		longPressTimer = setTimeout(() => {
			longPressFired = true
			clearLongPress()
			void onSendAsSticker(groupEmojiItem(groupButton)).then(() => pickerElement.classList.remove('show'))
		}, GROUP_EMOJI_LONG_PRESS_MS)
	})

	for (const type of ['pointerup', 'pointercancel'])
		gridElement.addEventListener(type, clearLongPress)

	gridElement.addEventListener('click', event => {
		if (!longPressFired) return
		const groupButton = event.target.closest('[data-group-emoji-ref]')
		if (!groupButton) return
		longPressFired = false
		event.preventDefault()
		event.stopImmediatePropagation()
	}, true)

	gridElement.addEventListener('contextmenu', event => {
		const groupButton = event.target.closest('[data-group-emoji-ref]')
		if (!groupButton) return
		event.preventDefault()
		event.stopPropagation()
		clearLongPress()
		longPressFired = true
		void onSendAsSticker(groupEmojiItem(groupButton)).then(() => pickerElement.classList.remove('show'))
	})
}
