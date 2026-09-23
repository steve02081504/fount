/**
 * 消息流：气泡渲染、hover 操作栏 / 反馈 / 行内编辑、贴底滚动与空态布局。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { renderMarkdownAsString } from '/scripts/features/markdown/index.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'
import { renderMarkdownAsStandaloneDocument } from '/parts/shells:gist/src/standaloneDocument.mjs'
import { createGist } from '/parts/shells:gist/src/endpoints.mjs'

import { asyncStateLabel, asyncTaskCardElement } from './asynctasks.mjs'
import { iconElement, icons } from './icons.mjs'
import { repairOrphanedReplyFence } from './replyMarkdown.mjs'
import { updateRunCards } from './runCards.mjs'
import { markSessionDirty, regenerateLastReply } from './session.mjs'
import { elements, store, SCROLL_TOLERANCE } from './store.mjs'
import { subAgentCardElement } from './subagents.mjs'
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
	'sub-agent.create-batch': 'code.tool.subAgent.createBatch',
	'sub-agent.run': 'code.tool.subAgent.run',
	'sub-agent.list-ai-sources': 'code.tool.subAgent.listAiSources',
	'sub-agent.terminate': 'code.tool.subAgent.terminate',
	'async-task.list': 'code.tool.async.list',
	'async-task.await': 'code.tool.async.await',
	'async-task.inspect': 'code.tool.async.inspect',
	'async-task': 'code.tool.async.notice',
}

/** 子代理内部对话的角色标签 i18n 键（未知角色回落原始名）。 */
const TRANSCRIPT_ROLE_I18N = {
	tool: 'code.transcript.role.tool',
	char: 'code.transcript.role.char',
	user: 'code.transcript.role.user',
	system: 'code.transcript.role.system',
}

/**
 * 由工具名取人类可读标签（无 i18n 映射时回落原始名）。
 * @param {string} name - 工具名。
 * @returns {string} 标签。
 */
function labelForToolName(name) {
	if (!name) return ''
	const key = TOOL_NAME_I18N[name]
	if (key) return geti18n(key)
	const run = name.match(/^code-execution\.(?:run|inline)-(.+)$/)
	if (run) return geti18n('code.tool.runShell', { lang: run[1] })
	return name
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
	if (name === 'code-execution.async')
		return geti18n('code.tool.async.run', { kind: entry.extension?.asyncTask?.kind || '' })
	if (TOOL_NAME_I18N[name] || /^code-execution\.(?:run|inline)-/.test(name))
		return labelForToolName(name)
	return toolTagName(entry) ?? labelForToolName(name)
}

/**
 * 渲染一条子代理内部对话条目（角色标签 + 名字 + markdown 正文）。
 * @param {{role: string, name: string, content: string}} item - 条目。
 * @returns {HTMLElement} 条目元素。
 */
function renderTranscriptEntry(item) {
	const row = document.createElement('div')
	row.className = `code-transcript-entry role-${item.role || 'system'}`
	const head = document.createElement('div')
	head.className = 'code-transcript-entry-head'
	const role = document.createElement('span')
	role.className = 'code-transcript-role'
	role.textContent = TRANSCRIPT_ROLE_I18N[item.role] ? geti18n(TRANSCRIPT_ROLE_I18N[item.role]) : item.role || ''
	const name = document.createElement('span')
	name.className = 'code-transcript-name'
	name.setAttribute('prompt-content', '')
	name.textContent = item.role === 'tool' ? labelForToolName(item.name) : item.name || ''
	head.append(role, name)
	const body = document.createElement('div')
	body.className = 'code-transcript-body markdown-body'
	body.setAttribute('prompt-content', '')
	renderMarkdownAsString(messageMarkdown(item.content ?? ''), store.markdownCache).then(html => {
		body.innerHTML = html
	})
	row.append(head, body)
	return row
}

/**
 * 渲染统一异步任务行（类型 / 标签 / id / 状态 / 结果）。
 * 状态为历史快照：仅当载荷带 `state` 时显示状态徽标 —— `<list-async/>` 与未结算的 `<await-async/>` 不套运行中徽标。
 * @param {object} task - 任务摘要。
 * @returns {HTMLElement} 任务行。
 */
