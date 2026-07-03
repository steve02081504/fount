import { mountTemplate } from '../../../../scripts/features/template.mjs'
import {
	formatGroupRefMarkdownToken,
	groupRefLabel,
	renderGroupRefBlockHtml,
	stripGroupRefMarkdownTokens,
} from '../shared/groupRef.mjs'

import { uploadSocialMedia } from './media.mjs'
import { renderMediaPreview } from './mediaRender.mjs'

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
 * 从 composer 表单构建发帖 API 请求体。
 * @param {object} appContext 应用上下文
 * @returns {object} 发帖 body
 */
export function buildPostBody(appContext) {
	const body = {
		text: document.getElementById('postText').value.trim(),
		mediaRefs: appContext.state.pendingMediaRefs,
		visibility: document.getElementById('postVisibility').value,
		lang: document.getElementById('postLang').value.trim() || 'zh-CN',
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
	)
}

/**
 * 上传并追加 composer 媒体附件。
 * @param {object} appContext 应用上下文
 * @param {FileList} files 媒体文件
 * @returns {Promise<void>}
 */
export async function addComposerMedia(appContext, files) {
	appContext.state.pendingMediaRefs.push(...await uploadSocialMedia(files))
	refreshMediaPreview(appContext)
}

/**
 * 提交发帖请求并清空 composer 状态。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function publishPost(appContext) {
	const body = buildPostBody(appContext)
	if (!body.text && !appContext.state.pendingMediaRefs.length) return
	await appContext.socialApi('/posts', { method: 'POST', body: JSON.stringify(body) })
	const postText = document.getElementById('postText')
	if (postText instanceof HTMLTextAreaElement)
		postText.value = ''
	appContext.state.pendingMediaRefs = []
	appContext.state.pendingQuoteRef = null
	appContext.state.pendingGroupRef = null
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
