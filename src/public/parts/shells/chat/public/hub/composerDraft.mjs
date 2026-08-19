/**
 * 【文件】public/hub/composerDraft.mjs
 * 【职责】频道草稿的防抖写入、切频道恢复与发送后清空；草稿（文本 + 内容警告 + 附件）按频道持久化到后端 chat shell 用户数据层。
 * 【原理】切换频道前 flushDraft 落盘，进入频道时 loadDraft 恢复；附件仅回传缩略图，点击时才懒拉取完整内容。
 */
import {
	deleteDraft,
	draftKey,
	getDraft,
	saveDraft as saveDraftRemote,
} from '../src/endpoints/drafts.mjs'

import { setComposerExtrasVisible } from './composerExtras.mjs'
import { selectedFiles } from './composerFiles.mjs'

const DRAFT_DEBOUNCE_MS = 500

/** @type {ReturnType<typeof setTimeout> | null} */
let draftTimer = null

/**
 * 为图片附件生成小尺寸 base64 缩略图（无缩略图且持有完整 buffer 时才生成）。
 * @param {object} file 附件对象
 * @returns {Promise<string | null>} 缩略图 dataURL 或 null
 */
async function makeThumbnail(file) {
	if (file.thumbnail) return file.thumbnail
	if (typeof file.buffer !== 'string' || !file.buffer) return null
	if (!(file.mime_type || '').startsWith('image/')) return null
	try {
		const img = new Image()
		img.src = `data:${file.mime_type};base64,${file.buffer.replace(/^data:[^;]+;base64,/, '')}`
		await img.decode()
		const MAX = 128
		const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
		const canvas = document.createElement('canvas')
		canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
		canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
		canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
		return canvas.toDataURL('image/jpeg', 0.7)
	}
	catch { return null }
}

/**
 * 构造可落盘的附件快照：保留完整 buffer 与缩略图，但 fileId 幂等。
 * @param {object[]} files 附件
 * @returns {Promise<object[]>} 附件快照
 */
async function snapshotFiles(files) {
	const snapshot = []
	for (const file of files || []) {
		if (!file.thumbnail && file.buffer) file.thumbnail = await makeThumbnail(file)
		file.fileId = file.fileId || crypto.randomUUID()
		snapshot.push({
			fileId: file.fileId,
			name: file.name,
			mime_type: file.mime_type,
			size: file.size,
			...file.description ? { description: file.description } : {},
			...file.buffer ? { buffer: file.buffer } : {},
			...file.thumbnail ? { thumbnail: file.thumbnail } : {},
		})
	}
	return snapshot
}

/**
 * 将草稿写入后端（全部为空时删除）。吞掉后端错误。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text?: string, content_warning?: string, sensitive_media?: boolean, files?: object[] }} draft 草稿内容
 * @returns {Promise<void>} 完成（成功或静默失败）
 */
async function writeDraftPayload(groupId, channelId, draft) {
	try {
		const key = draftKey(groupId, channelId)
		const files = await snapshotFiles(draft.files)
		const isEmpty = !(draft.text || '') && !draft.content_warning && !draft.sensitive_media && !files.length
		if (isEmpty) await deleteDraft(key)
		else 
			await saveDraftRemote(key, {
				text: draft.text || '',
				...draft.content_warning ? { content_warning: draft.content_warning } : {},
				...draft.sensitive_media ? { sensitive_media: true } : {},
				files,
			})
		
	}
	catch { /* 后端不可用时静默 */ }
}

/**
 * 立即写入草稿（切频道前调用）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text?: string, content_warning?: string, sensitive_media?: boolean, files?: object[] }} draft 草稿内容
 * @returns {Promise<void>} 落盘完成
 */
export function flushDraft(groupId, channelId, draft) {
	if (!groupId || !channelId) return Promise.resolve()
	if (draftTimer) {
		clearTimeout(draftTimer)
		draftTimer = null
	}
	return writeDraftPayload(groupId, channelId, draft)
}

/**
 * 保存草稿（防抖）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text?: string, content_warning?: string, sensitive_media?: boolean, files?: object[] }} draft 草稿内容
 * @returns {void}
 */
export function saveDraft(groupId, channelId, draft) {
	if (!groupId || !channelId) return
	if (draftTimer) clearTimeout(draftTimer)
	draftTimer = setTimeout(() => {
		draftTimer = null
		void writeDraftPayload(groupId, channelId, draft)
	}, DRAFT_DEBOUNCE_MS)
}

/**
 * 恢复草稿附件到 composer 预览区与 selectedFiles（仅缩略图，点击时懒拉取内容）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} files 附件快照
 * @param {string} key 频道草稿键
 * @returns {Promise<void>}
 */
async function restoreDraftFiles(groupId, channelId, files, key) {
	const { clearSelectedFiles, selectedFiles } = await import('./composerFiles.mjs')
	clearSelectedFiles()
	if (!files?.length) return
	const preview = document.getElementById('attachment-preview')
	if (!(preview instanceof HTMLElement)) return
	const { renderAttachmentPreview } = await import('../src/composerAttachments.mjs')
	for (const file of files) {
		const restored = { ...file, draftKey: key }
		selectedFiles.push(restored)
		const el = await renderAttachmentPreview(
			restored,
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
 * 加载草稿到 DOM 控件，并恢复该频道附件（缩略图）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function loadDraft(groupId, channelId) {
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

	const key = draftKey(groupId, channelId)
	const draft = await getDraft(key).catch(() => null)
	if (draft) {
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
	await restoreDraftFiles(groupId, channelId, draft?.files || [], key)
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
	void deleteDraft(draftKey(groupId, channelId)).catch(() => { /* empty */ })
}

/**
 * 在 composer 输入、CW、sensitive 变化时接线草稿自动保存（含附件快照）。
 * @param {() => { groupId: string | null, channelId: string | null }} getCtx 获取当前频道上下文
 * @returns {void}
 */
export function wireDraftAutoSave(getCtx) {
	/**
	 * @returns {{ text: string, content_warning: string, sensitive_media: boolean, files: object[] }} 草稿字段快照
	 */
	const readFields = () => {
		const input = document.getElementById('message-input')
		const contentWarningInput = document.getElementById('content-warning')
		const sensitiveMediaInput = document.getElementById('sensitive-media')
		return {
			text: input instanceof HTMLTextAreaElement ? input.value : '',
			content_warning: contentWarningInput instanceof HTMLInputElement ? contentWarningInput.value.trim() : '',
			sensitive_media: sensitiveMediaInput instanceof HTMLInputElement ? sensitiveMediaInput.checked : false,
			files: selectedFiles,
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
