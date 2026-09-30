/**
 * 按标签页的附件队列：待发送卡片（缩略图 / 编辑 / 预览 / 说明）、已发送消息附件渲染与 Blob URL 管理。
 * 附件挂在 `runtime.attachments`，随标签页走，不进入会话 JSON，也不进标签页广播。
 */
import { openImageEditor } from '/scripts/components/imageEditor.mjs'
import { openMediaViewer } from '/scripts/components/mediaViewer.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { setElementI18n } from '/scripts/i18n/index.mjs'
import { blobToBase64 } from '/scripts/lib/base64.mjs'
import { formatBytes } from '/scripts/lib/formatBytes.mjs'
import { svgInliner } from '/scripts/lib/svgInliner.mjs'

import { iconElement, icons } from './icons.mjs'
import { ATTACHMENT_MAX_BYTES, elements, getActiveRuntime, getRuntime, store } from './store.mjs'

/** 附件队列总大小上限（单文件 10MB，整体随 WS JSON 内嵌 base64）。 */
export const ATTACHMENT_MAX_TOTAL_BYTES = 30 * 1024 * 1024

/* ---------------- Blob URL 管理 ---------------- */

/** 已创建的图片 Blob URL（键 → URL；按附件 id / 会话条目 id+下标去重）。 @type {Map<string, string>} */
const imageUrls = new Map()
/** 查看器打开期间延后回收的 URL（关闭后统一 revoke，避免打断正在展示的图片）。 @type {Set<string>} */
const deferredRevokes = new Set()
/** 查看器关闭观察器。 @type {MutationObserver|null} */
let viewerObserver = null

/**
 * 是否已有媒体查看器打开。
 * @returns {boolean} 是否打开。
 */
function isViewerOpen() {
	return !!document.querySelector('.media-viewer')
}

/** 在查看器关闭（DOM 移除）后统一回收延后的 URL。 */
function watchViewerClose() {
	if (viewerObserver) return
	viewerObserver = new MutationObserver(() => {
		if (isViewerOpen()) return
		viewerObserver.disconnect()
		viewerObserver = null
		for (const url of deferredRevokes) URL.revokeObjectURL(url)
		deferredRevokes.clear()
	})
	viewerObserver.observe(document.body, { childList: true })
}

/**
 * 回收一个 URL；查看器打开期间延后。
 * @param {string} url - Blob URL。
 * @returns {void}
 */
function revokeUrl(url) {
	if (!url) return
	if (isViewerOpen()) {
		deferredRevokes.add(url)
		watchViewerClose()
		return
	}
	URL.revokeObjectURL(url)
}

/**
 * 释放某键的 Blob URL。
 * @param {string} key - 键。
 * @returns {void}
 */
function releaseUrl(key) {
	const url = imageUrls.get(key)
	if (!url) return
	imageUrls.delete(key)
	revokeUrl(url)
}

/**
 * 回收所有已释放键的 URL（附件被移除 / 发送后清除 / 标签页关闭）。
 * @returns {void}
 */
function reconcileUrls() {
	const live = new Set()
	for (const runtime of store.runtimes.values()) {
		for (const attachment of runtime.attachments || []) live.add(`a:${attachment.id}`)
		for (const entry of runtime.session?.entries || [])
			for (let index = 0; index < (entry.files?.length || 0); index++) live.add(`m:${entry.id}:${index}`)
	}
	for (const key of [...imageUrls.keys()]) if (!live.has(key)) releaseUrl(key)
}

/* ---------------- 数据工具 ---------------- */

/**
 * base64 解码为 Blob。
 * @param {string} buffer - base64。
 * @param {string} mime - MIME。
 * @returns {Blob} Blob。
 */
function base64ToBlob(buffer, mime) {
	const binary = atob(buffer || '')
	const bytes = new Uint8Array(binary.length)
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
	return new Blob([bytes], { type: mime || 'application/octet-stream' })
}

/**
 * base64 解码后的字节数（含 padding 取整）。
 * @param {string} buffer - base64。
 * @returns {number} 字节数。
 */
