/**
 * Composer：输入历史 / 影子补全 / `/` 命令面板 / 附件，与 shell 模式切换。
 */
import { attachMentionAutocomplete } from '/scripts/components/mentionAutocomplete.mjs'
import { blobToBase64 } from '/scripts/lib/base64.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

import * as api from './endpoints.mjs'
import { cycleMode } from './pills.mjs'
import { sendMessage, syncActiveTabDraft } from './session.mjs'
import { ATTACHMENT_MAX_BYTES, elements, getPref, richInput, setPref, store, target } from './store.mjs'
import { openDialogFromTemplate } from './templates.mjs'

/** 更新 composer placeholder（normal / shell 模式）。 */
export function updateComposerPlaceholder() {
	const placeholder = store.shellMode
		? geti18n('code.composer.placeholderShell')
		: geti18n('code.composer.placeholderNormal')
	const node = elements.composerInput.querySelector('.fount-markdown-rich-input-placeholder')
	if (node) node.textContent = placeholder
	// markdownRichInput 在 focus/click 时会按 placeholder 属性重建占位符 span，同步该属性保证重建后仍是当前模式的文案
	elements.composerInput.setAttribute('placeholder', placeholder)
}

/**
 * `@` 文件补全 provider：在当前工作区内按文件名子串搜索。
 * @param {object} _ctx - 补全上下文（未使用）。
 * @param {string} query - 查询子串。
 * @param {number} limit - 结果上限。
 * @returns {Promise<Array<{kind: string, rawToken: string, displayName: string}>>} 候选行。
 */
const fileProvider = async (_ctx, query, limit) => {
	if (!store.workspace?.path) return []
	try {
		const { files } = await api.searchFiles(target(), query)
		return files.slice(0, limit).map(path => ({
			kind: 'file',
			rawToken: `@[file:${path}]`,
			displayName: path.split('/').pop(),
		}))
	}
	catch {
		return []
	}
}

/* ---------------- 输入历史 / 影子补全 ---------------- */

/**
 * 合并历史条目（保持去重；已存在的本地追加优先，避免加载覆盖加载期间的本地新条目）。
 * @param {string[]} loaded - 后端读取的历史（追加序）。
 * @param {string[]} existing - 本地已有历史（追加序）。
 * @returns {string[]} 合并结果。
 */
function mergeHistoryEntries(loaded, existing) {
	const seen = new Set()
	const out = []
	for (const entry of [...loaded, ...existing]) {
		if (!entry || seen.has(entry)) continue
		seen.add(entry)
		out.push(entry)
	}
	return out
}

/**
 * 加载当前模式历史。
 * @param {'shell'|'message'} mode - 历史模式。
 * @returns {Promise<void>}
 */
async function loadHistory(mode) {
	if (mode === 'shell') {
		const data = await api.getHistory(target(), 'shell', store.shell).catch(() => ({ own: [], native: [] }))
		store.historyState.own = mergeHistoryEntries(data.own || [], store.historyState.own)
		store.historyState.native = data.native || []
	}
	else if (store.workspace) {
		const data = await api.getHistory(target(), 'message').catch(() => ({ own: [] }))
		store.historyState.own = mergeHistoryEntries(data.own || [], store.historyState.own)
		store.historyState.native = []
	}
	else {
		store.historyState.own = mergeHistoryEntries(JSON.parse(getPref('messageHistory') || '[]'), store.historyState.own)
		store.historyState.native = []
	}
	store.historyState.mode = mode
}

/**
 * 确保当前模式历史已加载。
 * @param {'shell'|'message'} mode - 历史模式。
 * @returns {Promise<void>}
 */
export async function ensureHistory(mode) {
	if (store.historyState.mode === mode) return
	await loadHistory(mode)
}

/**
 * 合并后的补全候选（自有优先、newest-first、去重）。
 * @returns {string[]} 候选列表。
 */
function historySuggestions() {
	const seen = new Set()
	const merged = []
	for (const entry of [...store.historyState.own].reverse().concat(store.historyState.native)) {
		if (!entry || seen.has(entry)) continue
		seen.add(entry)
		merged.push(entry)
	}
	return merged
}

/**
 * 自有历史（newest-first，↑/↓ 遍历用）。
 * @returns {string[]} 历史列表。
 */
function ownHistoryNewest() {
	return [...store.historyState.own].reverse()
}

/** 移除影子补全 span。 */
export function removeGhost() {
	elements.composerInput.querySelector('.code-composer-ghost')?.remove()
}

