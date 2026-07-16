import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { groupRefLabel, renderGroupRefBlockHtml } from '../shared/groupRef.mjs'

import { socialApi } from './lib/apiClient.mjs'
import { renderQuoteBlockHtml } from './lib/display.mjs'
import { uploadSocialMedia } from './media.mjs'
import { renderMediaPreview } from './mediaRender.mjs'
import { socialState } from './state.mjs'
import { bindVisibilityPicker, readVisibilityPicker } from './visibilityPicker.mjs'
import { formatChannelToken, stripChannelTokens } from '/parts/shells:chat/shared/inlineTokenSyntax.mjs'
import { openImageEditor } from '/scripts/imageEditor/index.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

/** @type {number} */
let quotePreviewGeneration = 0

/**
 * 刷新引用预览面板。
 * @returns {void}
 */
export async function refreshQuotePreview() {
	const panel = document.getElementById('quotePreview')
	if (!panel) return
	const generation = ++quotePreviewGeneration
	if (!socialState.pendingQuoteRef) {
		panel.classList.add('hidden')
		panel.replaceChildren()
		return
	}
	panel.classList.remove('hidden')
	await mountTemplate(panel, 'quote_preview', {})
	if (generation !== quotePreviewGeneration) return
	const body = panel.querySelector('.quote-preview-body')
	if (body) body.innerHTML = renderQuoteBlockHtml(socialState.pendingQuoteRef)
	panel.querySelector('.clear-quote-btn')?.addEventListener('click', () => {
		socialState.pendingQuoteRef = null
		void refreshQuotePreview()
	})
}

/**
 * 刷新群关联预览面板。
 * @returns {void}
 */