function renderAsyncTaskRow(task) {
	const row = document.createElement('div')
	row.className = 'code-async-task-row'
	const head = document.createElement('div')
	head.className = 'code-async-task-row-head'
	const kind = document.createElement('span')
	kind.className = 'code-async-task-kind'
	kind.textContent = task.kind || ''
	const label = document.createElement('span')
	label.className = 'code-async-task-label'
	label.setAttribute('prompt-content', '')
	label.textContent = task.label || ''
	const id = document.createElement('code')
	id.className = 'code-async-task-id'
	id.textContent = task.id || ''
	head.append(kind, label, id)
	if (task.state) {
		const state = document.createElement('span')
		state.className = 'badge badge-sm code-async-task-state'
		state.textContent = asyncStateLabel(task.state)
		head.appendChild(state)
	}
	row.appendChild(head)
	const bodyText = task.state === 'failed' ? task.error : task.result
	if (bodyText) {
		const body = document.createElement('div')
		body.className = 'code-async-task-result markdown-body'
		body.setAttribute('prompt-content', '')
		renderMarkdownAsString(messageMarkdown(String(bodyText)), store.markdownCache).then(html => {
			body.innerHTML = html
		})
		row.appendChild(body)
	}
	return row
}

/**
 * 渲染 `<list-async/>` 的结构化任务列表（快照：仅列出当时进行中的任务，不推断终态）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 列表。
 */
function renderAsyncList(entry) {
	const meta = entry.extension.asyncList ?? {}
	const wrap = document.createElement('div')
	wrap.className = 'code-async-task-list'
	if (!meta.tasks?.length) {
		wrap.classList.add('empty')
		wrap.textContent = geti18n('code.asyncTasks.none')
		return wrap
	}
	for (const task of meta.tasks) wrap.appendChild(renderAsyncTaskRow(task))
	return wrap
}

/**
 * 渲染 `<await-async/>` 的结构化等待结果（已结算任务带终态；待定 / 未找到为快照）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 列表。
 */
function renderAsyncAwait(entry) {
	const meta = entry.extension.asyncAwait ?? {}
	const wrap = document.createElement('div')
	wrap.className = 'code-async-task-list'
	for (const task of meta.settled ?? []) wrap.appendChild(renderAsyncTaskRow(task))
	for (const id of meta.pending ?? []) wrap.appendChild(renderAsyncTaskRow({ id }))
	for (const id of meta.unknown ?? []) wrap.appendChild(renderAsyncTaskRow({ id, state: 'unknown' }))
	if (meta.timedOut) {
		const note = document.createElement('div')
		note.className = 'code-async-task-note'
		note.textContent = geti18n('code.asyncTasks.timedOut')
		wrap.appendChild(note)
	}
	return wrap
}

/**
 * 渲染 `<inspect-async/>` 的结构化检视结果。
 * 子代理载荷带 `entries`（角色标签对话）；JS / shell 为纯文本片段（`preview`）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 卡片。
 */
function renderAsyncInspect(entry) {
	const meta = entry.extension.asyncInspect ?? {}
	const wrap = document.createElement('div')
	wrap.className = 'code-async-inspect'
	if (Array.isArray(meta.entries)) {
		if (!meta.entries.length) {
			wrap.textContent = geti18n('code.asyncTasks.none')
			return wrap
		}
		const list = document.createElement('div')
		list.className = 'code-transcript'
		for (const item of meta.entries) list.appendChild(renderTranscriptEntry(item))
		wrap.appendChild(list)
		return wrap
	}
	const body = document.createElement('div')
	body.className = 'code-async-inspect-preview markdown-body'
	body.setAttribute('prompt-content', '')
	renderMarkdownAsString(messageMarkdown(String(meta.preview ?? '')), store.markdownCache).then(html => {
		body.innerHTML = html
	})
	wrap.appendChild(body)
	return wrap
}