function byteLength(buffer) {
	const text = String(buffer || '')
	if (!text) return 0
	const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
	return Math.floor(text.length * 3 / 4) - padding
}

/**
 * 取（或创建）某附件的缩略图 URL。
 * @param {string} key - 缓存键。
 * @param {{buffer: string, mime_type: string}} source - 附件数据。
 * @returns {string} Blob URL。
 */
function ensureImageUrl(key, source) {
	const existing = imageUrls.get(key)
	if (existing) return existing
	const url = URL.createObjectURL(base64ToBlob(source.buffer, source.mime_type))
	imageUrls.set(key, url)
	return url
}

/**
 * 组件附件为 data URL（下载用）。
 * @param {{buffer: string, mime_type: string, name?: string}} attachment - 附件。
 * @returns {string} data URL。
 */
function dataUrl(attachment) {
	return `data:${attachment.mime_type || 'application/octet-stream'};base64,${attachment.buffer || ''}`
}

/**
 * 队列当前总字节数。
 * @param {object} runtime - 运行时。
 * @returns {number} 总字节。
 */
function totalBytes(runtime) {
	return (runtime.attachments || []).reduce((sum, attachment) => sum + byteLength(attachment.buffer), 0)
}

/**
 * 按 MIME 选类型图标。
 * @param {string} mime - MIME。
 * @returns {string} 图标 id。
 */
function fileIcon(mime = '') {
	if (mime.includes('javascript')) return icons.javascript
	if (mime.includes('shell') || mime.includes('x-sh')) return icons.terminal
	return icons.attach
}

/**
 * 该附件是否可发送（非读取中 / 失败 / 已发送）。
 * @param {object} attachment - 附件。
 * @returns {boolean} 是否就绪。
 */
function isReady(attachment) {
	return !attachment.state || attachment.state === 'ready'
}

/**
 * 取标签页的就绪附件列表。
 * @param {string} tabKey - 标签键。
 * @returns {object[]} 附件列表。
 */
export function readyAttachments(tabKey) {
	return (getRuntime(tabKey)?.attachments || []).filter(isReady)
}

/**
 * 序列化为后端 `files` 形状（不含本地状态字段）。
 * @param {string} tabKey - 标签键。
 * @returns {Array<{name: string, mime_type: string, buffer: string, description: string}>} 附件列表。
 */
export function serializeAttachments(tabKey) {
	return readyAttachments(tabKey).map(attachment => ({
		name: attachment.name,
		mime_type: attachment.mime_type,
		buffer: attachment.buffer,
		description: attachment.description || '',
	}))
}

/* ---------------- 队列操作 ---------------- */

/**
 * 添加附件到指定标签页运行时（File/Blob 读取为 base64；已是 base64 的载荷直接入列）。
 * 先快照 tabKey，切换标签页后仍写回原标签页。
 * @param {string} tabKey - 标签键。
 * @param {Array<File|Blob|{name?: string, mime_type?: string, buffer?: string, description?: string}>} files - 待添加项。
 * @returns {Promise<void>} 完成。
 */
export async function addFilesToRuntime(tabKey, files) {
	const runtime = getRuntime(tabKey, { create: true })
	if (!runtime) return
	const list = [...files || []].filter(Boolean)
	if (!list.length) return
	for (const item of list) {
		const isBlob = typeof Blob !== 'undefined' && item instanceof Blob
		const name = String(item.name || 'file')
		const mime = String(item.type || item.mime_type || 'application/octet-stream')
		const size = isBlob ? item.size : byteLength(String(item.buffer || ''))
		if (size > ATTACHMENT_MAX_BYTES) {
			showToastI18n('error', 'code.attach.tooLarge', { name })
			continue
		}
		if (totalBytes(runtime) + size > ATTACHMENT_MAX_TOTAL_BYTES) {
			showToastI18n('error', 'code.attach.tooLargeTotal', { limit: formatBytes(ATTACHMENT_MAX_TOTAL_BYTES) })
			continue
		}
		const attachment = {
			id: crypto.randomUUID().slice(0, 8),
			name,
			mime_type: mime,
			buffer: typeof item.buffer === 'string' ? item.buffer : '',
			description: typeof item.description === 'string' ? item.description : '',
			state: isBlob ? 'reading' : 'ready',
		}
		runtime.attachments.push(attachment)
		if (tabKey === store.activeTabKey) renderAttachmentStrip()
		if (!isBlob) continue
		try {
			attachment.buffer = await blobToBase64(item)
			attachment.state = 'ready'
		}
		catch {
			attachment.state = 'error'
		}
		if (tabKey === store.activeTabKey) renderAttachmentStrip()
	}
}