export async function refreshGroupRefPreview() {
	const panel = document.getElementById('groupRefPreview')
	if (!panel) return
	if (!socialState.pendingGroupRef) {
		panel.classList.add('hidden')
		panel.replaceChildren()
		return
	}
	panel.classList.remove('hidden')
	await mountTemplate(panel, 'group_ref_preview', {})
	const body = panel.querySelector('.group-ref-preview-body')
	if (body) body.innerHTML = renderGroupRefBlockHtml(socialState.pendingGroupRef)
	panel.querySelector('.clear-group-ref-btn')?.addEventListener('click', () => {
		socialState.pendingGroupRef = null
		syncGroupRefInComposer(null)
		void refreshGroupRefPreview()
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
	let text = stripChannelTokens(textarea.value)
	if (ref?.groupId) {
		const channel = ref.channelId?.trim() || 'default'
		const token = formatChannelToken(ref.groupId, channel)
		text = text ? `${text}\n\n${token}` : token
	}
	textarea.value = text
}

/**
 * 加载可入册的相册到多选。
 * @returns {Promise<void>}
 */
export async function loadAlbumPickerOptions() {
	const select = document.getElementById('postAlbumSelect')
	if (!(select instanceof HTMLSelectElement)) return
	select.replaceChildren()
	try {
		const data = await socialApi('/albums')
		const albums = (data.albums || []).filter(album => !album.virtual)
		if (!albums.length) {
			select.hidden = true
			return
		}
		select.hidden = false
		select.setAttribute('aria-label', geti18n('social.albums.pickerLabel'))
		for (const album of albums) {
			const option = document.createElement('option')
			option.value = album.albumId
			option.textContent = album.name
			select.appendChild(option)
		}
	}
	catch {
		select.hidden = true
	}
}

/**
 * 绑定 composer 可见性 picker。
 * @returns {void}
 */
export function initComposerVisibilityPicker() {
	const root = document.getElementById('postVisibilityPicker')
	if (root) bindVisibilityPicker(root)
}

/**
 * 加载可关联的 Chat 群到下拉选择器。
 * @returns {Promise<void>}
 */
export async function loadGroupPickerOptions() {
	const select = document.getElementById('linkGroupSelect')
	if (!select) return
	select.innerHTML = `<option value="">${geti18n('social.groupRef.pickPlaceholder')}</option>`
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
 * @param {object[]} mediaRefs 已上传 refs
 * @returns {object} 发帖 body
 */
export function buildPostBody(mediaRefs = socialState.pendingMediaRefs) {
	const contentWarning = document.getElementById('postContentWarning')?.value?.trim() || ''
	const sensitiveEl = document.getElementById('postSensitiveMedia')
	const sensitiveMedia = sensitiveEl instanceof HTMLInputElement
		? sensitiveEl.checked
		: Boolean(contentWarning)
	const visibilityDraft = readVisibilityPicker(document.getElementById('postVisibilityPicker'))
	const albumSelect = document.getElementById('postAlbumSelect')
	const albumIds = albumSelect instanceof HTMLSelectElement
		? [...albumSelect.selectedOptions].map(opt => opt.value).filter(id => id && id !== 'default')
		: []
	const body = {
		text: document.getElementById('postText').value.trim(),
		mediaRefs: mediaRefs.map(ref => {
			const { file: _file, objectUrl: _url, pending: _pending, ...rest } = ref
			return rest
		}),
		...visibilityDraft,
		...albumIds.length ? { albumIds } : {},
		locale: document.getElementById('postLocale').value.trim() || 'zh-CN',
		...contentWarning ? { contentWarning } : {},
		...sensitiveMedia || contentWarning ? { sensitiveMedia: true } : {},
	}
	if (socialState.pendingQuoteRef)
		body.quoteRef = {
			entityHash: socialState.pendingQuoteRef.entityHash,
			postId: socialState.pendingQuoteRef.postId,
		}
	if (socialState.pendingGroupRef)
		body.groupRef = {
			groupId: socialState.pendingGroupRef.groupId,
			channelId: socialState.pendingGroupRef.channelId,
		}
	if (socialState.pendingPoll)
		body.poll = socialState.pendingPoll

	const replyPolicy = document.getElementById('postReplyPolicy')?.value
	if (replyPolicy && replyPolicy !== 'everyone') body.replyPolicy = replyPolicy

	const replyDisplay = document.getElementById('postReplyDisplay')?.value
	if (replyDisplay && replyDisplay !== 'all') body.replyDisplay = replyDisplay

	const publishAtEl = document.getElementById('postPublishAt')
	if (publishAtEl instanceof HTMLInputElement && publishAtEl.value) {
		const ms = new Date(publishAtEl.value).getTime()
		if (!Number.isNaN(ms) && ms > Date.now()) body.publishAt = ms
	}

	return body
}

/**
 * 刷新待发布媒体预览区。
 * @returns {void}
 */
export function refreshMediaPreview() {
	renderMediaPreview(
		document.getElementById('mediaPreview'),
		socialState.pendingMediaRefs,
		() => refreshMediaPreview(),
		{
			altPlaceholder: geti18n('social.composer.mediaAlt'),
			editLabel: geti18n('social.composer.editImage'),
			/**
			 * @param {number} index 媒体下标
			 * @param {object} ref 媒体引用
			 */
			onEditImage: async (index, ref) => {
				const source = ref.file
				if (!(source instanceof Blob)) return
				const edited = await openImageEditor(source, {
					title: geti18n('social.composer.editImage'),
					cropLabel: geti18n('social.composer.editCrop'),
					mosaicLabel: geti18n('social.composer.editMosaic'),
					brushLabel: geti18n('social.composer.editBrush'),
					applyLabel: geti18n('social.composer.editApply'),
					cancelLabel: geti18n('social.composer.editCancel'),
				})
				if (!edited) return
				if (ref.objectUrl) URL.revokeObjectURL(ref.objectUrl)
				socialState.pendingMediaRefs[index] = {
					...ref,
					file: edited,
					objectUrl: URL.createObjectURL(edited),
					name: edited.name,
					mimeType: edited.type || ref.mimeType,
					pending: true,
					kind: 'image',
				}
				refreshMediaPreview()
			},
		},
	)
}

/**
 * 暂存 composer 媒体（延迟到发帖时再上传，便于编辑）。
 * @param {FileList | File[]} files 媒体文件
 * @returns {Promise<void>}
 */
export async function addComposerMedia(files) {
	for (const file of files) {
		const kind = file.type.startsWith('image/')
			? 'image'
			: file.type.startsWith('video/')
				? 'video'
				: 'file'
		socialState.pendingMediaRefs.push({
			kind,
			name: file.name,
			mimeType: file.type || 'application/octet-stream',
			file,
			objectUrl: URL.createObjectURL(file),
			pending: true,
			alt: '',
		})
	}
	refreshMediaPreview()
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
 * @returns {Promise<void>}
 */
export async function publishPost() {
	if (!document.getElementById('postText').value.trim()
		&& !socialState.pendingMediaRefs.length
		&& !socialState.pendingPoll) return
	const uploadedRefs = await ensureUploadedMediaRefs(socialState.pendingMediaRefs)
	const body = buildPostBody(uploadedRefs)
	const isScheduled = !!body.publishAt
	await socialApi('/posts', { method: 'POST', body: JSON.stringify(body) })
	const postText = document.getElementById('postText')
	if (postText instanceof HTMLTextAreaElement)
		postText.value = ''
	const cwInput = document.getElementById('postContentWarning')
	if (cwInput instanceof HTMLInputElement)
		cwInput.value = ''
	const sensitiveEl = document.getElementById('postSensitiveMedia')
	if (sensitiveEl instanceof HTMLInputElement)
		sensitiveEl.checked = false
	const publishAtEl = document.getElementById('postPublishAt')
	if (publishAtEl instanceof HTMLInputElement)
		publishAtEl.value = ''
	for (const ref of socialState.pendingMediaRefs)
		if (ref.objectUrl) URL.revokeObjectURL(ref.objectUrl)
	socialState.pendingMediaRefs = []
	socialState.pendingQuoteRef = null
	socialState.pendingGroupRef = null
	socialState.pendingPoll = null
	refreshMediaPreview()
	await refreshQuotePreview()
	void refreshGroupRefPreview()
	syncGroupRefInComposer(null)
	const groupSelect = document.getElementById('linkGroupSelect')
	if (groupSelect instanceof HTMLSelectElement)
		groupSelect.value = ''
	if (isScheduled)
		showToastI18n('success', 'social.composer.scheduleSuccess')
}

/**
 * 设置待关联的群/频道并更新预览。
 * @param {string} groupId 群 id
 * @param {string} channelId 频道 id
 * @param {string} label 展示标签
 * @returns {void}
 */
export function setPendingGroupRef(groupId, channelId, label) {
	socialState.pendingGroupRef = {
		groupId,
		channelId: channelId || 'default',
		label: label || groupRefLabel({ groupId, channelId }),
	}
	syncGroupRefInComposer(socialState.pendingGroupRef)
	refreshGroupRefPreview()
}