/**
 * 条目是否有可渲染内容（工具/系统条目始终渲染；其余需有可见文本或附件）。
 * 纯工具调用生成的 char 条目在人类层被清空，避免残留空气泡。
 * @param {object} entry - 会话条目。
 * @returns {boolean} 是否渲染。
 */
export function isEntryVisible(entry) {
	if (entry.role === 'tool' || entry.role === 'system') return true
	if (entry.files?.length) return true
	return Boolean(entryShowText(entry).trim())
}

/**
 * 将消息内容里的文件 / gist token 转为行内代码以便渲染。
 * @param {string} content - 原始内容。
 * @param {string} role - 条目角色（仅修复角色回复中的孤立围栏）。
 * @returns {string} 处理后的 markdown。
 */
function messageMarkdown(content, role = '') {
	return (role === 'char' ? repairOrphanedReplyFence(content) : content)
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
	const markdown = messageMarkdown(entryShowText(entry), entry.role)
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
 * 更新 `!` 流式执行气泡的纯文本输出（逐块调用，避免每片重渲 markdown）。
 * @param {object} entry - 会话条目。
 * @returns {void}
 */
export function updateShellStreamBubble(entry) {
	const output = bubbleOfEntry(entry)?.querySelector('.code-shell-stream-output')
	if (output) output.textContent = entry.extension?.shellStream?.output || ''
}

/**
 * 重渲单条气泡（内容变更后使用，如流式执行结束转为正式 markdown）。
 * @param {object} entry - 会话条目。
 * @returns {void}
 */
export function updateEntryBubble(entry) {
	const bubble = bubbleOfEntry(entry)
	if (!bubble) return
	bubble.replaceWith(renderEntryBubble(entry, { isLast: true }))
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
		void renderMarkdownAsStandaloneDocument(messageMarkdown(entryShowText(entry), entry.role)).then(html => {
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
export function renderEntryBubble(entry, { isLast = false } = {}) {
	const bubble = document.createElement('div')
	bubble.className = `code-message role-${entry.role}`
	bubble.dataset.entryId = entry.id
	bubble.setAttribute(entry.role === 'user' || entry.role === 'char' ? 'user-content' : 'prompt-content', '')
	if (entry.role === 'char' && entry.name) {
		const name = document.createElement('div')
		name.className = 'code-message-name'
		name.textContent = entry.name
		bubble.appendChild(name)
	}
	const body = document.createElement('div')
	body.className = 'code-message-body'
	bubble.appendChild(body)
	if (entry.role === 'tool' && entry.extension?.subAgent?.runId)
		body.appendChild(subAgentCardElement(entry))

	else if (entry.role === 'tool' && entry.extension?.asyncTask?.id)
		body.appendChild(asyncTaskCardElement(entry))

	else if (entry.role === 'tool' || entry.role === 'system') {
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
		content.className = 'mt-1 markdown-body'
		details.append(summary, content)
		body.appendChild(details)
		if (entry.extension?.shellStream) {
			// `!` 流式执行中：命令 + 纯文本输出（逐块更新，避免每片重渲 markdown）
			const stream = entry.extension.shellStream
			const command = document.createElement('pre')
			command.className = 'code-shell-stream-command'
			command.textContent = stream.shell ? `$ ${stream.command}` : stream.command
			const output = document.createElement('pre')
			output.className = 'code-shell-stream-output'
			output.textContent = stream.output || ''
			content.append(command, output)
		}
		else if (entry.extension?.asyncList)
			content.appendChild(renderAsyncList(entry))
		else if (entry.extension?.asyncAwait)
			content.appendChild(renderAsyncAwait(entry))
		else if (entry.extension?.asyncInspect)
			content.appendChild(renderAsyncInspect(entry))
		else
			renderMarkdownAsString(messageMarkdown(entryShowText(entry), entry.role), store.markdownCache).then(html => {
				content.innerHTML = html
			})
	}
	else {
		const content = document.createElement('div')
		content.className = 'markdown-body'
		body.appendChild(content)
		renderMarkdownAsString(messageMarkdown(entryShowText(entry), entry.role), store.markdownCache).then(html => {
			content.innerHTML = html
		})
	}

	for (const file of entry.files || []) {
		const chip = document.createElement('div')
		chip.className = 'code-message-file-chip flex items-center gap-1 text-xs opacity-70'
		const name = document.createElement('span')
		name.setAttribute('user-content', '')
		name.textContent = file.name
		chip.append(iconElement(icons.attach, { size: 14 }), name)
		void svgInliner(chip)
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
 * 贴底状态：只由用户滚动改变（向上滚 → 脱离；滚回底部附近 → 重新贴底），
 * 内容增长不会改变它，从而流式期间始终跟随；不依据「当前是否在底部附近」临时判断——
 * 那在平滑滚动中途 / 大段增量后会误判脱离，导致不跟随与浮标闪烁。
 */
let pinned = true
/** 最近一次用户滚动意图（滚轮上滚 / 方向键 / 触摸 / 拖滚动条）的时间。 */
let lastUserScrollAt = -Infinity
/** 用户滚动意图宽限期（毫秒）：期间只在真正到底时才重新贴底。 */
const USER_SCROLL_GRACE_MS = 400
/** 最近一次用户在消息流内展开 / 点击的时间：此后短时间内上方气泡的尺寸变化不拉到底。 */
let lastUserToggleAt = -Infinity
/** 用户展开宽限期（毫秒）。 */
const USER_TOGGLE_GRACE_MS = 1000

/**
 * 消息流当前是否贴底跟随。
 * @returns {boolean} 是否贴底。
 */
export function isPinnedToBottom() {
	return pinned
}

/** 无动画地对齐到底部（贴底跟随用）。 */
function alignBottom() {
	const el = elements.messages
	el.scrollTop = el.scrollHeight - el.clientHeight
}

/**
 * 滚动消息流到底部并恢复贴底跟随。
 * @param {{smooth?: boolean}} [options] - 是否平滑滚动（仅用户点击「回到底部」时）。
 * @returns {void}
 */
export function scrollMessagesBottom({ smooth = false } = {}) {
	pinned = true
	const el = elements.messages
	if (smooth) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
	else alignBottom()
	updateBackToBottom()
}

/** 回到底部浮标（sticky 于消息流末尾，贴底时隐藏）。 */
export const backToBottom = (() => {
	const button = document.createElement('button')
	button.type = 'button'
	button.id = 'code-back-to-bottom'
	button.className = 'btn btn-square btn-ghost btn-sm shadow-lg code-back-to-bottom'
	button.appendChild(iconElement(icons.chevronDown, { size: 16 }))
	void svgInliner(button)
	button.addEventListener('click', () => scrollMessagesBottom({ smooth: true }))
	return button
})()

/** 更新回到底部浮标可见性。 */
export function updateBackToBottom() {
	backToBottom.classList.toggle('show', !pinned && (store.session?.entries?.length || 0) > 0)
}

/** 消息流滚动后给顶栏加投影（提示上方仍有内容）。 */
function updateScrollShadow() {
	elements.topbar?.classList.toggle('scrolled', elements.messages.scrollTop > 2)
}

elements.messages.addEventListener('scroll', () => {
	const el = elements.messages
	const gap = el.scrollHeight - el.scrollTop - el.clientHeight
	// 只在滚到底部附近时重新贴底；脱离只由用户滚动意图触发（见下方输入监听）——
	// 显隐切换 / 内容重建导致的 scrollTop 钳位或归零不是用户意图，不能据此脱离
	const userScrolling = performance.now() - lastUserScrollAt < USER_SCROLL_GRACE_MS
	if (gap < (userScrolling ? 8 : SCROLL_TOLERANCE)) pinned = true
	updateBackToBottom()
	updateScrollShadow()
}, { passive: true })

/**
 * 用户滚动意图：立即脱离贴底（先于 scroll 事件生效，否则流式每帧的对齐会把滚动拽回去）。
 * @returns {void}
 */
function releasePin() {
	pinned = false
	lastUserScrollAt = performance.now()
	updateBackToBottom()
}
elements.messages.addEventListener('wheel', event => {
	if (event.deltaY < 0) releasePin()
}, { passive: true })
elements.messages.addEventListener('keydown', event => {
	if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) releasePin()
})
elements.messages.addEventListener('touchmove', releasePin, { passive: true })
elements.messages.addEventListener('pointerdown', event => {
	// 直接按在消息流自身上 = 拖滚动条
	if (event.target === elements.messages) releasePin()
})
elements.messages.addEventListener('toggle', () => { lastUserToggleAt = performance.now() }, { capture: true })
elements.messages.addEventListener('click', () => { lastUserToggleAt = performance.now() }, { capture: true })

/**
 * 贴底跟随：贴底状态下，消息流内任何内容变化（流式增量、markdown 异步落定、工具输出）
 * 或消息流自身尺寸变化（composer 伸缩挤压）都在绘制前重新对齐到底部，不会先画出错位的一帧。
 * 用 MutationObserver 而非只靠 ResizeObserver：气泡增高发生在 JS 里，MO 微任务先于绘制执行，
 * RO 要等下一帧，快速流式时会稳定落后一帧。用户刚展开上方气泡时不拉走视线。
 */
function followIfPinned() {
	if (!pinned) return
	if (performance.now() - lastUserToggleAt < USER_TOGGLE_GRACE_MS) return
	alignBottom()
	if (store.generating) ensureFollowLoop()
}

/** 生成期间的逐帧贴底循环句柄。 */
let followFrame = 0
/**
 * 生成期间每帧对齐一次：MutationObserver 在微任务里对齐，但 markdown 异步落定 / 字体换行可能让
 * scrollHeight 在绘制前再次变化，逐帧兜底保证画面始终停在底部。
 * @returns {void}
 */
function followTick() {
	followFrame = 0
	if (pinned && store.generating) {
		alignBottom()
		ensureFollowLoop()
	}
}
/**
 * 确保生成期间的逐帧贴底循环在跑。
 * @returns {void}
 */
function ensureFollowLoop() {
	followFrame ||= requestAnimationFrame(followTick)
}
const followObserver = new ResizeObserver(followIfPinned)
followObserver.observe(elements.messages)
new MutationObserver(followIfPinned).observe(elements.messages, {
	childList: true,
	subtree: true,
	characterData: true,
})

/**
 * 空态布局开关：无条目且未在生成时 composer 垂直居中 + wordmark。
 * 生成中（entries 仍为空）不算空态——消息流必须保持可见，流式气泡才有容器。
 */
export function updateEmptyMode() {
	const empty = !(store.session?.entries?.length || 0)
		&& !(store.generating && store.generatingSession === store.session)
	elements.main?.classList.toggle('empty-mode', empty)
}

/** 渲染全部消息。 */
export function renderMessages() {
	updateEmptyMode()
	const entries = (store.session?.entries || []).filter(isEntryVisible)
	if (!entries.length) {
		elements.messages.replaceChildren(backToBottom)
		updateBackToBottom()
		updateScrollShadow()
		return
	}
	elements.messages.replaceChildren(...entries.map((entry, index) => renderEntryBubble(entry, { isLast: index === entries.length - 1 })), backToBottom)
	scrollMessagesBottom()
	updateBackToBottom()
	updateScrollShadow()
	updateRegenButtons()
	updateRunCards()
}

/**
 * 追加消息气泡（无可见内容的条目直接跳过）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement|null} 气泡元素；跳过时为 null。
 */
export function appendEntryBubble(entry) {
	if (!isEntryVisible(entry)) return null
	const bubble = renderEntryBubble(entry, { isLast: true })
	elements.messages.insertBefore(bubble, backToBottom)
	updateEmptyMode()
	// 用户自己发出的消息总要看见：恢复贴底
	if (entry.role === 'user') scrollMessagesBottom()
	else updateBackToBottom()
	updateRegenButtons()
	updateRunCards()
	return bubble
}
