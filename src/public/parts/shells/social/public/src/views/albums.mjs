import { createAlbum, deleteAlbum, getAlbumDetail, getEntityAlbums, updateAlbum } from '../endpoints/albums.mjs'
import { buildPostCard } from '../postCard.mjs'
import { viewerEntityHash } from '../state.mjs'
import { openDialogFromTemplate } from '../templates.mjs'
import { bindVisibilityPicker, readVisibilityPicker, renderVisibilityPickerHtml, visibilityDisplay } from '../visibilityPicker.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { mediaRefUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'

/**
 * @param {object | null} coverMediaRef 封面
 * @param {string} displayName 相册名
 * @returns {string} 封面 HTML
 */
function renderAlbumCoverHtml(coverMediaRef, displayName) {
	if (coverMediaRef)
		try {
			const url = mediaRefUrl(coverMediaRef)
			const alt = escapeHtml(String(coverMediaRef.alt || displayName))
			return `<div class="album-card-cover"><img class="album-card-cover-img" src="${escapeHtml(url)}" alt="${alt}" loading="lazy" /></div>`
		}
		catch { /* fall through */ }

	return `<div class="album-card-cover album-card-cover-fallback">${escapeHtml(displayName)}</div>`
}

/**
 * 渲染资料页相册网格。
 * @param {string} entityHash owner
 * @param {HTMLElement} container 容器
 * @returns {Promise<void>}
 */
export async function renderProfileAlbums(entityHash, container) {
	const data = await getEntityAlbums(entityHash)
	const albums = data.albums || []
	const isSelf = viewerEntityHash() === entityHash
	container.replaceChildren()
	if (isSelf) {
		const toolbar = document.createElement('div')
		toolbar.className = 'album-toolbar'
		toolbar.innerHTML = '<button type="button" class="btn btn-primary btn-sm" data-album-create data-i18n="social.profile.albums.create"></button>'
		toolbar.querySelector('[data-album-create]')?.addEventListener('click', () => {
			void openCreateAlbumDialog(() => renderProfileAlbums(entityHash, container))
		})
		container.appendChild(toolbar)
	}
	if (!albums.length) {
		const empty = document.createElement('div')
		empty.className = 'empty'
		empty.dataset.i18n = 'social.profile.albums.empty'
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
		const vis = visibilityDisplay(album.visibility, album.minFollowMs)
		const nameHtml = album.virtual
			? '<strong data-i18n="social.profile.albums.defaultName"></strong>'
			: `<strong>${escapeHtml(album.name)}</strong>`
		const coverFallback = album.virtual
			? '<div class="album-card-cover album-card-cover-fallback" data-i18n="social.profile.albums.defaultName"></div>'
			: renderAlbumCoverHtml(album.coverMediaRef, album.name)
		card.innerHTML = `
			${album.coverMediaRef ? renderAlbumCoverHtml(album.coverMediaRef, album.virtual ? '' : album.name) : coverFallback}
			<div class="album-card-meta">
				${nameHtml}
				<span class="muted"><span class="album-post-count">${album.postCount || 0}</span> · <span data-i18n="${escapeHtml(vis.labelKey)}"></span></span>
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
	const detail = await getAlbumDetail(entityHash, albumId)
	const album = detail.album
	const items = detail.items || []
	const isSelf = viewerEntityHash() === entityHash
	const panel = backContainer || document.getElementById('profileAlbumsPanel')
	if (!panel) return
	panel.replaceChildren()
	const header = document.createElement('div')
	header.className = 'album-detail-header'
	const titleHtml = album.virtual
		? '<h3 data-i18n="social.profile.albums.defaultName"></h3>'
		: `<h3>${escapeHtml(album.name)}</h3>`
	header.innerHTML = `
		<button type="button" class="btn btn-ghost btn-sm" data-album-back data-i18n="social.profile.albums.back"></button>
		${titleHtml}
		<p class="muted">${escapeHtml(album.description || '')}</p>
		${isSelf && !album.virtual ? `
			<div class="album-detail-actions">
				<button type="button" class="btn btn-ghost btn-sm" data-album-edit data-i18n="social.profile.albums.edit"></button>
				<button type="button" class="btn btn-ghost btn-sm" data-album-delete-links data-i18n="social.profile.albums.deleteLinks"></button>
				<button type="button" class="btn btn-error btn-sm" data-album-delete-posts data-i18n="social.profile.albums.deleteWithPosts"></button>
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
		await deleteAlbum(albumId, false)
		await renderProfileAlbums(entityHash, panel)
	})
	header.querySelector('[data-album-delete-posts]')?.addEventListener('click', async () => {
		await deleteAlbum(albumId, true)
		await renderProfileAlbums(entityHash, panel)
	})
	panel.appendChild(header)
	if (!items.length) {
		const empty = document.createElement('div')
		empty.className = 'empty'
		empty.dataset.i18n = 'social.profile.albums.emptyPosts'
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
		titleI18n: 'social.profile.albums.create',
		name: '',
		description: '',
		visibilityPickerHtml: renderVisibilityPickerHtml({ idPrefix: 'albumCreate', selected: 'public' }),
		submitI18n: 'social.profile.albums.create',
	})
	bindVisibilityPicker(dialog)
	dialog.querySelector('[data-album-submit]')?.addEventListener('click', async () => {
		const name = /** @type {HTMLInputElement} */dialog.querySelector('[data-album-name]')?.value?.trim()
		const description = /** @type {HTMLTextAreaElement} */dialog.querySelector('[data-album-description]')?.value?.trim() || ''
		if (!name) return
		await createAlbum({
			name,
			description,
			...readVisibilityPicker(dialog),
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
		titleI18n: 'social.profile.albums.edit',
		name: album.name || '',
		description: album.description || '',
		visibilityPickerHtml: renderVisibilityPickerHtml({
			idPrefix: 'albumEdit',
			selected,
			allow: (album.allow || []).join(' '),
			except: (album.except || []).join(' '),
		}),
		submitI18n: 'social.profile.albums.save',
	})
	bindVisibilityPicker(dialog)
	dialog.querySelector('[data-album-submit]')?.addEventListener('click', async () => {
		const name = /** @type {HTMLInputElement} */dialog.querySelector('[data-album-name]')?.value?.trim()
		const description = /** @type {HTMLTextAreaElement} */dialog.querySelector('[data-album-description]')?.value?.trim() || ''
		if (!name) return
		await updateAlbum(album.albumId, {
			name,
			description,
			...readVisibilityPicker(dialog),
		})
		dialog.close()
		await onDone()
	})
}
