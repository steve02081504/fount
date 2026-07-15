import { mountTemplate } from '../../../../scripts/features/template.mjs'
import {
	formatGroupRefMarkdownToken,
	groupRefLabel,
	renderGroupRefBlockHtml,
	stripGroupRefMarkdownTokens,
} from '../shared/groupRef.mjs'

import { uploadSocialMedia } from './media.mjs'
import { renderMediaPreview } from './mediaRender.mjs'
import { openImageEditor } from '/scripts/imageEditor/index.mjs'

/** @type {number} */
let quotePreviewGeneration = 0

/**
 * 刷新引用预览面板。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export async function refreshQuotePreview(appContext) {
	const panel = document.getElementById('quotePreview')
	if (!panel) return
	const generation = ++quotePreviewGeneration
	if (!appContext.state.pendingQuoteRef) {
		panel.classList.add('hidden')
		panel.replaceChildren()
		return
	}
	panel.classList.remove('hidden')
	await mountTemplate(panel, 'quote_preview', {})
	if (generation !== quotePreviewGeneration) return
	const body = panel.querySelector('.quote-preview-body')
	if (body) body.innerHTML = appContext.renderQuoteBlockHtml(appContext.state.pendingQuoteRef)
	panel.querySelector('.clear-quote-btn')?.addEventListener('click', () => {
		appContext.state.pendingQuoteRef = null
		void refreshQuotePreview(appContext)
	})
}

/**
 * 刷新群关联预览面板。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export async function refreshGroupRefPreview(appContext) {
	const panel = document.getElementById('groupRefPreview')
	if (!panel) return
	if (!appContext.state.pendingGroupRef) {
		panel.classList.add('hidden')
		panel.replaceChildren()
		return
	}
	panel.classList.remove('hidden')
	await mountTemplate(panel, 'group_ref_preview', {})
	const body = panel.querySelector('.group-ref-preview-body')
	if (body) body.innerHTML = renderGroupRefBlockHtml(appContext.state.pendingGroupRef)
	panel.querySelector('.clear-group-ref-btn')?.addEventListener('click', () => {
		appContext.state.pendingGroupRef = null
		syncGroupRefInComposer(null)
		void refreshGroupRefPreview(appContext)
	})
}

/**
 * 同步发帖框正文中的群链 Markdown 标记。
 * @param {{ groupId: string, channelId: string } | null} ref 群关联
 * @returns {void}
 */
export function syncGroupRefInComposer(ref) {
	const textarea = document.getElementById('postText')
	if (!(textarea instanceof HTMLTextAreaElement)) return
	let text = stripGroupRefMarkdownTokens(textarea.value)
	if (ref?.groupId) {
		const token = formatGroupRefMarkdownToken(ref.groupId, ref.channelId)
		text = text ? `${text}\n\n${token}` : token
	}
	textarea.value = text
}

/**
 * 加载可关联的 Chat 群到下拉选择器。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadGroupPickerOptions(appContext) {
	const select = document.getElementById('linkGroupSelect')
	if (!select) return
	select.innerHTML = `<option value="">${appContext.geti18n('social.groupRef.pickPlaceholder')}</option>`
	try {
		const response = await fetch('/api/parts/shells:chat/groups/', { credentials: 'include' })
		if (!response.ok) {
			select.classList.add('hidden')
			return
		}
		const rows = await response.json()
		const groups = Array.isArray(rows) ? rows : []
		if (!groups.length) {
			select.classList.add('hidden')
			return
		}
		select.classList.remove('hidden')
		for (const row of groups) {
			const groupId = String(row.groupId || '').trim()
			if (!groupId) continue
			const channelId = String(row.defaultChannelId || 'default').trim() || 'default'
			const title = String(row.name || groupId).trim()
			const option = document.createElement('option')
			option.value = `${groupId}\t${channelId}`
			option.textContent = `${title} (#${groupId}/${channelId})`
			select.appendChild(option)
		}
	}
	catch {
		select.classList.add('hidden')
	}
}

/**
 * 从 composer 表单构建发帖 API 请求体（媒体须已上传）。
 * @param {object} appContext 应用上下文
 * @param {object[]} mediaRefs 已上传 refs
 * @returns {object} 发帖 body
 */
export function buildPostBody(appContext, mediaRefs = appContext.state.pendingMediaRefs) {
	const contentWarning = document.getElementById('postContentWarning')?.value?.trim() || ''
	const sensitiveEl = document.getElementById('postSensitiveMedia')
	const sensitiveMedia = sensitiveEl instanceof HTMLInputElement
		? sensitiveEl.checked
		: Boolean(contentWarning)
	const body = {
		text: document.getElementById('postText').value.trim(),
		mediaRefs: mediaRefs.map(ref => {
			const { file: _file, objectUrl: _url, pending: _pending, ...rest } = ref
			return rest
		}),
		visibility: document.getElementById('postVisibility').value,
		locale: document.getElementById('postLocale').value.trim() || 'zh-CN',
		...contentWarning ? { contentWarning } : {},
		...sensitiveMedia || contentWarning ? { sensitiveMedia: true } : {},
	}
	if (appContext.state.pendingQuoteRef)
		body.quoteRef = {
			entityHash: appContext.state.pendingQuoteRef.entityHash,
			postId: appContext.state.pendingQuoteRef.postId,
		}
	if (appContext.state.pendingGroupRef)
		body.groupRef = {
			groupId: appContext.state.pendingGroupRef.groupId,
			channelId: appContext.state.pendingGroupRef.channelId,
		}
	if (appContext.state.pendingPoll)
		body.poll = appContext.state.pendingPoll
	return body
}

