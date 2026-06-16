import { formatSocialProfileHref } from '../lib/runUri.mjs'

/**
 * 关闭收藏帖模态框。
 * @param {object} appContext 应用上下文
 * @returns {void}
 */
export function closeSaveModal(appContext) {
	appContext.state.pendingSave = null
	document.getElementById('saveModal')?.classList.add('hidden')
}

/**
 * 打开收藏帖模态框并填充文件夹选项。
 * @param {object} appContext 应用上下文
 * @param {string} entityHash 作者
 * @param {string} postId 帖子
 * @param {HTMLElement} button 按钮
 * @returns {Promise<void>}
 */
export async function openSaveModal(appContext, entityHash, postId, button) {
	const savedData = await appContext.socialApi('/saved-posts').catch(() => ({ folders: {} }))
	appContext.state.savedFoldersCache = savedData.folders || {}
	appContext.state.pendingSave = { entityHash, postId, button }
	const select = document.getElementById('saveFolderSelect')
	if (!select) return
	select.innerHTML = `<option value="">${appContext.geti18n('social.saved.unfiled')}</option>`
	for (const [folderId, folder] of Object.entries(appContext.state.savedFoldersCache)) {
		const option = document.createElement('option')
		option.value = folderId
		option.textContent = folder.name || folderId
		select.appendChild(option)
	}
	document.getElementById('saveModal')?.classList.remove('hidden')
}

/**
 * 确认收藏当前帖子到选定文件夹。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function confirmSaveModal(appContext) {
	if (!appContext.state.pendingSave) return
	const folderId = document.getElementById('saveFolderSelect')?.value || undefined
	await appContext.socialApi('/saved-posts/add', {
		method: 'POST',
		body: JSON.stringify({
			entityHash: appContext.state.pendingSave.entityHash,
			postId: appContext.state.pendingSave.postId,
			folderId: folderId || undefined,
		}),
	})
	appContext.state.pendingSave.button.textContent = appContext.geti18n('social.actions.saved')
	closeSaveModal(appContext)
}

/**
 * 加载并渲染收藏帖与文件夹视图。
 * @param {object} appContext 应用上下文
 * @returns {Promise<void>}
 */
export async function loadSaved(appContext) {
	const data = await appContext.socialApi('/saved-posts')
	appContext.state.savedFoldersCache = data.folders || {}
	const container = document.getElementById('savedView')
	container.innerHTML = `
		<div class="saved-toolbar card">
			<input type="text" id="newFolderName" placeholder="${appContext.geti18n('social.saved.newFolderPlaceholder')}" />
			<button type="button" id="createFolderBtn">${appContext.geti18n('social.saved.createFolder')}</button>
		</div>
	`
	if (Object.keys(data.folders || {}).length) {
		container.innerHTML += `<h2 class="section-title">${appContext.geti18n('social.saved.folders')}</h2>`
		for (const [folderId, folder] of Object.entries(data.folders)) {
			const block = document.createElement('div')
			block.className = 'card saved-folder-card'
			block.innerHTML = `
				<div class="saved-folder-header">
					<h3>${folder.name || folderId}</h3>
					<div class="saved-folder-actions">
						<button type="button" class="link-btn" data-rename-folder="${folderId}">${appContext.geti18n('social.saved.renameFolder')}</button>
						<button type="button" class="link-btn" data-delete-folder="${folderId}">${appContext.geti18n('social.saved.deleteFolder')}</button>
					</div>
				</div>
			`
			for (const ref of folder.posts || []) {
				const row = document.createElement('div')
				row.className = 'saved-row'
				row.innerHTML = `
					<a href="${formatSocialProfileHref(ref.entityHash, ref.postId)}" class="saved-link link-btn">
						<strong>${ref.authorName || ref.entityHash.slice(0, 8)}…</strong>
						<span class="saved-preview">${ref.preview || ref.postId.slice(0, 8)}…</span>
					</a>
					<button type="button" class="link-btn" data-remove-saved="${ref.entityHash}:${ref.postId}" data-saved-folder="${folderId}">${appContext.geti18n('social.saved.remove')}</button>
				`
				block.appendChild(row)
			}
			container.appendChild(block)
		}
	}
	container.innerHTML += `<h2 class="section-title">${appContext.geti18n('social.saved.unfiled')}</h2>`
	for (const ref of data.unfiled || []) {
		const row = document.createElement('div')
		row.className = 'card saved-row'
		row.innerHTML = `
			<a href="${formatSocialProfileHref(ref.entityHash, ref.postId)}" class="saved-link link-btn">
				<strong>${ref.authorName || ref.entityHash.slice(0, 8)}…</strong>
				<span class="saved-preview">${ref.preview || ref.postId.slice(0, 8)}…</span>
			</a>
			<button type="button" class="link-btn" data-remove-saved="${ref.entityHash}:${ref.postId}">${appContext.geti18n('social.saved.remove')}</button>
		`
		container.appendChild(row)
	}
	if (!Object.keys(data.folders || {}).length && !(data.unfiled || []).length)
		container.innerHTML += `<div class="empty">${appContext.geti18n('social.empty.saved')}</div>`
}
