import { socialApi, viewerEntityHash } from '../lib/apiClient.mjs'
import { buildPostCard } from '../postCard.mjs'
import { bindVisibilityPicker, readVisibilityPicker, renderVisibilityPickerHtml } from '../visibilityPicker.mjs'
import { openDialogFromTemplate } from '/scripts/features/dialog.mjs'
import { geti18n } from '/scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/**
 * 渲染资料页相册网格。
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileAlbums(entityHash, container) {
	const data = await socialApi(`/albums/${entityHash}`)
	const albums = data.albums || []
	const isSelf = viewerEntityHash() === entityHash
	container.replaceChildren()
	if (isSelf) {
		const toolbar = document.createElement('div')
		toolbar.className = 'album-toolbar'
		toolbar.innerHTML = `<button type="button" class="btn btn-primary btn-sm" data-album-create>${escapeHtml(geti18n('social.albums.create'))}</button>`
		toolbar.querySelector('[data-album-create]')?.addEventListener('click', () => {
			void openCreateAlbumDialog(() => renderProfileAlbums(entityHash, container))
		})
		container.appendChild(toolbar)
	}
	if (!albums.length) {
		const empty = document.createElement('div')
		empty.className = 'empty'
		empty.textContent = geti18n('social.albums.empty')
		container.appendChild(empty)
		return
	}
	const grid = document.createElement('div')
	grid.className = 'album-grid'
	for (const album of albums) {
		const card = document.createElement('button')
		card.type = 'button'
		card.className = 'album-card'
		card.dataset.albumOpen = entityHash
		card.dataset.albumId = album.albumId
		const displayName = album.virtual ? geti18n('social.albums.defaultName') : album.name
		const visKey = album.visibility === 'followers_since' ? 'followers7d' : (album.visibility || 'public')
		card.innerHTML = `
			<div class="album-card-cover">${escapeHtml(displayName)}</div>
			<div class="album-card-meta">
				<strong>${escapeHtml(displayName)}</strong>
				<span class="muted">${album.postCount || 0} · ${escapeHtml(geti18n(`social.visibility.${visKey}`))}</span>
			</div>
		`
		card.addEventListener('click', () => {
			void openAlbumDetail(entityHash, album.albumId, container)
		})
		grid.appendChild(card)
	}
	container.appendChild(grid)
}

/**
 * 打开相册详情（成员帖列表）。
 * @param {string} entityHash owner
 * @param {string} albumId 相册
 * @param {HTMLElement} [backContainer] 返回时刷新的容器
 * @returns {Promise<void>}
 */
export async function openAlbumDetail(entityHash, albumId, backContainer = null) {
	const detail = await socialApi(`/albums/${entityHash}/${albumId}`)
	const album = detail.album
	const items = detail.items || []
	const isSelf = viewerEntityHash() === entityHash
	const panel = backContainer || document.getElementById('profileAlbumsPanel')
	if (!panel) return
	panel.replaceChildren()
	const header = document.createElement('div')
	header.className = 'album-detail-header'
	header.innerHTML = `
		<button type="button" class="btn btn-ghost btn-sm" data-album-back>${escapeHtml(geti18n('social.albums.back'))}</button>
		<h3>${escapeHtml(album.name)}</h3>
		<p class="muted">${escapeHtml(album.description || '')}</p>
		${isSelf && !album.virtual ? `
			<div class="album-detail-actions">
				<button type="button" class="btn btn-ghost btn-sm" data-album-edit>${escapeHtml(geti18n('social.albums.edit'))}</button>
				<button type="button" class="btn btn-ghost btn-sm" data-album-delete-links>${escapeHtml(geti18n('social.albums.deleteLinks'))}</button>
				<button type="button" class="btn btn-error btn-sm" data-album-delete-posts>${escapeHtml(geti18n('social.albums.deleteWithPosts'))}</button>
			</div>
		` : ''}
	`
	header.querySelector('[data-album-back]')?.addEventListener('click', () => {
		void renderProfileAlbums(entityHash, panel)
	})
	header.querySelector('[data-album-edit]')?.addEventListener('click', () => {
		void openEditAlbumDialog(album, () => openAlbumDetail(entityHash, albumId, panel))
	})
	header.querySelector('[data-album-delete-links]')?.addEventListener('click', async () => {
		await socialApi(`/albums/${albumId}?deletePosts=0`, { method: 'DELETE' })
		await renderProfileAlbums(entityHash, panel)
	})
	header.querySelector('[data-album-delete-posts]')?.addEventListener('click', async () => {
		await socialApi(`/albums/${albumId}?deletePosts=1`, { method: 'DELETE' })
		await renderProfileAlbums(entityHash, panel)
	})
	panel.appendChild(header)
	if (!items.length) {
		const empty = document.createElement('div')
		empty.className = 'empty'
		empty.textContent = geti18n('social.albums.emptyPosts')
		panel.appendChild(empty)
		return
	}
	const list = document.createElement('div')
	list.className = 'album-posts'
	for (const item of items)
		list.appendChild(await buildPostCard(item))
	panel.appendChild(list)
}