/**
 * 移除某附件（按稳定 id 定位）。
 * @param {string} tabKey - 标签键。
 * @param {string} id - 附件 id。
 * @returns {void}
 */
export function removeAttachment(tabKey, id) {
	const runtime = getRuntime(tabKey)
	if (!runtime) return
	const index = (runtime.attachments || []).findIndex(attachment => attachment.id === id)
	if (index < 0) return
	runtime.attachments.splice(index, 1)
	releaseUrl(`a:${id}`)
	if (tabKey === store.activeTabKey) renderAttachmentStrip()
}

/**
 * 预览某图片附件（全屏查看器）。
 * @param {string} tabKey - 标签键。
 * @param {string} id - 附件 id。
 * @returns {void}
 */
export function previewAttachment(tabKey, id) {
	const attachment = (getRuntime(tabKey)?.attachments || []).find(item => item.id === id)
	if (!attachment || !attachment.mime_type?.startsWith('image/')) return
	openMediaViewer([{ src: ensureImageUrl(`a:${id}`, attachment), name: attachment.name, mimeType: attachment.mime_type }], 0)
}

/**
 * 编辑某图片附件：原位替换同一附件的名称 / MIME / 大小 / buffer 并刷新缩略图。
 * 等待编辑器期间附件被移除时丢弃本次编辑。
 * @param {string} tabKey - 标签键。
 * @param {string} id - 附件 id。
 * @returns {Promise<void>} 完成。
 */
export async function editAttachmentImage(tabKey, id) {
	const runtime = getRuntime(tabKey)
	const attachment = (runtime?.attachments || []).find(item => item.id === id)
	if (!attachment || !attachment.mime_type?.startsWith('image/')) return
	const source = new File([base64ToBlob(attachment.buffer, attachment.mime_type)], attachment.name, { type: attachment.mime_type })
	const edited = await openImageEditor(source).catch(() => null)
	if (!edited) return
	const current = (getRuntime(tabKey)?.attachments || []).find(item => item.id === id)
	if (!current) return
	try {
		current.buffer = await blobToBase64(edited)
		current.name = edited.name || current.name
		current.mime_type = edited.type || current.mime_type
		current.state = 'ready'
	}
	catch {
		current.state = 'error'
	}
	releaseUrl(`a:${id}`)
	if (tabKey === store.activeTabKey) renderAttachmentStrip()
}

/* ---------------- 渲染 ---------------- */

/**
 * 创建卡片操作按钮。
 * @param {string} className - 附加 class。
 * @param {string} i18nKey - 对象 i18n 键（aria-label / title）。
 * @param {string} icon - 图标 id。
 * @param {() => void} onClick - 点击回调。
 * @returns {HTMLButtonElement} 按钮。
 */
function cardActionButton(className, i18nKey, icon, onClick) {
	const button = document.createElement('button')
	button.type = 'button'
	button.className = `code-attachment-action ${className}`
	button.appendChild(iconElement(icon, { size: 13 }))
	setElementI18n(button, i18nKey)
	button.addEventListener('click', event => {
		event.stopPropagation()
		onClick()
	})
	return button
}

/**
 * 渲染单个待发送附件卡片。
 * @param {string} tabKey - 标签键。
 * @param {object} attachment - 附件。
 * @returns {HTMLElement} 卡片。
 */
