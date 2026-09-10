/**
 * 消息流：气泡渲染、hover 操作栏 / 反馈 / 行内编辑、贴底滚动与空态布局。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'
import { renderMarkdownAsStandaloneDocument } from '/parts/shells:gist/src/standaloneDocument.mjs'
import { createGist } from '/parts/shells:gist/src/endpoints.mjs'

import { iconElement, icons } from './icons.mjs'
import { markSessionDirty, regenerateLastReply } from './session.mjs'
import { elements, store, SCROLL_TOLERANCE } from './store.mjs'
import { renderTemplate } from './templates.mjs'

/**
 * 条目展示文本（人类层 `content_for_show`，回落 agent 层 `content`）。
 * @param {object} entry - 会话条目。
 * @returns {string} 展示文本。
 */
export function entryShowText(entry) {
	return entry?.content_for_show ?? entry?.content ?? ''
}

/** 已知工具名 → i18n 键（未列出者回落原始 name 或运行 shell 模式）。 */
const TOOL_NAME_I18N = {
	shell: 'code.tool.userShell',
	'file-operations.view-file': 'code.tool.readFile',
	'file-operations.glob': 'code.tool.findFiles',
	'file-operations.grep': 'code.tool.searchContent',
	'file-operations.replace-file': 'code.tool.editFile',
	'file-operations.override-file': 'code.tool.writeFile',
	'file-operations.set-workdir': 'code.tool.setWorkdir',
	'file-operations.list-machines': 'code.tool.listMachines',
	'file-operations.preload': 'code.tool.preload',
	'code-execution.view_files': 'code.tool.viewFiles',
	'code-execution.add_files': 'code.tool.addFiles',
	'code-execution.callback': 'code.tool.callback',
}

/**
 * 从调用卡（首个围栏代码块）解析触发的 XML 标签名，作为未知工具的后备显示名。
 * @param {object} entry - 会话条目。
 * @returns {string|null} 标签名；无法解析时为 null。
 */
