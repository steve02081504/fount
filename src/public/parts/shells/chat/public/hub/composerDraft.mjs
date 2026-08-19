/**
 * 【文件】public/hub/composerDraft.mjs
 * 【职责】频道草稿的防抖写入、切频道恢复与发送后清空；草稿（文本 + 内容警告 + 附件）按频道持久化到 IndexedDB。
 * 【原理】切换频道前 flushDraft 落盘，进入频道时 loadDraft 恢复；发送成功后 clearDraft 删除。
 */
import { setComposerExtrasVisible } from './composerExtras.mjs'

const DRAFT_DEBOUNCE_MS = 500
const DB_NAME = 'fount.chat.drafts'
const STORE_NAME = 'drafts'
const DB_VERSION = 1

/** @type {ReturnType<typeof setTimeout> | null} */
let draftTimer = null

/** @type {Promise<IDBDatabase> | null} */
let dbOpenPromise = null

/** @type {Promise<void>} 串行化写入，避免并发 put/delete 乱序 */
let writeChain = Promise.resolve()

/**
 * @returns {Promise<IDBDatabase>} IndexedDB 句柄
 */
function openDb() {
	dbOpenPromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.addEventListener('upgradeneeded', () => {
			const db = request.result
			if (!db.objectStoreNames.contains(STORE_NAME))
				db.createObjectStore(STORE_NAME, { keyPath: 'key' })
		})
		request.addEventListener('success', () => {
			const db = request.result
			db.addEventListener('versionchange', () => {
				db.close()
				dbOpenPromise = null
			})
			resolve(db)
		})
		request.addEventListener('error', () => {
			dbOpenPromise = null
			reject(request.error)
		})
	})
	return dbOpenPromise
}

/**
 * @template T
 * @param {(objectStore: IDBObjectStore) => IDBRequest} run 事务操作
 * @param {IDBTransactionMode} [mode='readonly'] 模式
 * @returns {Promise<T>} 请求结果
 */
async function withStore(run, mode = 'readonly') {
	const db = await openDb()
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(STORE_NAME, mode)
		const objectStore = transaction.objectStore(STORE_NAME)
		const request = run(objectStore)
		request.addEventListener('success', () => resolve(request.result))
		request.addEventListener('error', () => reject(request.error))
	})
}

/**
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {string} IndexedDB 草稿键名
 */
function draftKey(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * 深拷贝附件为可序列化快照（buffer 为 base64 字符串）。
 * @param {object[]} [files] 附件
 * @returns {object[]} 附件快照
 */
function snapshotFiles(files) {
	return (files || []).map(file => ({
		name: file.name,
		mime_type: file.mime_type,
		...file.size != null ? { size: file.size } : {},
		...file.buffer != null ? { buffer: file.buffer } : {},
		...file.description ? { description: file.description } : {},
	}))
}

/**
 * 将草稿写入 IndexedDB；全部为空时删除记录。写入串行化且吞掉 IndexedDB 错误。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {{ text?: string, content_warning?: string, sensitive_media?: boolean, files?: object[] }} draft 草稿内容
 * @returns {Promise<void>} 完成（成功或静默失败）
 */
function writeDraftPayload(groupId, channelId, draft) {
	const key = draftKey(groupId, channelId)
	const record = {
		key,
		text: draft.text || '',
		...draft.content_warning ? { content_warning: draft.content_warning } : {},
		...draft.sensitive_media ? { sensitive_media: true } : {},
		files: snapshotFiles(draft.files),
	}
	const isEmpty = !record.text && !record.content_warning && !record.sensitive_media && !record.files.length
	const op = isEmpty
		? withStore(objectStore => objectStore.delete(key), 'readwrite')
		: withStore(objectStore => objectStore.put(record), 'readwrite')
	writeChain = writeChain.then(() => op.catch(() => { /* IndexedDB 不可用时静默 */ }))
	return writeChain
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
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ text: string, content_warning?: string, sensitive_media?: boolean, files: object[] } | null>} 草稿记录
 */
async function readDraft(groupId, channelId) {
	await writeChain
	try {
		return await withStore(objectStore => objectStore.get(draftKey(groupId, channelId)))
	}
	catch {
		return null
	}
}

/**
 * 恢复草稿附件到 composer 预览区与 selectedFiles。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {object[]} files 附件快照
 * @returns {Promise<void>}
 */
async function restoreDraftFiles(groupId, channelId, files) {
	const { clearSelectedFiles, selectedFiles } = await import('./composerFiles.mjs')
	clearSelectedFiles()
	if (!files?.length) return
	const preview = document.getElementById('attachment-preview')
	if (!(preview instanceof HTMLElement)) return
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
 * 加载草稿到 DOM 控件，并恢复该频道附件。
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

	const draft = await readDraft(groupId, channelId)
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
	await restoreDraftFiles(groupId, channelId, draft?.files || [])
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
	void writeDraftPayload(groupId, channelId, {})
}

/**
 * 在 composer 输入、CW、sensitive 变化时接线草稿自动保存（含附件快照）。
 * @param {() => { groupId: string | null, channelId: string | null }} getCtx 获取当前频道上下文
 * @returns {void}
 */
export function wireDraftAutoSave(getCtx) {
	let selectedFilesRef = null
	void import('./composerFiles.mjs').then(m => { selectedFilesRef = m.selectedFiles })

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
			files: selectedFilesRef ? selectedFilesRef.map(file => ({ ...file })) : [],
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
