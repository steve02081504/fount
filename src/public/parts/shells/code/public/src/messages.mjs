/**
 * 消息流：气泡渲染、hover 操作栏 / 反馈 / 行内编辑、贴底滚动与空态布局。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { downloadHtmlDocument, renderMarkdownAsStandaloneDocument } from '/scripts/features/markdown/standaloneDocument.mjs'

import { markSessionDirty, regenerateLastReply } from './session.mjs'
import { elements, store, SCROLL_TOLERANCE } from './store.mjs'

/**
 * 将消息内容里的文件 token 转为行内代码以便渲染。
 * @param {string} content - 原始内容。
 * @returns {string} 处理后的 markdown。
 */
function messageMarkdown(content) {
	return content.replace(/@\[file:([^\]\n]+)\]/g, (_m, path) => '`' + path + '`')
}

/**
 * 创建操作栏图标按钮。
 * @param {string} className - 附加 class。
 * @param {string} i18nKey - aria-label / title 的 i18n 键。
 * @param {string} svg - 图标 SVG。
 * @param {() => void} onClick - 点击回调。
 * @returns {HTMLButtonElement} 按钮。
 */
function messageActionButton(className, i18nKey, svg, onClick) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `code-message-actionbtn btn btn-ghost btn-square btn-xs ${className}`
	const label = geti18n(i18nKey)
	button.setAttribute('aria-label', label)
	button.title = label
	button.innerHTML = svg
	button.addEventListener('click', event => {
		event.stopPropagation()
		onClick()
	})
	return button
}

/**
 * 渲染 hover 操作栏（复制全部；user/char 另有编辑、保存为 HTML）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {HTMLElement} 操作栏。
 */