function renderPendingCard(tabKey, attachment) {
	const isImage = attachment.mime_type?.startsWith('image/')
	const card = document.createElement('div')
	card.className = `code-attachment-card${isImage ? ' code-attachment-card-image' : ''}`
	card.dataset.attachmentId = attachment.id
	if (attachment.state === 'reading' || attachment.state === 'error') {
		const status = document.createElement('span')
		status.className = 'code-attachment-status'
		setElementI18n(status, attachment.state === 'error' ? 'code.attach.failed' : 'code.attach.reading', { name: attachment.name })
		card.appendChild(status)
	}
	const remove = cardActionButton('code-attachment-remove', 'code.attach.remove', icons.close, () => removeAttachment(tabKey, attachment.id))
	if (isImage && attachment.state !== 'error') {
		const thumb = document.createElement('div')
		thumb.className = 'code-attachment-thumb'
		const preview = document.createElement('button')
		preview.type = 'button'
		preview.className = 'code-attachment-preview'
		setElementI18n(preview, 'code.attach.preview', { name: attachment.name })
		const image = document.createElement('img')
		image.src = ensureImageUrl(`a:${attachment.id}`, attachment)
		image.alt = ''
		image.setAttribute('aria-hidden', 'true')
		image.setAttribute('svg-inliner-ignore', '')
		preview.appendChild(image)
		preview.addEventListener('click', () => previewAttachment(tabKey, attachment.id))
		thumb.appendChild(preview)
		const edit = cardActionButton('code-attachment-edit', 'code.attach.edit', icons.edit, () => { void editAttachmentImage(tabKey, attachment.id) })
		const actions = document.createElement('div')
		actions.className = 'code-attachment-actions'
		actions.append(edit, remove)
		const description = document.createElement('input')
		description.type = 'text'
		description.className = 'code-attachment-description'
		description.value = attachment.description || ''
		setElementI18n(description, 'code.attach.description', { name: attachment.name })
		description.addEventListener('input', () => { attachment.description = description.value })
		card.append(thumb, actions, description)
		return card
	}
	const icon = iconElement(fileIcon(attachment.mime_type), { size: 14 })
	const name = document.createElement('span')
	name.className = 'code-attachment-name'
	name.setAttribute('user-content', '')
	name.textContent = attachment.name
	const size = document.createElement('span')
	size.className = 'code-attachment-size'
	size.textContent = formatBytes(byteLength(attachment.buffer))
	const download = document.createElement('a')
	download.className = 'code-attachment-download'
	download.href = dataUrl(attachment)
	download.download = attachment.name
	setElementI18n(download, 'code.attach.download', { name: attachment.name })
	download.appendChild(iconElement(icons.download, { size: 13 }))
	card.append(icon, name, size, download, remove)
	return card
}

/** 渲染活动标签页的待发送附件预览条（无附件时隐藏）。 */
export function renderAttachmentStrip() {
	const strip = elements.attachmentPreview
	if (!strip) return
	const runtime = getActiveRuntime()
	const attachments = (runtime?.attachments || []).filter(attachment => attachment.state !== 'sent')
	reconcileUrls()
	strip.replaceChildren(...attachments.map(attachment => renderPendingCard(runtime.tabKey, attachment)))
	strip.hidden = !attachments.length
	void svgInliner(strip)
}

/**
 * 渲染已发送条目的附件（图片缩略图 + 文件 chip；不提供编辑）。
 * @param {object} entry - 会话条目。
 * @returns {HTMLElement} 附件容器（可能为空，调用方据此决定是否插入）。
 */