/**
 * 刷新待发布媒体预览区。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function refreshMediaPreview(appContext) {
	renderMediaPreview(
		document.getElementById('mediaPreview'),
		appContext.state.pendingMediaRefs,
		() => refreshMediaPreview(appContext),
		{
			altPlaceholder: appContext.geti18n('social.composer.mediaAlt'),
			editLabel: appContext.geti18n('social.composer.editImage'),
			/**
			 * @param {number} index 媒体下标
			 * @param {object} ref 媒体引用
			 */
			onEditImage: async (index, ref) => {
				const source = ref.file
				if (!(source instanceof Blob)) return
				const edited = await openImageEditor(source, {
					title: appContext.geti18n('social.composer.editImage'),
					cropLabel: appContext.geti18n('social.composer.editCrop'),
					mosaicLabel: appContext.geti18n('social.composer.editMosaic'),
					brushLabel: appContext.geti18n('social.composer.editBrush'),
					applyLabel: appContext.geti18n('social.composer.editApply'),
					cancelLabel: appContext.geti18n('social.composer.editCancel'),
				})
				if (!edited) return
				if (ref.objectUrl) URL.revokeObjectURL(ref.objectUrl)
				appContext.state.pendingMediaRefs[index] = {
					...ref,
					file: edited,
					objectUrl: URL.createObjectURL(edited),
					name: edited.name,
					mimeType: edited.type || ref.mimeType,
					pending: true,
					kind: 'image',
				}
				refreshMediaPreview(appContext)
			},
		},
	)
}

/**
 * 暂存 composer 媒体（延迟到发帖时再上传，便于编辑）。
 * @param {object} appContext 应用上下文
 * @param {FileList | File[]} files 媒体文件
 * @returns {Promise<void>}
 */
export async function addComposerMedia(appContext, files) {
	for (const file of files) {
		const kind = file.type.startsWith('image/')
			? 'image'
			: file.type.startsWith('video/')
				? 'video'
				: 'file'
		appContext.state.pendingMediaRefs.push({
			kind,
			name: file.name,
			mimeType: file.type || 'application/octet-stream',
			file,
			objectUrl: URL.createObjectURL(file),
			pending: true,
			alt: '',
		})
	}
	refreshMediaPreview(appContext)
}

/**
 * @param {object[]} refs 待发布 refs
 * @returns {Promise<object[]>} 已上传 refs
 */
async function ensureUploadedMediaRefs(refs) {
	const out = []
	const pendingFiles = []
	const pendingIndexes = []
	for (const [index, ref] of refs.entries()) 
		if (ref.pending && ref.file instanceof Blob) {
			pendingFiles.push(ref.file)
			pendingIndexes.push(index)
			out.push(null)
		}
		else {
			const { file: _f, objectUrl: _o, pending: _p, ...rest } = ref
			out.push(rest)
		}
	
	if (pendingFiles.length) {
		const uploaded = await uploadSocialMedia(pendingFiles)
		for (const [i, uploadedRef] of uploaded.entries()) {
			const original = refs[pendingIndexes[i]]
			out[pendingIndexes[i]] = {
				...uploadedRef,
				...original.alt ? { alt: original.alt } : {},
			}
		}
	}
	return out
}

/**
 * 提交发帖请求并清空 composer 状态。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function publishPost(appContext) {
	if (!document.getElementById('postText').value.trim()
		&& !appContext.state.pendingMediaRefs.length
		&& !appContext.state.pendingPoll) return
	const uploadedRefs = await ensureUploadedMediaRefs(appContext.state.pendingMediaRefs)
	const body = buildPostBody(appContext, uploadedRefs)
	await appContext.socialApi('/posts', { method: 'POST', body: JSON.stringify(body) })
	const postText = document.getElementById('postText')
	if (postText instanceof HTMLTextAreaElement)
		postText.value = ''
	const cwInput = document.getElementById('postContentWarning')
	if (cwInput instanceof HTMLInputElement)
		cwInput.value = ''
	const sensitiveEl = document.getElementById('postSensitiveMedia')
	if (sensitiveEl instanceof HTMLInputElement)
		sensitiveEl.checked = false
	for (const ref of appContext.state.pendingMediaRefs)
		if (ref.objectUrl) URL.revokeObjectURL(ref.objectUrl)
	appContext.state.pendingMediaRefs = []
	appContext.state.pendingQuoteRef = null
	appContext.state.pendingGroupRef = null
	appContext.state.pendingPoll = null
	refreshMediaPreview(appContext)
	await refreshQuotePreview(appContext)
	void refreshGroupRefPreview(appContext)
	syncGroupRefInComposer(null)
	const groupSelect = document.getElementById('linkGroupSelect')
	if (groupSelect instanceof HTMLSelectElement)
		groupSelect.value = ''
}

/**
 * 设置待关联的群/频道并更新预览。
 * @param {object} appContext 应用上下文
 * @param {string} groupId 群 id
 * @param {string} channelId 频道 id
 * @param {string} label 展示标签
 * @returns {void}
 */
export function setPendingGroupRef(appContext, groupId, channelId, label) {
	appContext.state.pendingGroupRef = {
		groupId,
		channelId: channelId || 'default',
		label: label || groupRefLabel({ groupId, channelId }),
	}
	syncGroupRefInComposer(appContext.state.pendingGroupRef)
	refreshGroupRefPreview(appContext)
}