function renderMessageActions(entry, bubble) {
	const bar = document.createElement('div')
	bar.className = 'code-message-actions'
	bar.appendChild(messageActionButton('code-message-copy', 'code.message.actions.copy', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="8" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>', () => {
		void navigator.clipboard.writeText(entry.content).then(() => showToastI18n('success', 'code.message.copied'))
	}))
	if (entry.role === 'user' || entry.role === 'char') {
		bar.appendChild(messageActionButton('code-message-edit', 'code.message.actions.edit', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>', () => startEditEntry(entry, bubble)))
		bar.appendChild(messageActionButton('code-message-save-html', 'code.message.actions.saveHtml', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="m7 10 5 5 5-5"></path><path d="M12 15V3"></path></svg>', () => { void saveEntryAsHtml(entry) }))
	}
	return bar
}

/**
 * 将消息另存为独立 HTML 文件（离线可读，含主题样式）。
 * @param {object} entry - 会话条目。
 * @returns {Promise<void>}
 */
async function saveEntryAsHtml(entry) {
	const html = await renderMarkdownAsStandaloneDocument(messageMarkdown(entry.content))
	downloadHtmlDocument(html, `fount-code-message-${entry.id}.html`)
}

/**
 * 行内编辑消息文本（仅改原文，不重发）。
 * @param {object} entry - 会话条目。
 * @param {HTMLElement} bubble - 所属气泡。
 * @returns {void}
 */
function startEditEntry(entry, bubble) {
	if (store.generating) return
	const body = bubble.querySelector('.code-message-body')
	if (!body || bubble.querySelector('.code-message-editor')) return
	bubble.classList.add('editing')
	const editor = document.createElement('div')
	editor.className = 'code-message-editor'
	const textarea = document.createElement('textarea')
	textarea.className = 'textarea textarea-bordered textarea-sm w-full'
	textarea.value = entry.content
	textarea.setAttribute('user-content', '')
	textarea.dataset.i18n = 'code.message.edit.ariaLabel'
	const buttons = document.createElement('div')
	buttons.className = 'flex justify-end gap-1.5'
	const save = document.createElement('button')
	save.type = 'button'
	save.className = 'btn btn-primary btn-xs'
	save.textContent = geti18n('code.message.edit.save')
	save.addEventListener('click', () => {
		entry.content = textarea.value
		markSessionDirty()
		renderMessages()
	})
	const cancel = document.createElement('button')
	cancel.type = 'button'
	cancel.className = 'btn btn-ghost btn-xs'
	cancel.textContent = geti18n('code.message.edit.cancel')
	cancel.addEventListener('click', () => renderMessages())
	buttons.append(save, cancel)
	editor.append(textarea, buttons)
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
 * @returns {void}
 */
function showFeedbackReason(entry, bubble) {
	if (bubble.querySelector('.code-message-feedback-reason')) return
	const area = document.createElement('div')
	area.className = 'code-message-feedback-reason'
	const textarea = document.createElement('textarea')
	textarea.className = 'textarea textarea-bordered textarea-sm w-full'
	textarea.setAttribute('user-content', '')
	textarea.dataset.i18n = 'code.message.feedback.reasonAria;code.message.feedback.reasonPlaceholder'
	const buttons = document.createElement('div')
	buttons.className = 'flex justify-end gap-1.5'
	const save = document.createElement('button')
	save.type = 'button'
	save.className = 'btn btn-primary btn-xs'
	save.textContent = geti18n('code.message.feedback.reasonSave')
	save.addEventListener('click', () => setEntryFeedback(entry, 'down', textarea.value.trim()))
	const cancel = document.createElement('button')
	cancel.type = 'button'
	cancel.className = 'btn btn-ghost btn-xs'
	cancel.textContent = geti18n('code.message.edit.cancel')
	cancel.addEventListener('click', () => area.remove())
	buttons.append(save, cancel)
	area.append(textarea, buttons)
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
	bar.appendChild(messageActionButton(`code-message-feedback-up${feedbackType === 'up' ? ' active' : ''}`, 'code.message.feedback.up', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"></path><path d="M15 5.88 14 10H5.17a2 2 0 0 0-1.95 2.45l2 8A2 2 0 0 0 7.17 22H14a2 2 0 0 0 2-2v-9a2 2 0 0 0-.29-1.05L12.46 3.2a1 1 0 0 0-1.82.16z" transform="scale(-1,1) translate(-24,0)"></path></svg>', () => setEntryFeedback(entry, 'up')))
	bar.appendChild(messageActionButton(`code-message-feedback-down${feedbackType === 'down' ? ' active' : ''}`, 'code.message.feedback.down', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"></path><path d="M15 5.88 14 10H5.17a2 2 0 0 0-1.95 2.45l2 8A2 2 0 0 0 7.17 22H14a2 2 0 0 0 2-2v-9a2 2 0 0 0-.29-1.05L12.46 3.2a1 1 0 0 0-1.82.16z"></path></svg>', () => {
		if (entry.extension?.feedback?.type === 'down') setEntryFeedback(entry, 'down')
		else showFeedbackReason(entry, bubble)
	}))
	if (isLast) {
		const regen = messageActionButton('code-message-feedback-regen', 'code.message.regen', '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path></svg>', () => { void regenerateLastReply() })
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
	bubble.addEventListener('mousedown', event => {
		if (event.button !== 0) return
		if (event.target.closest('.code-message-body, .code-message-actions, .code-message-feedback, .code-message-editor, .code-message-feedback-reason, button, textarea, input, summary, a')) return
		bubble.draggable = true
		payloadUrl = ''
		void renderMarkdownAsStandaloneDocument(messageMarkdown(entry.content)).then(html => {
			payloadUrl = URL.createObjectURL(new File([html], `fount-code-message-${entry.id}.html`, { type: 'text/html' }))
		}).catch(() => { })
	})
	bubble.addEventListener('dragend', () => {
		bubble.draggable = false
	})
	bubble.addEventListener('dragstart', event => {
		event.dataTransfer.setData('text/plain', entry.content)
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
	if (entry.role !== 'user' && entry.name) {
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
		if (entry.name === 'shell') details.open = true
		const summary = document.createElement('summary')
		const chevron = document.createElement('span')
		chevron.className = 'code-tool-log-chevron'
		chevron.textContent = '▸'
		const name = document.createElement('span')
		name.className = 'code-tool-log-name'
		name.textContent = entry.name || entry.role
		summary.append(chevron, name)
		const content = document.createElement('div')
		content.className = 'mt-1'
		details.append(summary, content)
		body.appendChild(details)
		renderMarkdownAsString(messageMarkdown(entry.content), store.markdownCache).then(html => {
			content.innerHTML = html
		})
	}
	else {
		const content = document.createElement('div')
		body.appendChild(content)
		renderMarkdownAsString(messageMarkdown(entry.content), store.markdownCache).then(html => {
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
	button.className = 'btn btn-circle btn-ghost btn-sm shadow-lg code-back-to-bottom'
	button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12l7 7 7-7"></path></svg>'
	button.addEventListener('click', scrollMessagesBottom)
	return button
})()

/** 更新回到底部浮标可见性。 */
function updateBackToBottom() {
	backToBottom.classList.toggle('show', !nearBottom() && (store.session?.entries?.length || 0) > 0)
}

elements.messages.addEventListener('scroll', updateBackToBottom, { passive: true })

// 常驻消息流末尾（渲染时会被 replaceChildren / insertBefore 重新定位）
elements.messages.appendChild(backToBottom)

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
	const entries = store.session?.entries || []
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
 * 追加消息气泡。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 气泡元素。
 */
export function appendEntryBubble(entry) {
	const bubble = renderEntryBubble(entry, { isLast: true })
	elements.messages.insertBefore(bubble, backToBottom)
	updateEmptyMode()
	if (nearBottom()) scrollMessagesBottom()
	updateBackToBottom()
	updateRegenButtons()
	return bubble
}
