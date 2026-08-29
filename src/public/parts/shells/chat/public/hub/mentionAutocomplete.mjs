/**
 * Hub composer @ 提及 autocomplete（群内成员，插入 entityHash）。
 */
import { sanitizePermissiveHtml } from '/scripts/lib/sanitizeHtml.mjs'

import { formatHashShort, formatEntityAtId } from '../shared/entityHash.mjs'
import { formatEntityMentionToken, formatRoleMentionToken } from '../shared/inlineTokenSyntax.mjs'
import { currentMentionQuery } from '../shared/mentionQuery.mjs'
import { suggestMentions } from '../src/endpoints/mentions.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { store } from './core/state.mjs'

let mentionListboxSeq = 0

/**
 * @param {HTMLTextAreaElement} textarea 消息输入框
 * @returns {() => void} 卸载监听
 */
export function attachHubMentionAutocomplete(textarea) {
	const panel = document.createElement('div')
	panel.id = `hub-mention-listbox-${++mentionListboxSeq}`
	panel.className = 'mention-panel hidden'
	panel.setAttribute('role', 'listbox')
	panel.dataset.i18n = 'chat.hub.mentionSuggest'
	textarea.setAttribute('aria-controls', panel.id)
	textarea.setAttribute('aria-autocomplete', 'list')
	textarea.parentElement?.appendChild(panel)

	/** @type {object[]} */
	let suggestions = []
	let activeIndex = 0
	/** @type {{ start: number, end: number } | null} */
	let mentionRange = null

	/** @returns {void} */
	function clearActiveOption() {
		textarea.removeAttribute('aria-activedescendant')
	}

	/** @returns {void} */
	function syncActiveOption() {
		const options = panel.querySelectorAll('.mention-option')
		for (const button of options) {
			const selected = Number(button.dataset.index) === activeIndex
			button.classList.toggle('active', selected)
			button.setAttribute('aria-selected', selected ? 'true' : 'false')
		}
		const active = options[activeIndex]
		if (active?.id) textarea.setAttribute('aria-activedescendant', active.id)
		else textarea.removeAttribute('aria-activedescendant')
	}

	/** @returns {void} */
	function hide() {
		panel.classList.add('hidden')
		panel.innerHTML = ''
		suggestions = []
		mentionRange = null
		clearActiveOption()
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
			textarea.removeAttribute('aria-activedescendant')
			return
		}
		for (const [index, row] of rows.entries()) {
			const button = document.createElement('button')
			button.type = 'button'
			button.id = `${panel.id}-option-${index}`
			button.setAttribute('role', 'option')
			button.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
			button.className = `mention-option${index === 0 ? ' active' : ''}`
			button.dataset.index = String(index)
			const subtitle = row.entityHash
				? formatEntityAtId(row.entityHash, { handle: row.handle })
				: row.memberCount != null ? `${row.memberCount}` : ''
			const label = row.displayName || formatHashShort(row.entityHash, { headLen: 8, tailLen: 0, ellipsis: false })
			button.innerHTML = `
				<strong>${sanitizePermissiveHtml(label)}</strong>
				<small>${sanitizePermissiveHtml(subtitle)}</small>
			`
			panel.appendChild(button)
		}
		panel.classList.remove('hidden')
		syncActiveOption()
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
		const data = await suggestMentions(groupId, query, 12)
		render(data.suggestions || [])
	}

	/**
	 * @returns {{ query: string, start: number, end: number } | null} 当前 @ 片段或 null
	 */
	function currentMention() {
		return currentMentionQuery(textarea.value, textarea.selectionStart)
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

		syncActiveOption()
	}

	/** @returns {void} */
	function onInput() {
		const mention = currentMention()
		if (!mention) {
			hide()
			return
		}
		mentionRange = { start: mention.start, end: mention.end }
		fetchSuggestions(mention.query).catch(error => {
			handleError('chat.hub.operationFailed')(error)
			hide()
		})
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
		textarea.removeAttribute('aria-controls')
		textarea.removeAttribute('aria-autocomplete')
		textarea.removeAttribute('aria-activedescendant')
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
	if (!entityHash) return
	const mention = `${formatEntityMentionToken(entityHash)} `
	const start = textarea.selectionStart ?? textarea.value.length
	const end = textarea.selectionEnd ?? start
	textarea.value = textarea.value.slice(0, start) + mention + textarea.value.slice(end)
	const caret = start + mention.length
	textarea.setSelectionRange(caret, caret)
	textarea.focus()
	textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
