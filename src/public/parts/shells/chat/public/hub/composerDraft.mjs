/**
 * 【文件】public/hub/composerDraft.mjs
 * 【职责】频道草稿的防抖写入、切频道恢复与发送后清空；附件按频道暂存在内存。
 */
import { setComposerExtrasVisible } from './composerExtras.mjs'

const DRAFT_DEBOUNCE_MS = 500

/** @type {ReturnType<typeof setTimeout> | null} */
let draftTimer = null

/** @type {Map<string, object[]>} `${groupId}:${channelId}` → 附件快照 */
const draftFilesByChannel = new Map()

/**
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {string} localStorage 草稿键名
 */
function draftKey(groupId, channelId) {
	return `fount.chat.draft:${groupId}:${channelId}`
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {string} 内存附件键
 */
function filesKey(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * 切走频道前把当前附件写入内存草稿。
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @param {object[]} files 附件
 * @returns {void}
 */
export function stashDraftFiles(groupId, channelId, files) {
	if (!groupId || !channelId) return
	const key = filesKey(groupId, channelId)
	if (!files?.length) {
		draftFilesByChannel.delete(key)
		return
	}
	draftFilesByChannel.set(key, files.map(file => ({ ...file })))
}

/**
 * @param {string} groupId 群
 * @param {string} channelId 频道
 * @returns {object[]} 附件快照（浅拷贝数组与文件对象）
 */
export function peekDraftFiles(groupId, channelId) {
	if (!groupId || !channelId) return []
	const files = draftFilesByChannel.get(filesKey(groupId, channelId))
	return files?.map(file => ({ ...file })) ?? []
}

/**
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text: string, content_warning?: string, sensitive_media?: boolean }} draft 草稿内容
 * @returns {void}
 */
function writeDraftPayload(groupId, channelId, draft) {
	try {
		const payload = { text: draft.text || '' }
		if (draft.content_warning) payload.content_warning = draft.content_warning
		if (draft.sensitive_media) payload.sensitive_media = true
		if (!payload.text && !payload.content_warning && !payload.sensitive_media)
			localStorage.removeItem(draftKey(groupId, channelId))
		else
			localStorage.setItem(draftKey(groupId, channelId), JSON.stringify(payload))
	}
	catch { /* localStorage 满了静默忽略 */ }
}

/**
 * 立即写入草稿（切频道前调用）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text: string, content_warning?: string, sensitive_media?: boolean }} draft 草稿内容
 * @returns {void}
 */
export function flushDraft(groupId, channelId, draft) {
	if (!groupId || !channelId) return
	if (draftTimer) {
		clearTimeout(draftTimer)
		draftTimer = null
	}
	writeDraftPayload(groupId, channelId, draft)
}

/**
 * 保存草稿（防抖）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text: string, content_warning?: string, sensitive_media?: boolean }} draft 草稿内容
 * @returns {void}
 */
export function saveDraft(groupId, channelId, draft) {
	if (!groupId || !channelId) return
	if (draftTimer) clearTimeout(draftTimer)
	draftTimer = setTimeout(() => {
		draftTimer = null
		writeDraftPayload(groupId, channelId, draft)
	}, DRAFT_DEBOUNCE_MS)
}

/**
 * 将 localStorage 草稿应用到 composer DOM。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function applyDraft(groupId, channelId) {
	if (!groupId || !channelId) return
	const input = document.getElementById('message-input')
	if (input instanceof HTMLTextAreaElement) {
		input.value = ''
		input.style.height = 'auto'
	}
	const contentWarningInput = document.getElementById('content-warning')
	if (contentWarningInput instanceof HTMLInputElement) contentWarningInput.value = ''
	const sensitiveMediaInput = document.getElementById('sensitive-media')
	if (sensitiveMediaInput instanceof HTMLInputElement) sensitiveMediaInput.checked = false
	setComposerExtrasVisible(false)

	try {
		const raw = localStorage.getItem(draftKey(groupId, channelId))
		if (!raw) return
		const draft = JSON.parse(raw)
		if (input instanceof HTMLTextAreaElement && draft.text) {
			input.value = draft.text
			input.dispatchEvent(new Event('input', { bubbles: true }))
		}
		if (contentWarningInput instanceof HTMLInputElement && draft.content_warning)
			contentWarningInput.value = draft.content_warning
		if (sensitiveMediaInput instanceof HTMLInputElement && draft.sensitive_media)
			sensitiveMediaInput.checked = true
		if (draft.content_warning || draft.sensitive_media)
			setComposerExtrasVisible(true)
	}
	catch { /* JSON 解析失败忽略 */ }
}

/**
 * 恢复该频道内存附件到 composer 预览区。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function restoreDraftFiles(groupId, channelId) {
	if (!groupId || !channelId) return
	const { clearSelectedFiles, selectedFiles } = await import('./composerFiles.mjs')
	clearSelectedFiles()

	const files = peekDraftFiles(groupId, channelId)
	const preview = document.getElementById('attachment-preview')
	if (!files.length || !(preview instanceof HTMLElement)) return
	const { renderAttachmentPreview } = await import('../src/composerAttachments.mjs')
	for (const file of files) {
		selectedFiles.push(file)
		const el = await renderAttachmentPreview(
			file,
			selectedFiles.length - 1,
			selectedFiles,
			{
				groupId,
				onFilesChange: setComposerExtrasVisible,
			},
		)
		if (el) preview.appendChild(el)
	}
	setComposerExtrasVisible(selectedFiles.length)
}

/**
 * 加载草稿到 DOM 控件，并恢复该频道内存附件。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function loadDraft(groupId, channelId) {
	applyDraft(groupId, channelId)
	await restoreDraftFiles(groupId, channelId)
}

/**
 * 清除草稿（发送成功后调用）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function clearDraft(groupId, channelId) {
	if (!groupId || !channelId) return
	if (draftTimer) {
		clearTimeout(draftTimer)
		draftTimer = null
	}
	draftFilesByChannel.delete(filesKey(groupId, channelId))
	try {
		localStorage.removeItem(draftKey(groupId, channelId))
	}
	catch { /* empty */ }
}

/**
 * 在 composer 输入、CW、sensitive 变化时接线草稿自动保存。
 * @param {() => { groupId: string | null, channelId: string | null }} getCtx 获取当前频道上下文
 * @returns {void}
 */
export function wireDraftAutoSave(getCtx) {
	/**
	 * @returns {{ text: string, content_warning: string, sensitive_media: boolean }} 草稿字段快照
	 */
	const readFields = () => {
		const input = document.getElementById('message-input')
		const contentWarningInput = document.getElementById('content-warning')
		const sensitiveMediaInput = document.getElementById('sensitive-media')
		return {
			text: input instanceof HTMLTextAreaElement ? input.value : '',
			content_warning: contentWarningInput instanceof HTMLInputElement ? contentWarningInput.value.trim() : '',
			sensitive_media: sensitiveMediaInput instanceof HTMLInputElement ? sensitiveMediaInput.checked : false,
		}
	}

	/**
	 * @returns {void}
	 */
	const onDraftChange = () => {
		const { groupId, channelId } = getCtx()
		if (groupId && channelId) saveDraft(groupId, channelId, readFields())
	}

	document.getElementById('message-input')?.addEventListener('input', onDraftChange)
	document.getElementById('content-warning')?.addEventListener('input', onDraftChange)
	document.getElementById('sensitive-media')?.addEventListener('change', onDraftChange)
}
