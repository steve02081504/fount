/**
 * @ 提及 autocomplete（输入 @ 后弹出候选）。
 */

import { aliasForEntity } from '/parts/shells:chat/shared/aliases.mjs'
import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'

const API = '/api/parts/shells:social/mentions/suggest'

/**
 * 为发帖框挂载 @ 提及 autocomplete。
 * @param {HTMLTextAreaElement} textarea 发帖框
 * @returns {() => void} 卸载监听
 */
export function attachMentionAutocomplete(textarea) {
	const panel = document.createElement('div')
	panel.className = 'mention-panel hidden'
	panel.setAttribute('role', 'listbox')
	textarea.parentElement?.appendChild(panel)

	/** @type {object[]} */
	let suggestions = []
	let activeIndex = 0
	/** @type {{ start: number, end: number } | null} */
	let mentionRange = null

	/**
	 * 隐藏 @ 提及候选面板并重置状态。
	 * @returns {void}
	 */
	function hide() {
		panel.classList.add('hidden')
		panel.innerHTML = ''
		suggestions = []
		mentionRange = null
	}

	/**
	 * 渲染 @ 提及候选列表。
	 * @param {object[]} rows 候选
	 * @returns {void}
	 */
	function render(rows) {
		suggestions = rows
		activeIndex = 0
		panel.innerHTML = ''
		if (!rows.length) {
			hide()
			return
		}
		for (const [index, row] of rows.entries()) {
			const button = document.createElement('button')
			button.type = 'button'
			button.className = `mention-option${index === 0 ? ' active' : ''}`
			button.dataset.index = String(index)
			button.innerHTML = `
				<strong>${aliasForEntity(row.entityHash) || row.displayName || formatHashShort(row.entityHash, { headLen: 8, tailLen: 0, ellipsis: false })}</strong>
				<small>${formatHashShort(row.entityHash, { headLen: 12, tailLen: 0 })}</small>
			`
			panel.appendChild(button)
		}
		panel.classList.remove('hidden')
	}

	/**
	 * 从 API 拉取 @ 提及候选。
	 * @param {string} query 过滤词
	 * @returns {Promise<void>}
	 */
	async function fetchSuggestions(query) {
		const response = await fetch(`${API}?q=${encodeURIComponent(query)}&limit=12`, { credentials: 'include' })
		if (!response.ok) {
			hide()
			return
		}
		const data = await response.json()
		render(data.suggestions || [])
	}

	/**
	 * 解析光标处正在输入的 @ 片段。
	 * @returns {{ query: string, start: number, end: number } | null} 当前 @ 片段
	 */
	function currentMention() {
		const pos = textarea.selectionStart
		const before = textarea.value.slice(0, pos)
		const match = before.match(/@(?:\[([^\]]*))?$/u)
		if (!match) return null
		return {
			query: match[1] ?? '',
			start: pos - match[0].length,
			end: pos,
		}
	}

	/**
	 * 将选中的 @ 提及候选插入发帖框。
	 * @param {object} row 选中候选
	 * @returns {void}
	 */
	function apply(row) {
		if (!mentionRange) return
		const mention = `@[${row.entityHash}]`
		textarea.value = textarea.value.slice(0, mentionRange.start)
			+ mention
			+ textarea.value.slice(mentionRange.end)
		const caret = mentionRange.start + mention.length
		textarea.setSelectionRange(caret, caret)
		textarea.focus()
		hide()
	}

	/**
	 * 处理 @ 提及面板的键盘导航与选中。
	 * @param {KeyboardEvent} event 键盘
	 * @returns {void}
	 */
	function onKeydown(event) {
		if (panel.classList.contains('hidden') || !suggestions.length) return
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			activeIndex = (activeIndex + 1) % suggestions.length
		}
		else if (event.key === 'ArrowUp') {
			event.preventDefault()
			activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length
		}
		else if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault()
			apply(suggestions[activeIndex])
			return
		}
		else if (event.key === 'Escape') {
			hide()
			return
		}
		else return

		for (const button of panel.querySelectorAll('.mention-option'))
			button.classList.toggle('active', Number(button.dataset.index) === activeIndex)
	}

	/**
	 * 输入变化时更新 @ 提及候选。
	 * @returns {void}
	 */
	function onInput() {
		const mention = currentMention()
		if (!mention) {
			hide()
			return
		}
		mentionRange = { start: mention.start, end: mention.end }
		fetchSuggestions(mention.query).catch(() => hide())
	}

	panel.addEventListener('mousedown', event => {
		const button = event.target instanceof HTMLElement ? event.target.closest('.mention-option') : null
		if (!button) return
		event.preventDefault()
		const row = suggestions[Number(button.dataset.index)]
		if (row) apply(row)
	})

	textarea.addEventListener('input', onInput)
	textarea.addEventListener('keydown', onKeydown)
	textarea.addEventListener('blur', () => setTimeout(hide, 150))

	return () => {
		textarea.removeEventListener('input', onInput)
		textarea.removeEventListener('keydown', onKeydown)
		panel.remove()
	}
}
