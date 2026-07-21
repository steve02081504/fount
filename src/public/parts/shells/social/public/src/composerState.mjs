import { mountTemplate } from '../../../../scripts/features/template.mjs'
import { groupRefLabel, renderGroupRefBlockHtml } from '../shared/groupRef.mjs'
import { clearCwSensitive } from '/parts/shells:chat/shared/composerAttachmentFields.mjs'

import { chatApi, socialApi } from './lib/apiClient.mjs'
import { renderQuoteBlockHtml } from './lib/display.mjs'
import { renderMediaPreview } from './mediaRender.mjs'
import { state } from './state.mjs'
import { bindVisibilityPicker, applyVisibilityPicker } from './visibilityPicker.mjs'
import { formatChannelToken, stripChannelTokens } from '/parts/shells:chat/shared/inlineTokenSyntax.mjs'
import { openImageEditor } from '/scripts/imageEditor/index.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'

const SOCIAL_CW_IDS = { cwId: 'postContentWarning', sensitiveId: 'postSensitiveMedia' }

/**
 * @param {number} n 数值
 * @returns {string} 两位补零
 */
export function pad2(n) {
	return String(n).padStart(2, '0')
}

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
	if (!state.pendingQuoteRef) {
		panel.classList.add('hidden')
		panel.replaceChildren()
		return
	}
	panel.classList.remove('hidden')
	await mountTemplate(panel, 'quote_preview', {})
	if (generation !== quotePreviewGeneration) return
	const body = panel.querySelector('.quote-preview-body')
	if (body) body.innerHTML = await renderQuoteBlockHtml(state.pendingQuoteRef)
	panel.querySelector('.clear-quote-btn')?.addEventListener('click', () => {
		state.pendingQuoteRef = null
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
	if (!state.pendingGroupRef) {
		panel.classList.add('hidden')
		panel.replaceChildren()
		return
	}
	panel.classList.remove('hidden')
	await mountTemplate(panel, 'group_ref_preview', {})
	const body = panel.querySelector('.group-ref-preview-body')
	if (body) body.innerHTML = renderGroupRefBlockHtml(state.pendingGroupRef)
	panel.querySelector('.clear-group-ref-btn')?.addEventListener('click', () => {
		state.pendingGroupRef = null
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
	const field = document.getElementById('postAlbumField')
	if (!(select instanceof HTMLSelectElement)) return
	select.replaceChildren()
	try {
		const data = await socialApi('/albums')
		const albums = (data.albums || []).filter(album => !album.virtual)
		if (!albums.length) {
			field?.classList.add('hidden')
			return
		}
		field?.classList.remove('hidden')
		for (const album of albums) {
			const option = document.createElement('option')
			option.value = album.albumId
			option.textContent = album.name
			select.appendChild(option)
		}
	}
	catch {
		field?.classList.add('hidden')
	}
}

/**
 * 绑定 composer 可见性 picker（选择器在工具栏，allow/except 输入在高级面板）。
 * 选择「指定成员可见」时自动展开高级面板，让 allow 输入可见。
 * @returns {void}
 */
export function initComposerVisibilityPicker() {
	const root = document.getElementById('composer')
	if (!root) return
	bindVisibilityPicker(root)
	document.getElementById('postVisibility')?.addEventListener('change', event => {
		if (event.target.value === 'selected')
			setComposerAdvancedOpen(true)
	})
}

/**
 * 展开/收起 composer 高级选项面板并同步按钮状态。
 * @param {boolean} [open] 指定目标状态；缺省为切换
 * @returns {void}
 */
export function setComposerAdvancedOpen(open) {
	const panel = document.getElementById('composerAdvancedPanel')
	if (!panel) return
	const next = open ?? panel.classList.contains('hidden')
	panel.classList.toggle('hidden', !next)
	document.getElementById('composerAdvancedToggle')?.classList.toggle('active', next)
}

/**
 * 展开/收起内容警告输入框；收起时清空内容。
 * @param {boolean} [open] 指定目标状态；缺省为切换
 * @returns {void}
 */
export function setComposerContentWarningOpen(open) {
	const input = document.getElementById('postContentWarning')
	if (!(input instanceof HTMLInputElement)) return
	const next = open ?? input.classList.contains('hidden')
	input.classList.toggle('hidden', !next)
	document.getElementById('composerCwToggle')?.classList.toggle('active', next)
	if (next) input.focus()
	else input.value = ''
}

/**
 * 加载可关联的 Chat 群到下拉选择器。
 * @returns {Promise<void>}
 */
export async function loadGroupPickerOptions() {
	const select = document.getElementById('linkGroupSelect')
	const field = document.getElementById('linkGroupField')
	if (!select) return
	select.innerHTML = `<option value="">${geti18n('social.groupRef.pick')}</option>`
	try {
		const rows = await chatApi('/groups/')
		const groups = Array.isArray(rows) ? rows : []
		if (!groups.length) {
			field?.classList.add('hidden')
			return
		}
		field?.classList.remove('hidden')
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
		field?.classList.add('hidden')
	}
}

/**
 * 刷新待发布媒体预览区。
 * @returns {void}
 */
export function refreshMediaPreview() {
	renderMediaPreview(
		document.getElementById('mediaPreview'),
		state.pendingMediaRefs,
		() => refreshMediaPreview(),
		{
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
				state.pendingMediaRefs[index] = {
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
		state.pendingMediaRefs.push({
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
 * 清空 composer 表单与 pending 状态。
 * @param {{ keepDraftId?: boolean }} [options] 是否保留 activeDraftId
 * @returns {Promise<void>}
 */
export async function clearComposer(options = {}) {
	const postText = document.getElementById('postText')
	if (postText instanceof HTMLTextAreaElement)
		postText.value = ''
	setComposerContentWarningOpen(false)
	clearCwSensitive(SOCIAL_CW_IDS)
	const publishAtEl = document.getElementById('postPublishAt')
	if (publishAtEl instanceof HTMLInputElement)
		publishAtEl.value = ''
	const replyPolicy = document.getElementById('postReplyPolicy')
	if (replyPolicy instanceof HTMLSelectElement)
		replyPolicy.value = 'everyone'
	const replyDisplay = document.getElementById('postReplyDisplay')
	if (replyDisplay instanceof HTMLSelectElement)
		replyDisplay.value = 'all'
	applyVisibilityPicker(document.getElementById('composer'), { visibility: 'public' })
	const albumSelect = document.getElementById('postAlbumSelect')
	if (albumSelect instanceof HTMLSelectElement)
		for (const opt of albumSelect.options) opt.selected = false
	for (const ref of state.pendingMediaRefs)
		if (ref.objectUrl) URL.revokeObjectURL(ref.objectUrl)
	state.pendingMediaRefs = []
	state.pendingQuoteRef = null
	state.pendingGroupRef = null
	state.pendingPoll = null
	if (!options.keepDraftId)
		state.activeDraftId = null
	document.getElementById('pollComposerToggle')?.classList.remove('active')
	document.getElementById('pollComposerPanel')?.classList.add('hidden')
	const pollOptions = document.getElementById('pollComposerOptions')
	if (pollOptions instanceof HTMLTextAreaElement) pollOptions.value = ''
	refreshMediaPreview()
	await refreshQuotePreview()
	void refreshGroupRefPreview()
	syncGroupRefInComposer(null)
	const groupSelect = document.getElementById('linkGroupSelect')
	if (groupSelect instanceof HTMLSelectElement)
		groupSelect.value = ''
	setComposerAdvancedOpen(false)
}

/**
 * 将草稿 body 填入 composer。
 * @param {object} row 草稿行（含 draftId / body）
 * @returns {Promise<void>}
 */
export async function loadDraftIntoComposer(row) {
	const body = row?.body || row || {}
	await clearComposer({ keepDraftId: true })
	state.activeDraftId = row?.draftId || null

	const postText = document.getElementById('postText')
	if (postText instanceof HTMLTextAreaElement)
		postText.value = String(body.text || '')

	if (body.contentWarning) {
		setComposerContentWarningOpen(true)
		const cw = document.getElementById('postContentWarning')
		if (cw instanceof HTMLInputElement) cw.value = String(body.contentWarning)
	}
	const sensitiveEl = document.getElementById('postSensitiveMedia')
	if (sensitiveEl instanceof HTMLInputElement)
		sensitiveEl.checked = Boolean(body.sensitiveMedia)

	applyVisibilityPicker(document.getElementById('composer'), body)
	if (body.visibility === 'selected' || body.allow?.length || body.except?.length
		|| body.replyPolicy && body.replyPolicy !== 'everyone'
		|| body.replyDisplay && body.replyDisplay !== 'all'
		|| body.publishAt || body.groupRef || body.albumIds?.length || body.sensitiveMedia)
		setComposerAdvancedOpen(true)

	const replyPolicy = document.getElementById('postReplyPolicy')
	if (replyPolicy instanceof HTMLSelectElement && body.replyPolicy)
		replyPolicy.value = body.replyPolicy
	const replyDisplay = document.getElementById('postReplyDisplay')
	if (replyDisplay instanceof HTMLSelectElement && body.replyDisplay)
		replyDisplay.value = body.replyDisplay

	if (body.locale) {
		const localeEl = document.getElementById('postLocale')
		if (localeEl instanceof HTMLInputElement) localeEl.value = String(body.locale)
	}

	if (body.publishAt) {
		const publishAtEl = document.getElementById('postPublishAt')
		if (publishAtEl instanceof HTMLInputElement) {
			const d = new Date(Number(body.publishAt))
			if (!Number.isNaN(d.getTime()))
				publishAtEl.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
		}
	}

	if (Array.isArray(body.albumIds) && body.albumIds.length) {
		await loadAlbumPickerOptions()
		const albumSelect = document.getElementById('postAlbumSelect')
		if (albumSelect instanceof HTMLSelectElement) {
			const wanted = new Set(body.albumIds.map(String))
			for (const opt of albumSelect.options)
				opt.selected = wanted.has(opt.value)
		}
	}

	if (body.quoteRef?.entityHash && body.quoteRef?.postId) {
		state.pendingQuoteRef = {
			entityHash: String(body.quoteRef.entityHash).toLowerCase(),
			postId: String(body.quoteRef.postId),
		}
		await refreshQuotePreview()
	}

	if (body.groupRef?.groupId) {
		await loadGroupPickerOptions()
		const groupId = String(body.groupRef.groupId)
		const channelId = String(body.groupRef.channelId || 'default')
		setPendingGroupRef(groupId, channelId, groupRefLabel({ groupId, channelId }))
		const groupSelect = document.getElementById('linkGroupSelect')
		if (groupSelect instanceof HTMLSelectElement) {
			const value = `${groupId}\t${channelId}`
			if ([...groupSelect.options].some(opt => opt.value === value))
				groupSelect.value = value
		}
	}

	if (body.poll && Array.isArray(body.poll.options) && body.poll.options.length >= 2) {
		state.pendingPoll = structuredClone(body.poll)
		document.getElementById('pollComposerToggle')?.classList.add('active')
		const pollOptions = document.getElementById('pollComposerOptions')
		if (pollOptions instanceof HTMLTextAreaElement)
			pollOptions.value = body.poll.options.join('\n')
		const multi = document.getElementById('pollComposerMulti')
		if (multi instanceof HTMLInputElement)
			multi.checked = Boolean(body.poll.multi)
		if (body.poll.deadline) {
			const deadline = document.getElementById('pollComposerDeadline')
			if (deadline instanceof HTMLInputElement) {
				const d = new Date(body.poll.deadline)
				if (!Number.isNaN(d.getTime()))
					deadline.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
			}
		}
	}

	if (Array.isArray(body.mediaRefs) && body.mediaRefs.length)
		state.pendingMediaRefs = body.mediaRefs.map(ref => ({ ...ref }))
	refreshMediaPreview()
}

/**
 * 设置待关联的群/频道并更新预览。
 * @param {string} groupId 群 id
 * @param {string} channelId 频道 id
 * @param {string} label 展示标签
 * @returns {void}
 */
export function setPendingGroupRef(groupId, channelId, label) {
	state.pendingGroupRef = {
		groupId,
		channelId: channelId || 'default',
		label: label || groupRefLabel({ groupId, channelId }),
	}
	syncGroupRefInComposer(state.pendingGroupRef)
	refreshGroupRefPreview()
}
