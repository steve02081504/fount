/**
 * 通用 @ 提及 autocomplete（chat hub composer / social 发帖框复用）。
 * 候选数据与上下文由调用方经 `providers` / `getContext` 注入，本组件只负责面板 UI 与键盘/鼠标交互。
 */
import { sanitizePermissiveHtml } from '/scripts/lib/sanitizeHtml.mjs'

import { formatEntityAtId, formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'
import { formatEntityMentionToken, formatRoleMentionToken } from '/parts/shells:chat/shared/inlineTokenSyntax.mjs'
import { currentMentionQuery } from '/parts/shells:chat/shared/mentionQuery.mjs'

/**
 * @typedef {object} MentionAutocompleteOptions
 * @property {() => { groupId?: string, channelId?: string, channelIds?: string[] }} [getContext] 当前上下文读取
 * @property {Array<(ctx: object, query: string, limit: number) => Promise<object[] | null>>} [providers] 候选 provider（按序调用，首个非 null 数组作为候选；全 null 走空态）
 * @property {string} [listboxPrefix] 面板 id 前缀
 * @property {string} [emptyI18n] 空态文案 i18n key
 * @property {string} [accessibleLabelI18n] 面板 aria-label 的 i18n key（如 `chat.hub.mentionSuggest`）
 * @property {boolean} [trailingSpace] 插入 token 后是否追加空格
 * @property {number} [limit] 候选条数上限
 * @property {(error: unknown) => void} [onError] 候选拉取失败回调（缺省时静默隐藏）
 */

/** 面板 id 序号（模块级递增，避免同页多个实例冲突）。 */
let seq = 0

/**
 * 在输入框光标处插入 token 并派发 input。
 * @param {HTMLTextAreaElement} textarea 输入框（富文本输入框兼容 textarea API）
 * @param {string} tokenText 插入的 token 文本
 * @param {{ trailingSpace?: boolean }} [options] 选项
 * @returns {void}
 */
export function insertTokenIntoComposer(textarea, tokenText, { trailingSpace = true } = {}) {
	const token = `${tokenText}${trailingSpace ? ' ' : ''}`
	const start = textarea.selectionStart ?? textarea.value.length
	const end = textarea.selectionEnd ?? start
	textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end)
	const caret = start + token.length
	textarea.setSelectionRange(caret, caret)
	textarea.focus()
	textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * 为输入框挂载 @ 提及 autocomplete。
 * @param {HTMLTextAreaElement} textarea 输入框
 * @param {MentionAutocompleteOptions} [options] 选项
 * @returns {() => void} 卸载监听
 */
export function attachMentionAutocomplete(textarea, options = {}) {
	const {
		getContext = () => ({}),
		providers = [],
		listboxPrefix = 'mention',
		emptyI18n = '',
		accessibleLabelI18n = '',
		trailingSpace = true,
		limit = 12,
		onError,
	} = options

	const panel = document.createElement('div')
	panel.id = `${listboxPrefix}-listbox-${++seq}`
	panel.className = 'mention-panel hidden'
	panel.setAttribute('role', 'listbox')
	if (accessibleLabelI18n) panel.dataset.i18n = accessibleLabelI18n
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
		const optionButtons = panel.querySelectorAll('.mention-option')
		for (const button of optionButtons) {
			const selected = Number(button.dataset.index) === activeIndex
			button.classList.toggle('active', selected)
			button.setAttribute('aria-selected', selected ? 'true' : 'false')
		}
		const active = optionButtons[activeIndex]
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
			// 空态不是 listbox（无 option 子元素会触犯 aria-required-children）
			panel.removeAttribute('role')
			panel.innerHTML = `<div class="mention-empty" data-i18n="${emptyI18n}"></div>`
			textarea.removeAttribute('aria-activedescendant')
			return
		}
		panel.setAttribute('role', 'listbox')
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
		const ctx = getContext()
		for (const provider of providers) {
			const rows = await provider(ctx, query, limit)
			if (rows !== null) {
				render(rows)
				return
			}
		}
		render([])
	}

	/**
	 * @param {object} row 选中候选
	 * @returns {string} 插入 token
	 */
	function mentionTokenForRow(row) {
		if (row.rawToken) return row.rawToken
		if (row.kind === 'role' || row.kind === 'everyone' || row.kind === 'here')
			return formatRoleMentionToken(row.roleId ?? row.kind)
		return formatEntityMentionToken(row.entityHash)
	}

	/**
	 * @param {object} row 选中候选
	 * @returns {void}
	 */
	function apply(row) {
		if (!mentionRange) return
		const token = `${mentionTokenForRow(row)}${trailingSpace ? ' ' : ''}`
		textarea.value = textarea.value.slice(0, mentionRange.start) + token + textarea.value.slice(mentionRange.end)
		const caret = mentionRange.start + token.length
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
		const mention = currentMentionQuery(textarea.value, textarea.selectionStart)
		if (!mention) {
			hide()
			return
		}
		mentionRange = { start: mention.start, end: mention.end }
		fetchSuggestions(mention.query).catch(error => {
			onError?.(error)
			hide()
		})
	}

	/** @returns {void} */
	const onBlur = () => setTimeout(hide, 150)

	panel.addEventListener('mousedown', event => {
		const button = event.target instanceof HTMLElement ? event.target.closest('.mention-option') : null
		if (!button) return
		event.preventDefault()
		const row = suggestions[Number(button.dataset.index)]
		if (row) apply(row)
	})

	textarea.addEventListener('input', onInput)
	textarea.addEventListener('keydown', onKeydown)
	textarea.addEventListener('blur', onBlur)

	return () => {
		textarea.removeEventListener('input', onInput)
		textarea.removeEventListener('keydown', onKeydown)
		textarea.removeEventListener('blur', onBlur)
		textarea.removeAttribute('aria-controls')
		textarea.removeAttribute('aria-autocomplete')
		textarea.removeAttribute('aria-activedescendant')
		panel.remove()
	}
}
