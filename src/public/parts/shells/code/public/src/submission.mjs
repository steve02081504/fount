/**
 * 统一提交入口：普通消息 / 斜杠命令 / `fount.user.send` / 外部提示词 / 重新生成 / 错误重试。
 * 快照发送目标后乐观回显，成功才清除本次草稿与附件，失败保留并可重试；仅附件发送亦合法。
 */
import { getGist } from '/parts/shells:gist/src/endpoints.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { arrayBufferToBase64 } from '/scripts/lib/base64.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import { readyAttachments } from './attachments.mjs'
import { abortGeneration, beginGeneration, retryRecovery, sendRunRequest } from './generation.mjs'
import { appendLocalHistory } from './history.mjs'
import { iconElement, icons } from './icons.mjs'
import { appendEntryBubble, renderMessages, updateRegenButtons } from './messages.mjs'
import { newSessionObject, syncActiveTabDraft } from './session.mjs'
import { execShellMode } from './shellExecution.mjs'
import { activeTab, elements, getActiveRuntime, getRuntime, isGenerating, richInput, store, tabKeyOf } from './store.mjs'

/** 消息中的 `@[gist:id]` token。 */
const GIST_TOKEN_RE = /@\[gist:([^\n\]]+)]/g

/**
 * 展开消息中的 gist token：拉取正文并构造附件（发送时随用户消息送给角色）。
 * @param {string} content - 消息原文。
 * @returns {Promise<Array<{name: string, mime_type: string, buffer: string, description: string}>>} 附件列表。
 */
async function resolveGistAttachments(content) {
	const ids = [...new Set([...content.matchAll(GIST_TOKEN_RE)].map(match => match[1]))]
	const files = []
	for (const id of ids) {
		const gist = await getGist(id).catch(() => null)
		if (!gist) continue
		const name = `${String(gist.title || gist.id).replace(/[\n\r]+/g, ' ').trim().slice(0, 80)}.md`
		files.push({
			name,
			mime_type: 'text/markdown',
			buffer: arrayBufferToBase64(new TextEncoder().encode(gist.markdown || '')),
			description: '',
		})
	}
	return files
}

/**
 * 通知附件队列已变更（附件模块监听后重渲染预览条）。
 * @param {string} tabKey - 标签键。
 * @returns {void}
 */
function dispatchAttachmentsChanged(tabKey) {
	window.dispatchEvent(new CustomEvent('code-attachments-changed', { detail: { tabKey } }))
}

/**
 * 更新发送按钮（仅反映活动标签页的运行状态：生成中/停止中 → 停止；恢复中 → 重连；否则发送）。
 * @returns {void}
 */
export function updateSendButton() {
	const runtime = getActiveRuntime()
	const status = runtime?.status
	const stop = status === 'generating' || status === 'stopping'
	const reconnect = status === 'recovering'
	elements.sendButton.classList.toggle('btn-error', stop)
	elements.sendButton.classList.toggle('btn-primary', !stop)
	// 图标按钮的 aria-label 走 data-i18n 对象键（停止/重连态换键），随语种自动重译
	setElementI18n(elements.sendButton, stop ? 'code.composer.stopButton' : reconnect ? 'code.generation.reconnect' : 'code.composer.sendButton')
	const icon = stop ? icons.stop : reconnect ? icons.regen : icons.send
	document.getElementById('send-icon')?.replaceWith(iconElement(icon, { size: 16, id: 'send-icon' }))
	void svgInliner(elements.sendButton)
	updateRegenButtons()
}

/**
 * 发送消息（统一入口）。
 * @param {{content?: string, kind?: 'message'|'shell'}} [options] - 发送选项。
 * @returns {Promise<{ok: boolean, reason?: string, runId?: string, sessionId?: string, entryId?: string, error?: unknown}>} 发送结果。
 */
