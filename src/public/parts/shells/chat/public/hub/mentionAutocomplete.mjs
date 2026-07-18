/**
 * Hub composer @ 提及 autocomplete（群内成员，插入 entityHash）。
 */
import { formatHashShort, formatEntityAtId } from '../shared/entityHash.mjs'
import { formatEntityMentionToken, formatRoleMentionToken } from '../shared/inlineTokenSyntax.mjs'

import { store } from './core/state.mjs'

/**
 * @param {HTMLTextAreaElement} textarea 消息输入框
 * @returns {() => void} 卸载监听
 */
export function attachHubMentionAutocomplete(textarea) {
	const panel = document.createElement('div')
	panel.className = 'mention-panel hidden'
	panel.setAttribute('role', 'listbox')
	textarea.parentElement?.appendChild(panel)

	/** @type {object[]} */
	let suggestions = []
	let activeIndex = 0
	/** @type {{ start: number, end: number } | null} */
	let mentionRange = null

	/** @returns {void} */
	function hide() {
		panel.classList.add('hidden')
		panel.innerHTML = ''
		suggestions = []
		mentionRange = null
	}

	/**
	 * @param {object[]} rows 候选
	 * @returns {void}
	 */
	function render(rows) {
		suggestions = rows
		activeIndex = 0
		panel.innerHTML = ''
		if (!rows.length) {
			panel.classList.remove('hidden')
			panel.innerHTML = '<div class="mention-empty" data-i18n="chat.hub.mentionEmpty"></div>'
			return
		}
		for (const [index, row] of rows.entries()) {
			const button = document.createElement('button')
			button.type = 'button'
			button.className = `mention-option${index === 0 ? ' active' : ''}`
			button.dataset.index = String(index)
			const subtitle = row.entityHash
				? formatEntityAtId(row.entityHash, { handle: row.handle })
				: row.memberCount != null ? `${row.memberCount}` : ''
			button.innerHTML = `
				<strong>${row.displayName || formatHashShort(row.entityHash, { headLen: 8, tailLen: 0, ellipsis: false })}</strong>
				<small>${subtitle}</small>
			`
			panel.appendChild(button)
		}
		panel.classList.remove('hidden')
	}

	/**
	 * @param {string} query 过滤词
	 * @returns {Promise<void>}
	 */
	async function fetchSuggestions(query) {
		const groupId = store.context.currentGroupId
		if (!groupId) {
			hide()
			return
		}
		const response = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/mentions/suggest?q=${encodeURIComponent(query)}&limit=12`,
			{ credentials: 'include' },
		)
		if (!response.ok) {
			hide()
			return
		}
		const data = await response.json()
		render(data.suggestions || [])
	}

	/**
 * @returns {{ query: string, start: number, end: number } | null} 当前 @ 片段或 null
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
	 * @param {object} row 选中候选
	 * @returns {string} 插入 token
	 */
	function mentionTokenForRow(row) {
		if (row.kind === 'role' && row.roleId) return formatRoleMentionToken(row.roleId)
		if (row.kind === 'everyone') return formatRoleMentionToken('everyone')
		if (row.kind === 'here') return formatRoleMentionToken('here')
		return formatEntityMentionToken(row.entityHash)
	}

	/**
	 * @param {object} row 选中候选
	 * @returns {void}
	 */
	function apply(row) {
		if (!mentionRange) return
		const mention = mentionTokenForRow(row)
		textarea.value = textarea.value.slice(0, mentionRange.start)
			+ mention
			+ ' '
			+ textarea.value.slice(mentionRange.end)
		const caret = mentionRange.start + mention.length + 1
		textarea.setSelectionRange(caret, caret)
		textarea.focus()
		hide()
	}

	/**
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

	/** @returns {void} */
	function onInput() {
		const mention = currentMention()
		if (!mention) {
			hide()
			return
		}
		mentionRange = { start: mention.start, end: mention.end }
		void fetchSuggestions(mention.query).catch(() => hide())
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

/**
 * 向 composer 插入 @entityHash。
 * @param {string} entityHash 128 hex
 * @returns {void}
 */
export function insertComposerMention(entityHash) {
	const textarea = /** @type {HTMLTextAreaElement | null} */ document.getElementById('message-input')
	if (!textarea || textarea.disabled) return
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!hash) return
	const mention = `${formatEntityMentionToken(hash)} `
	const start = textarea.selectionStart ?? textarea.value.length
	const end = textarea.selectionEnd ?? start
	textarea.value = textarea.value.slice(0, start) + mention + textarea.value.slice(end)
	const caret = start + mention.length
	textarea.setSelectionRange(caret, caret)
	textarea.focus()
	textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