/**
 * @param {() => Promise<void>} onDone 完成回调
 * @returns {Promise<void>}
 */
async function openCreateAlbumDialog(onDone) {
	const dialog = await openDialogFromTemplate('album_edit_dialog', {
		title: geti18n('social.albums.create'),
		name: '',
		description: '',
		visibilityPickerHtml: renderVisibilityPickerHtml({ idPrefix: 'albumCreate', selected: 'public' }),
		submitLabel: geti18n('social.albums.create'),
	})
	bindVisibilityPicker(dialog)
	dialog.querySelector('[data-album-submit]')?.addEventListener('click', async () => {
		const name = /** @type {HTMLInputElement} */(dialog.querySelector('[data-album-name]'))?.value?.trim()
		const description = /** @type {HTMLTextAreaElement} */(dialog.querySelector('[data-album-description]'))?.value?.trim() || ''
		if (!name) return
		await socialApi('/albums', {
			method: 'POST',
			body: JSON.stringify({
				name,
				description,
				...readVisibilityPicker(dialog),
			}),
		})
		dialog.close()
		await onDone()
	})
}

/**
 * @param {object} album 相册
 * @param {() => Promise<void>} onDone 完成回调
 * @returns {Promise<void>}
 */
async function openEditAlbumDialog(album, onDone) {
	let selected = album.visibility || 'public'
	if (selected === 'followers_since') {
		const day = 24 * 60 * 60 * 1000
		selected = (album.minFollowMs || 0) >= 30 * day ? 'followers_30d' : 'followers_7d'
	}
	const dialog = await openDialogFromTemplate('album_edit_dialog', {
		title: geti18n('social.albums.edit'),
		name: album.name || '',
		description: album.description || '',
		visibilityPickerHtml: renderVisibilityPickerHtml({
			idPrefix: 'albumEdit',
			selected,
			allow: (album.allow || []).join(' '),
			except: (album.except || []).join(' '),
		}),
		submitLabel: geti18n('social.albums.save'),
	})
	bindVisibilityPicker(dialog)
	dialog.querySelector('[data-album-submit]')?.addEventListener('click', async () => {
		const name = /** @type {HTMLInputElement} */(dialog.querySelector('[data-album-name]'))?.value?.trim()
		const description = /** @type {HTMLTextAreaElement} */(dialog.querySelector('[data-album-description]'))?.value?.trim() || ''
		if (!name) return
		await socialApi(`/albums/${album.albumId}/update`, {
			method: 'POST',
			body: JSON.stringify({
				name,
				description,
				...readVisibilityPicker(dialog),
			}),
		})
		dialog.close()
		await onDone()
	})
}
