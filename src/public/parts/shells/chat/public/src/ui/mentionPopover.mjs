import { geti18n, i18nElement } from '../../../../../../scripts/i18n.mjs'

/**
 * 创建 @mention 弹出面板。
 * @param {HTMLTextAreaElement} inputEl 输入框元素
 * @param {() => string[]} getCharNames 返回可 mention 的角色名列表
 * @param {AbortSignal} signal 用于自动清理的中止信号
 * @returns {{ update: () => void, hide: () => void }} 更新/隐藏弹出层的控制器
 */
export function createMentionPopover(inputEl, getCharNames, signal) {
	const mentionBox = document.createElement('div')
	mentionBox.className = 'fixed z-[100] hidden max-h-48 overflow-y-auto rounded-lg border border-base-300 bg-base-100 shadow-lg p-1 flex flex-col gap-0.5 min-w-[10rem]'
	document.body.appendChild(mentionBox)
	signal.addEventListener('abort', () => mentionBox.remove())

	/**
	 *
	 */
	function hide() {
		mentionBox.classList.add('hidden')
		mentionBox.replaceChildren()
	}

	/**
	 *
	 */
	function update() {
		if (!inputEl) return
		const pos = inputEl.selectionStart ?? 0
		const before = inputEl.value.slice(0, pos)
		const m = before.match(/@([\w.-]*)$/u)
		if (!m) {
			hide()
			return
		}
		const q = (m[1] || '').toLowerCase()
		const charNames = getCharNames()
		const hits = charNames.filter(n => n.toLowerCase().includes(q)).slice(0, 10)
		mentionBox.replaceChildren()
		if (!hits.length) {
			const hint = document.createElement('div')
			hint.className = 'text-xs opacity-60 px-2 py-1 max-w-xs'
			hint.dataset.i18n = 'chat.group.mentionEmpty'
			mentionBox.appendChild(hint)
			i18nElement(hint, { skip_report: true })
		}
		else 
			for (const h of hits) {
				const btn = document.createElement('button')
				btn.type = 'button'
				btn.className = 'btn btn-sm btn-ghost justify-start font-normal'
				btn.textContent = geti18n('chat.group.mentionHandle', { name: h })
				btn.addEventListener('click', () => {
					const start = before.lastIndexOf('@')
					const insertion = geti18n('chat.group.mentionInsert', { name: h })
					const newVal = inputEl.value.slice(0, start) + insertion + inputEl.value.slice(pos)
					inputEl.value = newVal
					const np = start + insertion.length
					inputEl.selectionStart = inputEl.selectionEnd = np
					hide()
					inputEl.focus()
				})
				mentionBox.appendChild(btn)
			}
		
		const rect = inputEl.getBoundingClientRect()
		mentionBox.style.left = `${rect.left}px`
		mentionBox.style.top = `${Math.min(rect.bottom + 4, globalThis.innerHeight - 200)}px`
		mentionBox.classList.remove('hidden')
	}

	return { update, hide }
}
