/**
 * 【文件】public/hub/composerDraft.mjs
 * 【职责】频道草稿的防抖写入、切频道恢复与发送后清空；草稿（文本 + 内容警告 + 附件）按频道持久化到后端 chat shell 用户数据层。
 * 【原理】切换频道前 flushDraft 落盘，进入频道时 loadDraft 恢复；附件仅回传缩略图，点击时才懒拉取完整内容。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'

import {
	deleteDraft,
	draftKey,
	getDraft,
	saveDraft as saveDraftRemote,
} from '../src/endpoints/drafts.mjs'

import { setComposerExtrasVisible } from './composerExtras.mjs'
import { selectedFiles } from './composerFiles.mjs'

const DRAFT_DEBOUNCE_MS = 500

/** @type {Map<string, ReturnType<typeof setTimeout>>} 每个草稿键独立的防抖计时器 */
const draftTimers = new Map()

/** @type {Map<string, Promise<void>>} 每个草稿键的写/删操作队列尾部，串行化同键操作 */
const draftOpQueues = new Map()

/**
 * 取消防抖计时器（仅当前草稿键）。
 * @param {string} key 草稿键
 * @returns {void}
 */
function cancelDraftTimer(key) {
	const timer = draftTimers.get(key)
	if (timer) clearTimeout(timer)
	draftTimers.delete(key)
}

/**
 * 将操作按草稿键串行排队，保证同键写入/删除顺序执行（不同键互不影响）。
 * 前一个操作失败不会阻塞后续操作；返回的 promise 承载本次操作结果。
 * @param {string} key 草稿键
 * @param {() => Promise<void>} operation 操作
 * @returns {Promise<void>} 本次操作完成（或失败）
 */
function enqueueDraftOp(key, operation) {
	const prev = draftOpQueues.get(key) ?? Promise.resolve()
	const next = prev.catch(() => { }).then(operation)
	draftOpQueues.set(key, next)
	next.catch(() => { }).finally(() => {
		if (draftOpQueues.get(key) === next) draftOpQueues.delete(key)
	})
	return next
}

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
 * 将草稿写入后端（全部为空时删除）。远端失败向上抛出，由调用方经聊天错误路径报告。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text?: string, content_warning?: string, sensitive_media?: boolean, files?: object[] }} draft 草稿内容
 * @returns {Promise<void>} 完成（远端失败则 reject）
 */
async function writeDraftPayload(groupId, channelId, draft) {
	const key = draftKey(groupId, channelId)
	const files = await snapshotFiles(draft.files)
	const isEmpty = !(draft.text || '') && !files.length
	if (isEmpty) await deleteDraft(key)
	else
		await saveDraftRemote(key, {
			text: draft.text || '',
			...draft.content_warning ? { content_warning: draft.content_warning } : {},
			...draft.sensitive_media ? { sensitive_media: true } : {},
			files,
		})
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
	const key = draftKey(groupId, channelId)
	cancelDraftTimer(key)
	return enqueueDraftOp(key, () => writeDraftPayload(groupId, channelId, draft))
		.catch(handleError('chat.hub.operationFailed'))
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
	const key = draftKey(groupId, channelId)
	cancelDraftTimer(key)
	draftTimers.set(key, setTimeout(() => {
		draftTimers.delete(key)
		void enqueueDraftOp(key, () => writeDraftPayload(groupId, channelId, draft))
			.catch(handleError('chat.hub.operationFailed'))
	}, DRAFT_DEBOUNCE_MS))
}

/**
 * 恢复草稿附件到 composer 预览区与 selectedFiles（仅缩略图，点击时懒拉取内容）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} files 附件快照
 * @param {string} key 频道草稿键
 * @param {(() => boolean) | undefined} [isCurrent] 本次频道选择的有效性守卫；为假则立即停止副作用
 * @returns {Promise<void>}
 */
async function restoreDraftFiles(groupId, channelId, files, key, isCurrent) {
	const { clearSelectedFiles, selectedFiles } = await import('./composerFiles.mjs')
	clearSelectedFiles()
	if (!files?.length) return
	if (isCurrent && !isCurrent()) return
	const preview = document.getElementById('attachment-preview')
	if (!(preview instanceof HTMLElement)) return
	const { renderAttachmentPreview } = await import('../src/composerAttachments.mjs')
	for (const file of files) {
		if (isCurrent && !isCurrent()) return
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
 * @param {(() => boolean) | undefined} [isCurrent] 本次频道选择的有效性守卫；为假则立即停止副作用
 * @returns {Promise<void>}
 */
export async function loadDraft(groupId, channelId, isCurrent) {
	if (!groupId || !channelId) return
	const input = document.getElementById('message-input')
	const contentWarningInput = document.getElementById('content-warning')
	const sensitiveMediaInput = document.getElementById('sensitive-media')
	const key = draftKey(groupId, channelId)

	let draft
	try {
		draft = await getDraft(key)
	}
	catch (error) {
		// 网络或 5xx 失败：保留现有输入与附件，向用户报告，不当作无草稿处理。
		handleError('chat.hub.operationFailed')(error)
		return
	}

	// 服务端返回前用户可能已切走频道，失效则不再触碰 composer/DOM。
	if (isCurrent && !isCurrent()) return

	// 仅在服务端确认（返回记录或无记录）后重置控件；失败路径已提前返回。
	if (input instanceof HTMLTextAreaElement) {
		input.value = ''
		input.style.height = 'auto'
	}
	if (contentWarningInput instanceof HTMLInputElement) contentWarningInput.value = ''
	if (sensitiveMediaInput instanceof HTMLInputElement) sensitiveMediaInput.checked = false
	setComposerExtrasVisible(false)

	if (!draft) {
		await restoreDraftFiles(groupId, channelId, [], key, isCurrent)
		return
	}

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
	await restoreDraftFiles(groupId, channelId, draft.files || [], key, isCurrent)
}

/**
 * 清除草稿（发送成功后调用）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {void}
 */
export function clearDraft(groupId, channelId) {
	if (!groupId || !channelId) return
	const key = draftKey(groupId, channelId)
	cancelDraftTimer(key)
	void enqueueDraftOp(key, () => deleteDraft(key))
		.catch(handleError('chat.hub.operationFailed'))
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
			files: [...selectedFiles].map(file => ({ ...file, fileId: file.fileId || crypto.randomUUID() })),
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
