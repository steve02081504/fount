/**
 * 逐字密码对照反馈（反人类设计 parody）：每位输入与参照密码比对，显示 ✓ 或 ✗。
 * @param {HTMLInputElement} inputEl - 待校验的密码输入框。
 * @param {HTMLElement} feedbackEl - 反馈容器。
 * @param {() => string | null | undefined} getReferencePassword - 返回参照密码；无参照时隐藏反馈。
 * @returns {{ refresh: () => void, clear: () => void }} 手动刷新与清空。
 */
export function initPasswordCharFeedback(inputEl, feedbackEl, getReferencePassword) {
	/**
	 * 刷新逐字反馈 UI。
	 * @returns {void}
	 */
	function refresh() {
		const reference = getReferencePassword()
		const typed = inputEl.value
		if (!reference || !typed) {
			feedbackEl.innerHTML = ''
			feedbackEl.hidden = true
			return
		}

		feedbackEl.hidden = false
		const parts = []
		for (let i = 0; i < typed.length; i++) {
			const ok = typed[i] === reference[i]
			parts.push(`<span class="${ok ? 'text-success' : 'text-error'}" aria-hidden="true">${ok ? '✓' : '✗'}</span>`)
		}
		feedbackEl.innerHTML = parts.join('')
	}

	return {
		refresh,
		/**
		 * 清空反馈显示。
		 * @returns {void}
		 */
		clear: () => {
			feedbackEl.innerHTML = ''
			feedbackEl.hidden = true
		},
	}
}