export async function submitMessage({ content = '', kind = 'message' } = {}) {
	const tab = activeTab()
	const tabKey = tab ? tabKeyOf(tab) : store.activeTabKey
	const runtime = getRuntime(tabKey, { create: true })
	if (!runtime) return { ok: false, reason: 'no-tab' }
	if (runtime.status !== 'idle') return { ok: false, reason: 'busy' }
	const session = runtime.session || store.session || newSessionObject(tab?.id)
	if (!session) return { ok: false, reason: 'no-session' }
	const text = String(content ?? '')
	const pending = readyAttachments(tabKey)
	const files = pending.map(attachment => ({
		name: attachment.name,
		mime_type: attachment.mime_type,
		buffer: attachment.buffer,
		description: attachment.description || '',
	}))
	if (!text.trim() && !files.length) return { ok: false, reason: 'empty' }
	const charname = store.charname || session.charname
	if (kind === 'message' && !charname) {
		showToastI18n('error', 'code.error.noChar')
		return { ok: false, reason: 'no-char' }
	}
	// 第一次 await 之前快照目标与运行参数
	const aiSource = store.aiSource || ''
	const profile = store.profile
	const targetSnapshot = { machine: store.machine, workdir: store.workspace?.path || '' }
	const sentIds = new Set(pending.map(attachment => attachment.id))
	runtime.status = 'submitting'
	updateSendButton()
	let gistFiles = []
	try { gistFiles = await resolveGistAttachments(text) }
	catch { gistFiles = [] }
	const allFiles = [...files, ...gistFiles]
	session.charname = charname || session.charname
	session.profile = profile
	session.ai_source = aiSource
	// 乐观插入用户条目并立即回显；WS 带 clientEntryId，服务端据此去重
	const userEntry = {
		id: crypto.randomUUID().slice(0, 8),
		uid: 'user',
		role: 'user',
		name: store.username,
		content: text,
		time: new Date().toISOString(),
	}
	if (allFiles.length) userEntry.files = allFiles.map(file => ({ ...file }))
	session.entries.push(userEntry)
	if (runtime === getActiveRuntime()) appendEntryBubble(userEntry)
	appendLocalHistory(kind === 'shell' ? 'shell' : 'message', text)
	const runId = beginGeneration(runtime, crypto.randomUUID())
	try {
		await sendRunRequest(runtime, {
			type: 'send',
			runId,
			...targetSnapshot,
			ai_source: aiSource,
			profile,
			content: text,
			files: allFiles,
			clientEntryId: userEntry.id,
		})
	}
	catch (error) {
		// 请求未送达：回滚乐观条目与运行态，保留本次草稿与附件
		const index = session.entries.findIndex(item => item.id === userEntry.id)
		if (index >= 0) session.entries.splice(index, 1)
		runtime.status = 'idle'
		runtime.runId = null
		updateSendButton()
		if (runtime === getActiveRuntime()) renderMessages()
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
		return { ok: false, reason: 'send-failed', error }
	}
	// 送出成功后才清除本次发送的草稿与附件；其后新输入保留
	if (richInput && richInput.value === text) {
		richInput.value = ''
		syncActiveTabDraft()
	}
	runtime.attachments = (runtime.attachments || []).filter(attachment => !sentIds.has(attachment.id))
	dispatchAttachmentsChanged(tabKey)
	return { ok: true, runId, sessionId: session.id, entryId: userEntry.id }
}

/**
 * 重新生成最后一条角色消息（弹出后走 WS regen，流式预览复用生成中气泡）。
 * @returns {Promise<void>} 完成。
 */
export async function regenerateLastReply() {
	const runtime = getActiveRuntime()
	if (!runtime || runtime.status !== 'idle') return
	const session = runtime.session
	if (!session) return
	const last = session.entries.at(-1)
	if (last?.role !== 'char') return
	if (!session.charname && !store.charname) {
		showToastI18n('error', 'code.error.noChar')
		return
	}
	const aiSource = store.aiSource || ''
	const profile = store.profile
	const targetSnapshot = { machine: store.machine, workdir: store.workspace?.path || '' }
	runtime.status = 'submitting'
	updateSendButton()
	session.entries.pop()
	renderMessages()
	const runId = beginGeneration(runtime)
	try {
		await sendRunRequest(runtime, { type: 'regen', runId, ...targetSnapshot, ai_source: aiSource, profile })
	}
	catch (error) {
		// 请求未送达服务端，旧回复原样放回
		session.entries.push(last)
		runtime.status = 'idle'
		runtime.runId = null
		updateSendButton()
		renderMessages()
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 从角色抛错的气泡重试该轮：丢弃错误条目及其后的所有条目（含半截输出）后重新生成。
 * @param {object} entry - 角色抛错时追加的错误条目。
 * @returns {Promise<void>} 完成。
 */
export async function retryFromError(entry) {
	const runtime = getActiveRuntime()
	if (!runtime || runtime.status !== 'idle') return
	const session = runtime.session
	if (!session) return
	const index = session.entries.findIndex(candidate => candidate.id === entry.id)
	if (index < 0) return
	if (!session.charname && !store.charname) {
		showToastI18n('error', 'code.error.noChar')
		return
	}
	const aiSource = store.aiSource || ''
	const profile = store.profile
	const targetSnapshot = { machine: store.machine, workdir: store.workspace?.path || '' }
	runtime.status = 'submitting'
	updateSendButton()
	session.entries.splice(index)
	renderMessages()
	const runId = beginGeneration(runtime)
	try {
		await sendRunRequest(runtime, { type: 'trigger', runId, ...targetSnapshot, ai_source: aiSource, profile })
	}
	catch (error) {
		runtime.status = 'idle'
		runtime.runId = null
		updateSendButton()
		renderMessages()
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 处理发送/停止/重连按钮点击（活动标签页语义）。
 * @returns {void}
 */
export function onSendButtonClick() {
	const runtime = getActiveRuntime()
	if (!runtime) return
	if (isGenerating(runtime.tabKey)) {
		abortGeneration(runtime.tabKey)
		return
	}
	if (runtime.status === 'recovering') {
		retryRecovery(runtime.tabKey)
		return
	}
	if (runtime.status !== 'idle') return
	const value = richInput.value.trim()
	if (!value && !(runtime.attachments || []).length) return
	if (store.shellMode) {
		const command = richInput.value
		void execShellMode(value).catch(error => showToastI18n('error', 'code.error.generic', { error: String(error.message || error) }))
		// 命令已派发：清空本次输入，保留 shell 模式以便连续执行；其后新输入保留
		if (richInput.value === command) {
			richInput.value = ''
			syncActiveTabDraft()
		}
		return
	}
	void submitMessage({ content: value })
}