/** 渲染影子补全（光标在末尾且历史存在前缀匹配时）。 */
function updateGhost() {
	removeGhost()
	const value = richInput.value
	if (!value || !historySuggestions().length) return
	if (elements.composerInput.selectionStart !== value.length) return
	const ghostText = historySuggestions().find(entry => entry.length > value.length && entry.startsWith(value)) || ''
	if (!ghostText) return
	const ghost = document.createElement('span')
	ghost.className = 'code-composer-ghost'
	ghost.setAttribute('contenteditable', 'false')
	ghost.dataset.emptySlot = '1'
	ghost.textContent = ghostText.slice(value.length)
	elements.composerInput.appendChild(ghost)
}

/**
 * 接受影子补全（Tab / →）。
 * @returns {boolean} 是否已接受。
 */
function acceptGhost() {
	const ghost = elements.composerInput.querySelector('.code-composer-ghost')
	if (!ghost?.textContent) return false
	const remainder = ghost.textContent
	removeGhost()
	const caret = elements.composerInput.selectionStart
	richInput.setRangeText(remainder, caret, caret, 'end')
	elements.composerInput.dispatchEvent(new Event('input', { bubbles: true }))
	return true
}

/**
 * 光标是否在第 1 行（↑ 可触发历史导航）。
 * @returns {boolean} 是否首行。
 */
function isAtFirstLine() {
	return !richInput.value.slice(0, elements.composerInput.selectionStart).includes('\n')
}

/**
 * 光标是否在最后一行（↓ 可触发历史导航）。
 * @returns {boolean} 是否末行。
 */
function isAtLastLine() {
	return !richInput.value.slice(elements.composerInput.selectionStart).includes('\n')
}

/** 历史导航派发的 input 事件标志（避免重置导航游标）。 */
let fromNav = false

/**
 * ↑/↓ 历史导航（仅当前模式自有历史）。pos 语义：0 = 草稿，n = 从草稿起第 n 条历史。
 * @param {number} direction - -1 更旧（↑）/ +1 更新（↓）。
 * @returns {void}
 */
function navHistory(direction) {
	const entries = ownHistoryNewest()
	if (!entries.length) return
	if (store.historyNav.pos === null) {
		store.historyNav.draft = richInput.value
		store.historyNav.pos = 0
	}
	const next = Math.max(0, Math.min(entries.length, store.historyNav.pos - direction))
	if (next === store.historyNav.pos) return
	store.historyNav.pos = next
	richInput.value = next === 0 ? store.historyNav.draft : entries[next - 1]
	fromNav = true
	elements.composerInput.dispatchEvent(new Event('input', { bubbles: true }))
	fromNav = false
}

/**
 * 追加一条自有历史并持久化（本地状态立即更新；无工作区时消息历史回退 localStorage）。
 * @param {'shell'|'message'} kind - 历史类型。
 * @param {string} command - 条目内容。
 * @returns {void}
 */
export function appendLocalHistory(kind, command) {
	store.historyState.own = [...store.historyState.own.filter(entry => entry !== command), command]
	if (!command?.trim()) return
	if (store.workspace)
		void api.appendHistory(target(), kind, command).catch(() => { })
	else {
		const list = JSON.parse(getPref('messageHistory') || '[]')
		setPref('messageHistory', JSON.stringify([...list.filter(entry => entry !== command), command].slice(-500)))
	}
}

/* ---------------- `/` 命令面板 ---------------- */

/** `/` 命令补全面板。 */
const slashPanel = (() => {
	const panel = document.createElement('div')
	panel.className = 'code-slash-panel hidden border border-base-content/20 rounded-box bg-base-100 shadow-xl'
	document.body.appendChild(panel)
	return panel
})()
/** 当前候选命令。 */
let slashSuggestions = []
/** 当前高亮下标。 */
let slashActive = 0
/** 面板触发处的输入区间（命令渲染后清空）。 */
let slashRange = null

/** 隐藏 `/` 命令面板。 */
function hideSlashPanel() {
	slashPanel.classList.add('hidden')
	slashSuggestions = []
}

/** 渲染 `/` 命令面板列表。 */
function renderSlashItems() {
	slashPanel.replaceChildren(...slashSuggestions.map((cmd, index) => {
		const button = document.createElement('button')
		button.type = 'button'
		button.className = 'code-slash-item' + (index === slashActive ? ' active' : '')
		const name = document.createElement('strong')
		name.className = 'code-slash-item-name'
		name.textContent = '/' + cmd.name
		const desc = document.createElement('span')
		desc.className = 'code-slash-item-desc'
		desc.textContent = cmd.description || ''
		button.append(name, desc)
		button.addEventListener('click', () => void applySlashCommand(cmd))
		return button
	}))
}

/**
 * 显示 `/` 命令面板。
 * @param {string} query - 查询词。
 * @returns {void}
 */
