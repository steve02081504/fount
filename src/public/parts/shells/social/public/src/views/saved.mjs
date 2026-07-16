import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'
import { formatSocialProfileHref } from '../../shared/runUri.mjs'
import { formatActionKey } from '../lib/actionKey.mjs'
import { socialApi } from '../lib/apiClient.mjs'
import { runSocialWrite } from '../lib/socialWrite.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { socialState } from '../state.mjs'

/**
 * 关闭收藏帖模态框。
 * @returns {void}
 */
export function closeSaveModal() {
	socialState.pendingSave = null
	document.getElementById('saveModal')?.classList.add('hidden')
}

/**
 * 打开收藏帖模态框并填充文件夹选项。
 * @param {string} entityHash 作者
 * @param {string} postId 帖子
 * @param {HTMLElement} button 按钮
 * @returns {Promise<void>}
 */
export async function openSaveModal(entityHash, postId, button) {
	socialState.pendingSave = { entityHash, postId, button }
	const modal = document.getElementById('saveModal')
	const select = document.getElementById('saveFolderSelect')
	if (!modal || !select) return
	select.innerHTML = `<option value="">${escapeHtml(geti18n('social.saved.unfiled'))}</option>`
	modal.classList.remove('hidden')
	const savedData = await socialApi('/saved-posts').catch(() => ({ folders: {} }))
	socialState.savedFoldersCache = savedData.folders || {}
	for (const [folderId, folder] of Object.entries(socialState.savedFoldersCache)) {
		const option = document.createElement('option')
		option.value = folderId
		option.textContent = folder.name || folderId
		select.appendChild(option)
	}
}

/**
 * 确认收藏当前帖子到选定文件夹。
 * @returns {Promise<void>}
 */
export async function confirmSaveModal() {
	if (!socialState.pendingSave) return
	const folderId = document.getElementById('saveFolderSelect')?.value || undefined
	const { button } = socialState.pendingSave
	const prevText = button.textContent
	button.textContent = geti18n('social.actions.saved')
	try {
		await runSocialWrite('save', () => socialApi('/saved-posts/add', {
			method: 'POST',
			body: JSON.stringify({
				entityHash: socialState.pendingSave.entityHash,
				postId: socialState.pendingSave.postId,
				folderId: folderId || undefined,
			}),
		}))
		closeSaveModal()
	}
	catch {
		button.textContent = prevText
	}
}

/**
 * @param {string | undefined} name 展示名
 * @param {string} entityHash entityHash
 * @returns {string} 作者展示片段
 */
function savedAuthorLabel(name, entityHash) {
	const label = name || formatHashShort(entityHash, { headLen: 8, tailLen: 0 })
	return escapeHtml(label)
}

/**
 * @param {string | undefined} preview 预览
 * @param {string} postId 帖子 id
 * @returns {string} 预览片段
 */
function savedPreviewLabel(preview, postId) {
	const label = preview || `${postId.slice(0, 8)}…`
	return escapeHtml(label)
}

/**
 * 加载并渲染收藏帖与文件夹视图。
 * @returns {Promise<void>}
 */
export async function loadSaved() {
	const data = await socialApi('/saved-posts')
	socialState.savedFoldersCache = data.folders || {}
	const container = document.getElementById('savedView')
	container.innerHTML = `
		<div class="saved-toolbar card">
			<input type="text" id="newFolderName" placeholder="${escapeHtml(geti18n('social.saved.newFolderPlaceholder'))}" />
			<button type="button" id="createFolderButton">${escapeHtml(geti18n('social.saved.createFolder'))}</button>
		</div>
	`
	if (Object.keys(data.folders || {}).length) {
		container.innerHTML += `<h2 class="section-title">${escapeHtml(geti18n('social.saved.folders'))}</h2>`
		for (const [folderId, folder] of Object.entries(data.folders)) {
			const block = document.createElement('div')
			block.className = 'card saved-folder-card'
			block.innerHTML = `
				<div class="saved-folder-header">
					<h3>${escapeHtml(folder.name || folderId)}</h3>
					<div class="saved-folder-actions">
						<button type="button" class="link-btn" data-rename-folder="${escapeHtml(folderId)}">${escapeHtml(geti18n('social.saved.renameFolder'))}</button>
						<button type="button" class="link-btn" data-delete-folder="${escapeHtml(folderId)}">${escapeHtml(geti18n('social.saved.deleteFolder'))}</button>
					</div>
				</div>
			`
			for (const ref of folder.posts || []) {
				const actionKey = formatActionKey(ref.entityHash, ref.postId)
				const row = document.createElement('div')
				row.className = 'saved-row'
				row.innerHTML = `
					<a href="${escapeHtml(formatSocialProfileHref(ref.entityHash, ref.postId))}" class="saved-link link-btn">
						<strong>${savedAuthorLabel(ref.authorName, ref.entityHash)}</strong>
						<span class="saved-preview">${savedPreviewLabel(ref.preview, ref.postId)}</span>
					</a>
					<button type="button" class="link-btn" data-remove-saved="${escapeHtml(actionKey)}" data-saved-folder="${escapeHtml(folderId)}">${escapeHtml(geti18n('social.saved.remove'))}</button>
				`
				block.appendChild(row)
			}
			container.appendChild(block)
		}
	}
	container.innerHTML += `<h2 class="section-title">${escapeHtml(geti18n('social.saved.unfiled'))}</h2>`
	for (const ref of data.unfiled || []) {
		const actionKey = formatActionKey(ref.entityHash, ref.postId)
		const row = document.createElement('div')
		row.className = 'card saved-row'
		row.innerHTML = `
			<a href="${escapeHtml(formatSocialProfileHref(ref.entityHash, ref.postId))}" class="saved-link link-btn">
				<strong>${savedAuthorLabel(ref.authorName, ref.entityHash)}</strong>
				<span class="saved-preview">${savedPreviewLabel(ref.preview, ref.postId)}</span>
			</a>
			<button type="button" class="link-btn" data-remove-saved="${escapeHtml(actionKey)}">${escapeHtml(geti18n('social.saved.remove'))}</button>
		`
		container.appendChild(row)
	}
	if (!Object.keys(data.folders || {}).length && !(data.unfiled || []).length)
		container.innerHTML += `<div class="empty">${escapeHtml(geti18n('social.empty.saved'))}</div>`
}