export function renderMessageAttachments(entry) {
	const container = document.createElement('div')
	container.className = 'code-message-attachments'
	for (const [index, file] of (entry?.files || []).entries()) {
		const mime = file.mime_type || file.mimeType || 'application/octet-stream'
		if (mime.startsWith('image/')) {
			const image = document.createElement('img')
			image.className = 'code-message-attachment-thumb'
			image.alt = file.name || ''
			image.setAttribute('svg-inliner-ignore', '')
			image.src = ensureImageUrl(`m:${entry.id}:${index}`, { buffer: file.buffer, mime_type: mime })
			container.appendChild(image)
			continue
		}
		const chip = document.createElement('a')
		chip.className = 'code-message-file-chip flex items-center gap-1 text-xs opacity-70'
		chip.href = `data:${mime};base64,${file.buffer || ''}`
		chip.download = file.name || 'file'
		setElementI18n(chip, 'code.attach.download', { name: file.name || 'file' })
		const name = document.createElement('span')
		name.setAttribute('user-content', '')
		name.textContent = file.name || 'file'
		const size = document.createElement('span')
		size.className = 'code-attachment-size'
		size.textContent = file.buffer ? formatBytes(byteLength(file.buffer)) : ''
		chip.append(iconElement(fileIcon(mime), { size: 14 }), name, size)
		container.appendChild(chip)
	}
	return container
}

/* ---------------- 事件绑定 ---------------- */

window.addEventListener('code-attachments-changed', event => {
	const tabKey = event.detail?.tabKey
	reconcileUrls()
	if (!tabKey || tabKey === store.activeTabKey) renderAttachmentStrip()
})

// 页面卸载时尽力回收（浏览器也会随文档销毁释放，此处显式处理避免长期驻留）
window.addEventListener('pagehide', () => {
	for (const url of imageUrls.values()) URL.revokeObjectURL(url)
	imageUrls.clear()
})

document.head.prepend(Object.assign(document.createElement('style'), {
	textContent: /* css */ `\
.code-attachment-card {
	display: flex;
	align-items: center;
	gap: 0.25rem;
	max-width: 18rem;
	padding: 0.1875rem 0.375rem;
	border: var(--border) solid color-mix(in oklch, var(--color-base-content) 14%, transparent);
	border-radius: var(--radius-field);
	background: color-mix(in oklch, var(--color-base-200) 80%, transparent);
	font-size: 0.75rem;
}
.code-attachment-card-image {
	flex-direction: column;
	align-items: stretch;
	width: 8.5rem;
}
.code-attachment-thumb {
	position: relative;
	display: block;
	width: 100%;
	aspect-ratio: 4 / 3;
	overflow: hidden;
	border-radius: var(--radius-field);
	background: color-mix(in oklch, var(--color-base-300) 70%, transparent);
}
.code-attachment-preview {
	display: block;
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	background: transparent;
	cursor: zoom-in;
}
.code-attachment-thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}
.code-attachment-actions {
	display: flex;
	justify-content: flex-end;
	gap: 0.125rem;
	margin-top: 0.1875rem;
}
.code-attachment-action {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 1.25rem;
	height: 1.25rem;
	border-radius: var(--radius-box);
	background: color-mix(in oklch, var(--color-base-100) 82%, transparent);
	color: var(--color-base-content);
	cursor: pointer;
}
.code-attachment-action:hover {
	background: var(--color-base-100);
}
.code-attachment-description {
	width: 100%;
	margin-top: 0.1875rem;
	padding: 0 0.25rem;
	border: var(--border) solid color-mix(in oklch, var(--color-base-content) 14%, transparent);
	border-radius: var(--radius-field);
	background: var(--color-base-100);
	font-size: 0.6875rem;
}
.code-attachment-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.code-attachment-size,
.code-attachment-status {
	opacity: 0.6;
	flex: none;
}
.code-attachment-status {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.code-attachment-download {
	display: inline-flex;
	align-items: center;
	flex: none;
	opacity: 0.7;
}
.code-attachment-download:hover {
	opacity: 1;
}
.code-message-attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 0.375rem;
	margin-top: 0.375rem;
}
.code-message-attachment-thumb {
	width: 6rem;
	height: 6rem;
	object-fit: cover;
	border-radius: var(--radius-field);
	cursor: zoom-in;
}
`,
}))