function toolTagName(entry) {
	const match = entryShowText(entry).match(/^[ \t]*`{3,}[^\n]*\n[ \t]*<([a-zA-Z][\w.-]*)\b/)
	return match?.[1] ?? null
}

/**
 * 工具条目的本地化显示名（按插件与工具区分读写 / 搜索 / 执行 shell 等）。
 * @param {object} entry - 会话条目。
 * @returns {string} 人类可读标签；未知工具尝试用触发标签名兜底，再回落原始 name。
 */
function toolDisplayLabel(entry) {
	const name = entry.name || entry.role
	const key = TOOL_NAME_I18N[name]
	if (key) return geti18n(key)
	const run = name.match(/^code-execution\.(?:run|inline)-(.+)$/)
	if (run) return geti18n('code.tool.runShell', { lang: run[1] })
	return toolTagName(entry) ?? name
}

/**
 * 条目是否有可渲染内容（工具/系统条目始终渲染；其余需有可见文本或附件）。
 * 纯工具调用生成的 char 条目在人类层被清空，避免残留空气泡。
 * @param {object} entry - 会话条目。
 * @returns {boolean} 是否渲染。
 */
function isEntryVisible(entry) {
	if (entry.role === 'tool' || entry.role === 'system') return true
	if (entry.files?.length) return true
	return Boolean(entryShowText(entry).trim())
}

/**
 * 将消息内容里的文件 / gist token 转为行内代码以便渲染。
 * @param {string} content - 原始内容。
 * @returns {string} 处理后的 markdown。
 */
function messageMarkdown(content) {
	return content
		.replace(/@\[file:([^\]\n]+)\]/g, (_m, path) => '`' + path + '`')
		.replace(/@\[gist:([^\]\n]+)\]/g, (_m, id) => '`' + (store.gistTitles.get(id) || id) + '`')
}

/**
 * 创建操作栏图标按钮。
 * @param {string} className - 附加 class。
 * @param {string} i18nKey - aria-label / title 的 i18n 键。
 * @param {string} icon - Iconify 图标 id。
 * @param {() => void} onClick - 点击回调。
 * @returns {HTMLButtonElement} 按钮。
 */
function messageActionButton(className, i18nKey, icon, onClick) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `code-message-actionbtn btn btn-ghost btn-square btn-xs ${className}`
	const label = geti18n(i18nKey)
	button.setAttribute('aria-label', label)
	button.title = label
	button.appendChild(iconElement(icon, { size: 14 }))
	void svgInliner(button)
	button.addEventListener('click', event => {
		event.stopPropagation()
		onClick()
	})
	return button
}

/**
 * 渲染 hover 操作栏（复制全部；user/char 另有编辑；char 另有保存为 HTML）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {HTMLElement} 操作栏。
 */
function renderMessageActions(entry, bubble) {
	const bar = document.createElement('div')
	bar.className = 'code-message-actions'
	bar.appendChild(messageActionButton('code-message-copy', 'code.message.actions.copy', icons.copy, () => {
		void navigator.clipboard.writeText(entryShowText(entry)).then(
			() => showToastI18n('success', 'code.message.copied'),
			error => showToastI18n('error', 'code.error.generic', { error: String(error?.message || error) }),
		)
	}))
	if (entry.role === 'user' || entry.role === 'char')
		bar.appendChild(messageActionButton('code-message-edit', 'code.message.actions.edit', icons.edit, () => { void startEditEntry(entry, bubble) }))
	if (entry.role === 'char')
		bar.appendChild(messageActionButton('code-message-save-html', 'code.message.actions.saveHtml', icons.download, () => { void saveEntryAsHtml(entry) }))
	return bar
}

/**
 * 将消息另存为 gist 并跳转查看页（gist 查看页负责下载 HTML / 分享）。
 * @param {object} entry - 会话条目。
 * @returns {Promise<void>}
 */
async function saveEntryAsHtml(entry) {
	showToastI18n('info', 'code.gist_source_plugins.creating')
	const markdown = messageMarkdown(entryShowText(entry))
	const title = markdown.split(/\r?\n/).find(line => line.trim())?.slice(0, 60) || 'code message'
	try {
		const gist = await createGist({
			markdown,
			title,
			securityLevel: 'trusted',
			source: {
				type: 'code',
				ref: { sessionId: store.session?.id, entryId: entry.id, role: entry.role },
				exportedAt: Date.now(),
			},
		})
		location.href = '/parts/shells:gist/view?id=' + encodeURIComponent(gist.id)
	}
	catch (error) {
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 行内编辑消息文本（仅改原文，不重发）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {Promise<void>}
 */
async function startEditEntry(entry, bubble) {
	if (store.generating) return
	const body = bubble.querySelector('.code-message-body')
	if (!body || bubble.querySelector('.code-message-editor')) return
	bubble.classList.add('editing')
	const editor = await renderTemplate('message_editor')
	const textarea = editor.querySelector('textarea')
	textarea.value = entry.content_for_edit ?? entry.content
	editor.querySelector('.btn-primary').addEventListener('click', () => {
		entry.content = textarea.value
		delete entry.content_for_show
		delete entry.content_for_edit
		markSessionDirty()
		renderMessages()
	})
	editor.querySelector('.btn-ghost').addEventListener('click', () => renderMessages())
	body.replaceChildren(editor)
	textarea.focus()
}

/**
 * 切换 👍/👎 或记录带原因的反馈（存 entry.extension.feedback，随会话落盘；仅本地标记）。
 * 不带 content 为切换（同向再点取消）；带 content 为直接记录。原位更新按钮态，不整页重渲。
 * @param {object} entry - 会话条目。
 * @param {'up'|'down'} type - 反馈方向。
 * @param {string} [content] - 备注内容（点踩原因等）。
 * @returns {void}
 */
function setEntryFeedback(entry, type, content) {
	entry.extension ??= {}
	if (content != null) entry.extension.feedback = { type, content, time: new Date().toISOString() }
	else if (entry.extension.feedback?.type === type) delete entry.extension.feedback
	else entry.extension.feedback = { type, content: '', time: new Date().toISOString() }
	markSessionDirty()
	const bubble = bubbleOfEntry(entry)
	if (!bubble) return
	const nextType = entry.extension.feedback?.type
	bubble.querySelector('.code-message-feedback-up')?.classList.toggle('active', nextType === 'up')
	bubble.querySelector('.code-message-feedback-down')?.classList.toggle('active', nextType === 'down')
	bubble.querySelector('.code-message-feedback-reason')?.remove()
}

/**
 * 点踩原因输入区（可选填，提交后记录）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {Promise<void>}
 */
async function showFeedbackReason(entry, bubble) {
	if (bubble.querySelector('.code-message-feedback-reason')) return
	const area = await renderTemplate('feedback_reason')
	const textarea = area.querySelector('textarea')
	area.querySelector('.btn-primary').addEventListener('click', () => setEntryFeedback(entry, 'down', textarea.value.trim()))
	area.querySelector('.btn-ghost').addEventListener('click', () => area.remove())
	bubble.appendChild(area)
	textarea.focus()
}

/**
 * 角色消息内联反馈条：👍 / 👎，最后一条另有重新生成。
 * @param {object} entry - 会话条目。
 * @param {boolean} isLast - 是否为会话最后一条。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {HTMLElement} 反馈条。
 */
function renderCharFeedback(entry, isLast, bubble) {
	const bar = document.createElement('div')
	bar.className = 'code-message-feedback'
	const feedbackType = entry.extension?.feedback?.type
	bar.appendChild(messageActionButton(`code-message-feedback-up${feedbackType === 'up' ? ' active' : ''}`, 'code.message.feedback.up', icons.thumbUp, () => setEntryFeedback(entry, 'up')))
	bar.appendChild(messageActionButton(`code-message-feedback-down${feedbackType === 'down' ? ' active' : ''}`, 'code.message.feedback.down', icons.thumbDown, () => {
		if (entry.extension?.feedback?.type === 'down') setEntryFeedback(entry, 'down')
		else void showFeedbackReason(entry, bubble)
	}))
	if (isLast) {
		const regen = messageActionButton('code-message-feedback-regen', 'code.message.regen', icons.regen, () => { void regenerateLastReply() })
		regen.hidden = true
		bar.appendChild(regen)
	}
	return bar
}

/**
 * 按条目 id 找当前 DOM 中的气泡。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement|null} 气泡元素。
 */
export function bubbleOfEntry(entry) {
	return elements.messages.querySelector(`.code-message[data-entry-id="${CSS.escape(String(entry.id))}"]`)
}

/**
 * 绑定消息拖出导出（拖到桌面/编辑器落成 .html；正文区与按钮除外，保证可正常选中与点击）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {void}
 */
function bindMessageDragExport(entry, bubble) {
	let payloadUrl = ''
	/** 拖拽代号：每次 mousedown 自增；异步导出完成时代号已过期（又开始了新拖拽/已 dragend）则直接丢弃。 */
	let dragToken = 0
	/** 撤销当前导出的 object URL。 */
	const revokePayloadUrl = () => {
		if (payloadUrl) {
			URL.revokeObjectURL(payloadUrl)
			payloadUrl = ''
		}
	}
	bubble.addEventListener('mousedown', event => {
		if (event.button !== 0) return
		if (event.target.closest('.code-message-body, .code-message-actions, .code-message-feedback, .code-message-editor, .code-message-feedback-reason, button, textarea, input, summary, a')) return
		bubble.draggable = true
		const token = ++dragToken
		revokePayloadUrl()
		void renderMarkdownAsStandaloneDocument(messageMarkdown(entryShowText(entry))).then(html => {
			const url = URL.createObjectURL(new File([html], `fount-code-message-${entry.id}.html`, { type: 'text/html' }))
			// 期间又发起了新拖拽（或已结束），该 URL 无人消费，立即回收
			if (token !== dragToken) {
				URL.revokeObjectURL(url)
				return
			}
			revokePayloadUrl()
			payloadUrl = url
		}).catch(() => { })
	})
	bubble.addEventListener('dragend', () => {
		bubble.draggable = false
		dragToken++
		revokePayloadUrl()
	})
	bubble.addEventListener('dragstart', event => {
		event.dataTransfer.setData('text/plain', entryShowText(entry))
		event.dataTransfer.effectAllowed = 'copy'
		if (payloadUrl) event.dataTransfer.setData('DownloadURL', `text/html:fount-code-message-${entry.id}.html:${payloadUrl}`)
	})
}

/**
 * 渲染单条消息气泡。
 * @param {object} entry - 会话条目。
 * @param {{isLast?: boolean}} [options] - 是否为会话最后一条（角色消息显示重新生成）。
 * @returns {HTMLElement} 气泡元素。
 */
function renderEntryBubble(entry, { isLast = false } = {}) {
	const bubble = document.createElement('div')
	bubble.className = `code-message role-${entry.role}`
	bubble.dataset.entryId = entry.id
	bubble.setAttribute('user-content', '')
	if (entry.role === 'char' && entry.name) {
		const name = document.createElement('div')
		name.className = 'code-message-name'
		name.textContent = entry.name
		bubble.appendChild(name)
	}
	const body = document.createElement('div')
	body.className = 'code-message-body'
	bubble.appendChild(body)
	if (entry.role === 'tool' || entry.role === 'system') {
		const details = document.createElement('details')
		details.className = 'code-tool-log'
		if (entry.name === 'shell' || entry.name?.startsWith('code-execution')) details.open = true
		const summary = document.createElement('summary')
		const chevron = document.createElement('span')
		chevron.className = 'code-tool-log-chevron'
		chevron.textContent = '▸'
		const name = document.createElement('span')
		name.className = 'code-tool-log-name'
		name.textContent = toolDisplayLabel(entry)
		summary.append(chevron, name)
		const content = document.createElement('div')
		content.className = 'mt-1'
		details.append(summary, content)
		body.appendChild(details)
		renderMarkdownAsString(messageMarkdown(entryShowText(entry)), store.markdownCache).then(html => {
			content.innerHTML = html
		})
	}
	else {
		const content = document.createElement('div')
		body.appendChild(content)
		renderMarkdownAsString(messageMarkdown(entryShowText(entry)), store.markdownCache).then(html => {
			content.innerHTML = html
		})
	}

	for (const file of entry.files || []) {
		const chip = document.createElement('div')
		chip.className = 'text-xs opacity-70'
		chip.textContent = `📎 ${file.name}`
		body.appendChild(chip)
	}
	bubble.appendChild(renderMessageActions(entry, bubble))
	if (entry.role === 'char') bubble.appendChild(renderCharFeedback(entry, isLast, bubble))
	bindMessageDragExport(entry, bubble)
	return bubble
}

/** 刷新各气泡的「重新生成」按钮可见性（仅最后一条为角色消息且未在生成时显示）。 */
export function updateRegenButtons() {
	const entries = store.session?.entries || []
	const last = entries.at(-1)
	for (const el of elements.messages.querySelectorAll('.code-message[data-entry-id]')) {
		const regen = el.querySelector('.code-message-feedback-regen')
		if (!regen) continue
		regen.hidden = !(last && String(last.id) === el.dataset.entryId && last.role === 'char' && !store.generating)
	}
}

/**
 * 消息流是否接近底部。
 * @returns {boolean} 是否贴底。
 */
export function nearBottom() {
	const el = elements.messages
	return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_TOLERANCE
}

/** 滚动消息流到底部。 */
export function scrollMessagesBottom() {
	elements.messages.scrollTop = elements.messages.scrollHeight
}

/** 回到底部浮标（sticky 于消息流末尾，贴底时隐藏）。 */
export const backToBottom = (() => {
	const button = document.createElement('button')
	button.type = 'button'
	button.id = 'code-back-to-bottom'
	button.className = 'btn btn-square btn-ghost btn-sm shadow-lg code-back-to-bottom'
	button.appendChild(iconElement(icons.chevronDown, { size: 16 }))
	void svgInliner(button)
	button.addEventListener('click', scrollMessagesBottom)
	return button
})()

/** 更新回到底部浮标可见性。 */
function updateBackToBottom() {
	backToBottom.classList.toggle('show', !nearBottom() && (store.session?.entries?.length || 0) > 0)
}

elements.messages.addEventListener('scroll', updateBackToBottom, { passive: true })

/**
 * 空态布局开关：无条目且未在生成时 composer 垂直居中 + wordmark。
 * 生成中（entries 仍为空）不算空态——消息流必须保持可见，流式气泡才有容器。
 */
export function updateEmptyMode() {
	const empty = !(store.session?.entries?.length || 0)
		&& !(store.generating && store.generatingSession === store.session)
	document.querySelector('.code-main')?.classList.toggle('empty-mode', empty)
}

/** 渲染全部消息。 */
export function renderMessages() {
	updateEmptyMode()
	const entries = (store.session?.entries || []).filter(isEntryVisible)
	if (!entries.length) {
		elements.messages.replaceChildren(backToBottom)
		updateBackToBottom()
		return
	}
	elements.messages.replaceChildren(...entries.map((entry, index) => renderEntryBubble(entry, { isLast: index === entries.length - 1 })), backToBottom)
	scrollMessagesBottom()
	updateBackToBottom()
	updateRegenButtons()
}

/**
 * 追加消息气泡（无可见内容的条目直接跳过）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement|null} 气泡元素；跳过时为 null。
 */
export function appendEntryBubble(entry) {
	if (!isEntryVisible(entry)) return null
	const wasNearBottom = nearBottom()
	const bubble = renderEntryBubble(entry, { isLast: true })
	elements.messages.insertBefore(bubble, backToBottom)
	updateEmptyMode()
	if (wasNearBottom) scrollMessagesBottom()
	updateBackToBottom()
	updateRegenButtons()
	return bubble
}
