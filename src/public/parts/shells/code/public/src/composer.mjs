/**
 * Composer：输入历史 / 影子补全 / `/` 命令面板 / 附件，与 shell 模式切换。
 */
import { listGists } from '/parts/shells:gist/src/endpoints.mjs'
import { attachMentionAutocomplete } from '/scripts/components/mentionAutocomplete.mjs'
import { memoizePromise } from '/scripts/lib/memo.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { addFilesToRuntime } from './attachments.mjs'
import * as api from './endpoints.mjs'
import { notifyTyping } from './generation.mjs'
import { ensureHistory, historySuggestions, ownHistoryNewest } from './history.mjs'
import { cycleMode } from './pills.mjs'
import { syncActiveTabDraft } from './session.mjs'
import { elements, richInput, store, target } from './store.mjs'
import { submitMessage } from './submission.mjs'
import { openDialogFromTemplate } from './templates.mjs'

/** 更新 composer placeholder（normal / shell 模式；占位 span 走 `data-i18n`，随语种自动重译）。 */
export function updateComposerPlaceholder() {
	richInput?.setPlaceholderI18n(store.shellMode ? 'code.composer.placeholderShell' : 'code.composer.placeholderNormal')
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

/** gist 摘要缓存（30s TTL，`@` 补全每次按键都会查询）。 */
const loadGistSummaries = memoizePromise(() => 'all', () => listGists(), { ttlMs: 30_000 })

/**
 * `@` gist 补全 provider：按标题/摘要子串匹配用户 gist。
 * 选中插入 `@[gist:id]`，发送时（submission.mjs）再展开为附件正文。
 * @param {object} _ctx - 补全上下文（未使用）。
 * @param {string} query - 查询子串。
 * @param {number} limit - 结果上限。
 * @returns {Promise<Array<{kind: string, rawToken: string, displayName: string}>>} 候选行。
 */
const gistProvider = async (_ctx, query, limit) => {
	try {
		const gists = await loadGistSummaries()
		const needle = query.trim().toLowerCase()
		return gists
			.filter(gist => !needle
				|| (gist.displayTitle || '').toLowerCase().includes(needle)
				|| (gist.excerpt || '').toLowerCase().includes(needle))
			.slice(0, limit)
			.map(gist => {
				const title = gist.displayTitle || gist.id
				store.gistTitles.set(gist.id, title)
				return { kind: 'gist', rawToken: `@[gist:${gist.id}]`, displayName: title }
			})
	}
	catch {
		return []
	}
}

/**
 * `@` 补全 provider：gist 与当前工作区文件并行匹配后合并（gist 优先）。
 * @param {object} ctx - 补全上下文。
 * @param {string} query - 查询子串。
 * @param {number} limit - 结果上限。
 * @returns {Promise<Array<object>>} 候选行。
 */
const mentionProvider = async (ctx, query, limit) => {
	const [gists, files] = await Promise.all([gistProvider(ctx, query, limit), fileProvider(ctx, query, limit)])
	return [...gists, ...files].slice(0, limit)
}

/* ---------------- 影子补全 ---------------- */

/** 清除影子补全。 */
export function removeGhost() {
	richInput?.setSuffixHint('')
}

/** 渲染影子补全（光标在末尾且历史存在前缀匹配时）。 */
function updateGhost() {
	const value = richInput?.value
	if (!value || richInput.composing || document.activeElement !== elements.composerInput || richInput.selectionStart !== value.length) {
		removeGhost()
		return
	}
	const ghostText = historySuggestions().find(entry => entry.length > value.length && entry.startsWith(value)) || ''
	richInput.setSuffixHint(ghostText.slice(value.length))
}

/**
 * 接受影子补全（Tab / →）。
 * @returns {boolean} 是否已接受。
 */
function acceptGhost() {
	const remainder = richInput.suffixHint
	if (!remainder) return false
	const caret = richInput.selectionStart
	if (caret !== richInput.value.length) {
		removeGhost()
		return false
	}
	richInput.setRangeText(remainder, caret, caret, 'end')
	richInput.commit()
	return true
}

/**
 * 光标是否在第 1 行（↑ 可触发历史导航）。
 * @returns {boolean} 是否首行。
 */
function isAtFirstLine() {
	return !richInput.value.slice(0, richInput.selectionStart).includes('\n')
}

/**
 * 光标是否在最后一行（↓ 可触发历史导航）。
 * @returns {boolean} 是否末行。
 */
function isAtLastLine() {
	return !richInput.value.slice(richInput.selectionStart).includes('\n')
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
		// 命令名来自用户目录（.agents/commands），跳过语种轮换扫描
		name.setAttribute('user-content', '')
		name.textContent = '/' + cmd.name
		const desc = document.createElement('span')
		desc.className = 'code-slash-item-desc'
		desc.setAttribute('user-content', '')
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
	slashPanel.style.bottom = `${window.innerHeight - hostRect.top}px`
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
		await submitMessage({ content })
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
					const labelText = document.createElement('span')
					labelText.className = 'label-text'
					labelText.textContent = name
					if (spec?.required) labelText.append(' *')
					if (spec?.description) labelText.append(' - ', spec.description)
					caption.appendChild(labelText)
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

/* ---------------- shell 模式 ---------------- */

/** 退出 shell 模式（回到普通消息模式）。 */
function exitShellMode() {
	if (!store.shellMode) return
	store.shellMode = false
	elements.composerShell.classList.remove('shell-mode')
	elements.shellPillWrap.classList.add('hidden')
	updateComposerPlaceholder()
	removeGhost()
	// 切回消息历史：避免 ↑/↓ 与影子补全继续使用 shell 命令历史
	void ensureHistory('message')
}

/* ---------------- 事件绑定 ---------------- */

/** 绑定 composer 输入 / 附件事件。 */
export function wireComposerEvents() {
	elements.attachButton.addEventListener('click', () => elements.attachInput.click())
	elements.attachInput.addEventListener('change', () => {
		void addFilesToRuntime(store.activeTabKey, [...elements.attachInput.files])
		elements.attachInput.value = ''
	})

	// 粘贴图片 / 文件到输入框
	elements.composerInput.addEventListener('paste', event => {
		const files = [...event.clipboardData?.files || []]
		if (!files.length) return
		event.preventDefault()
		void addFilesToRuntime(store.activeTabKey, files)
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
		void addFilesToRuntime(store.activeTabKey, [...event.dataTransfer?.files || []])
	})

	// 光标移出末尾（←/Home/点击）时收起影子补全，避免 Tab 把补全插到文本中间
	document.addEventListener('selectionchange', updateGhost)

	elements.composerInput.addEventListener('input', event => {
		// markdownRichInput 会为每次内容变更同步重派发一个 input；浏览器原生事件（trusted）先于该重派发事件到达，
		// 只处理重派发事件即可，避免每次输入把草稿同步 / slash 面板 / 影子补全跑两遍。
		if (event.isTrusted || richInput.composing) return
		if (!fromNav) store.historyNav.pos = null
		const { value } = richInput
		syncActiveTabDraft()
		// 用户开始/继续输入：通知后端重置延迟收尾，避免生成刚结束就运行 agentFinish 钩子
		if (!fromNav) notifyTyping()
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
		if (store.shellMode) hideSlashPanel()
		else {
			// / 命令面板
			const caret = richInput.selectionStart
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
		if (event.key === 'Tab' || (event.key === 'ArrowRight' && richInput.selectionStart === richInput.value.length))
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

// 早期附加：gist / 文件补全 provider 常驻 composerInput
attachMentionAutocomplete(elements.composerInput, {
	providers: [mentionProvider],
	trailingSpace: false,
	listboxPrefix: 'code-mention',
	accessibleLabelI18n: 'code.composer.mentionSuggest',
})