function showSlashPanel(query) {
	slashSuggestions = (store.commands || []).filter(cmd => cmd.name.startsWith(query)).slice(0, 12)
	if (!slashSuggestions.length) {
		hideSlashPanel()
		return
	}
	slashActive = 0
	renderSlashItems()
	slashPanel.classList.remove('hidden')
	const hostRect = elements.composerShell.getBoundingClientRect()
	slashPanel.style.left = `${hostRect.left}px`
	slashPanel.style.top = `${hostRect.top - 8}px`
	slashPanel.style.minWidth = `${Math.max(240, hostRect.width / 2)}px`
}

/**
 * 应用选中的 `/` 命令：补全参数并渲染后发送。
 * @param {object} command - 命令条目。
 * @returns {Promise<void>}
 */
async function applySlashCommand(command) {
	hideSlashPanel()
	let argv = {}
	if (Object.keys(command.params || {}).length) {
		argv = await openCommandParams(command)
		if (argv === null) return
	}
	try {
		const { content } = await api.renderCommand(target(), command.name, argv)
		if (slashRange) {
			richInput.setRangeText('', slashRange.start, slashRange.end, 'end')
			slashRange = null
		}
		await sendMessage(content)
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 打开命令参数填写对话框。
 * @param {object} command - 命令条目。
 * @returns {Promise<Record<string, string>|null>} 参数（取消时 null）。
 */
async function openCommandParams(command) {
	return await new Promise(resolve => {
		let settled = false
		/**
		 * 记录对话框结果（只生效一次）。
		 * @param {Record<string, string>|null} value - 参数或取消。
		 * @returns {void}
		 */
		const settle = value => {
			if (settled) return
			settled = true
			resolve(value)
		}
		void openDialogFromTemplate('command_params', { commandName: command.name }, {
			/**
			 * 绑定参数表单。
			 * @param {HTMLDialogElement} dialog - 已打开的对话框。
			 * @returns {void}
			 */
			onReady: dialog => {
				const fields = dialog.querySelector('#command-params-fields')
				const inputs = {}
				fields.replaceChildren(...Object.entries(command.params || {}).map(([name, spec]) => {
					const label = document.createElement('label')
					label.className = 'form-control w-full mb-2'
					const caption = document.createElement('div')
					caption.className = 'label'
					caption.innerHTML = `<span class="label-text">${name}${spec?.required ? ' *' : ''}${spec?.description ? ` - ${spec.description}` : ''}</span>`
					const input = document.createElement('input')
					input.className = 'input input-sm input-bordered w-full'
					input.value = spec?.default || ''
					input.setAttribute('user-content', '')
					inputs[name] = input
					label.append(caption, input)
					return label
				}))
				dialog.querySelector('#command-params-run').addEventListener('click', () => {
					const argv = {}
					for (const [name, input] of Object.entries(inputs)) argv[name] = input.value
					dialog.close()
					settle(argv)
				})
				dialog.addEventListener('close', () => settle(null))
			},
		}).catch(error => {
			showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
			settle(null)
		})
	})
}

/* ---------------- 附件 ---------------- */

/** 渲染待发送附件预览条（名称 chip + 移除按钮）。 */
export function renderAttachmentPreview() {
	const strip = elements.attachmentPreview
	strip.replaceChildren(...store.pendingFiles.map((file, index) => {
		const chip = document.createElement('span')
		chip.className = 'code-attachment-chip'
		const name = document.createElement('span')
		name.className = 'code-attachment-chip-name'
		name.textContent = file.name
		const remove = document.createElement('button')
		remove.type = 'button'
		remove.className = 'code-attachment-chip-remove'
		remove.dataset.i18n = 'code.attach.remove'
		remove.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
		remove.addEventListener('click', () => {
			store.pendingFiles.splice(index, 1)
			renderAttachmentPreview()
		})
		chip.append(name, remove)
		return chip
	}))
	strip.hidden = !store.pendingFiles.length
}

/**
 * 追加待发送附件（过大文件拒绝并提示）。
 * @param {File[]} files - 文件列表。
 * @returns {Promise<void>}
 */
async function addComposerFiles(files) {
	for (const file of files) {
		if (file.size > ATTACHMENT_MAX_BYTES) {
			showToastI18n('error', 'code.attach.tooLarge', { name: file.name })
			continue
		}
		store.pendingFiles.push({ name: file.name, mime_type: file.type || 'application/octet-stream', buffer: await blobToBase64(file), description: '' })
	}
	renderAttachmentPreview()
}

/* ---------------- shell 模式 ---------------- */

/** 退出 shell 模式（回到普通消息模式）。 */
export function exitShellMode() {
	if (!store.shellMode) return
	store.shellMode = false
	elements.composerShell.classList.remove('shell-mode')
	elements.shellPillWrap.classList.add('hidden')
	updateComposerPlaceholder()
	removeGhost()
}

/* ---------------- 事件绑定 ---------------- */

/** 绑定 composer 输入 / 附件事件。 */
export function wireComposerEvents() {
	elements.attachButton.addEventListener('click', () => elements.attachInput.click())
	elements.attachInput.addEventListener('change', () => {
		void addComposerFiles([...elements.attachInput.files])
		elements.attachInput.value = ''
	})

	// 粘贴图片 / 文件到输入框
	elements.composerInput.addEventListener('paste', event => {
		const files = [...event.clipboardData?.files || []]
		if (!files.length) return
		event.preventDefault()
		void addComposerFiles(files)
	})

	// 拖文件到 composer 卡片（enter/leave 计数防子元素抖动）
	let dragDepth = 0
	elements.composerShell.addEventListener('dragenter', event => {
		if (![...event.dataTransfer?.types || []].includes('Files')) return
		event.preventDefault()
		dragDepth++
		elements.composerShell.classList.add('drag-over')
		elements.dropOverlay.hidden = false
	})
	elements.composerShell.addEventListener('dragleave', () => {
		if (--dragDepth <= 0) {
			dragDepth = 0
			elements.composerShell.classList.remove('drag-over')
			elements.dropOverlay.hidden = true
		}
	})
	elements.composerShell.addEventListener('dragover', event => event.preventDefault())
	elements.composerShell.addEventListener('drop', event => {
		event.preventDefault()
		dragDepth = 0
		elements.composerShell.classList.remove('drag-over')
		elements.dropOverlay.hidden = true
		void addComposerFiles([...event.dataTransfer?.files || []])
	})

	elements.composerInput.addEventListener('input', () => {
		if (!fromNav) store.historyNav.pos = null
		const value = richInput.value
		syncActiveTabDraft()
		// ！/! 切 shell 执行模式：内容为空时键入叹号，进入后移除该字符，供干净命令输入
		if (!store.shellMode && (value === '！' || value === '!')) {
			store.shellMode = true
			richInput.value = ''
			syncActiveTabDraft()
			elements.composerShell.classList.add('shell-mode')
			elements.shellPillWrap.classList.remove('hidden')
			updateComposerPlaceholder()
			void ensureHistory('shell')
			return
		}
		if (store.shellMode) 
			hideSlashPanel()
		
		else {
			// / 命令面板
			const caret = elements.composerInput.selectionStart
			const before = value.slice(0, caret)
			const slashMatch = before.match(/(?:^|\s)\/([^\s/]*)$/)
			if (slashMatch) {
				slashRange = { start: caret - slashMatch[1].length - 1, end: caret }
				showSlashPanel(slashMatch[1])
			}
			else hideSlashPanel()
		}
		updateGhost()
	})

	elements.composerInput.addEventListener('keydown', event => {
		if (!slashPanel.classList.contains('hidden')) {
			if (event.key === 'ArrowDown') {
				event.preventDefault()
				slashActive = (slashActive + 1) % slashSuggestions.length
				renderSlashItems()
				return
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault()
				slashActive = (slashActive - 1 + slashSuggestions.length) % slashSuggestions.length
				renderSlashItems()
				return
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault()
				void applySlashCommand(slashSuggestions[slashActive])
				return
			}
			if (event.key === 'Escape') {
				hideSlashPanel()
				return
			}
		}
		// shell 模式空内容 Backspace 退出
		if (store.shellMode && event.key === 'Backspace' && !richInput.value) {
			event.preventDefault()
			exitShellMode()
			return
		}
		// Tab / →（光标在末尾）接受影子补全
		if (event.key === 'Tab' || (event.key === 'ArrowRight' && elements.composerInput.selectionStart === richInput.value.length))
			if (acceptGhost()) {
				event.preventDefault()
				return
			}

		// Tab 轮换 mode（无影子补全且非 shell 模式）
		if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !store.shellMode) {
			event.preventDefault()
			cycleMode()
			return
		}
		// ↑/↓ 边缘行历史导航
		if (event.key === 'ArrowUp' && !event.shiftKey && !event.ctrlKey && !event.altKey && isAtFirstLine()) {
			event.preventDefault()
			navHistory(-1)
			return
		}
		if (event.key === 'ArrowDown' && !event.shiftKey && !event.ctrlKey && !event.altKey && isAtLastLine()) {
			event.preventDefault()
			navHistory(1)
			return
		}
		// Ctrl/Cmd+Enter 发送
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault()
			elements.sendButton.click()
		}
	})
}

// 早期附加：文件补全 provider 常驻 composerInput
attachMentionAutocomplete(elements.composerInput, {
	providers: [fileProvider],
	trailingSpace: false,
	listboxPrefix: 'code-file',
})
