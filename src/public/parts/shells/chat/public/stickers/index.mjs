/**
 * 【文件】public/stickers/index.mjs
 * 【职责】贴纸商店页 UI：包列表、搜索、创建/上传、安装收藏与默认包初始化。
 * 【原理】fetch stickers API；模板渲染 pack 卡片；tab 切换 all/mine/collection；viewer entityHash 鉴权作者操作。
 * 【数据结构】currentEntityHash、allPacks、userCollection、currentTab、currentPackId。
 * 【关联】/api/parts/shells:chat/stickers/*；template.mjs、i18n；Hub 表情引用。
 */
import { confirmI18n, initTranslations } from '../../../scripts/i18n.mjs'
import {
	mountTemplate,
	renderTemplate,
	renderTemplateAsHtmlString,
	usingTemplates,
} from '../../../scripts/template.mjs'
import { applyTheme } from '../../../scripts/theme.mjs'
import { showToastI18n } from '../../../scripts/toast.mjs'
let currentEntityHash = null
let allPacks = []
let userCollection = null
let currentTab = 'all'
let currentPackId = null

/**
 * 初始化贴纸商店页面
 */
async function init() {
	usingTemplates('/parts/shells:chat/src/templates')
	applyTheme()
	await initTranslations('stickers')

	try {
		const resp = await fetch('/api/p2p/viewer', { credentials: 'include' })
		if (resp.ok) {
			const data = await resp.json()
			currentEntityHash = data.viewerEntityHash || null
		}
	} catch (error) {
		console.error('Failed to load viewer:', error)
	}

	setupEventListeners()
	await loadPacks()
	await loadUserCollection()
	await initializeDefaultPacks()
}

/**
 * 初始化默认贴纸包
 */
async function initializeDefaultPacks() {
	try {
		const response = await fetch('/api/parts/shells:chat/stickers/packs', {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			if (data.packs?.length === 0)
				await createDefaultPack()
		}
	} catch (error) {
		console.error('Failed to initialize default packs:', error)
	}
}

/**
 * 创建默认贴纸包
 */
async function createDefaultPack() {
	try {
		const response = await fetch('/api/parts/shells:chat/stickers/packs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				name: '',
				description: '',
				isPublic: true,
				useDefaultLocaleNames: true,
			})
		})

		if (response.ok)
			await loadPacks()
	} catch (error) {
		console.error('Failed to create default pack:', error)
	}
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
	document.getElementById('sticker-create-pack-button').addEventListener('click', () => {
		document.getElementById('create-pack-modal').showModal()
	})

	document.getElementById('sticker-upload-button').addEventListener('click', async () => {
		await loadUserPacks()
		document.getElementById('upload-sticker-modal').showModal()
	})

	document.getElementById('create-pack-form').addEventListener('submit', handleCreatePack)
	document.getElementById('upload-sticker-form').addEventListener('submit', handleUploadSticker)
	document.getElementById('search-input').addEventListener('input', handleSearch)

	document.querySelectorAll('.tabs .tab').forEach(tab => {
		tab.addEventListener('click', (clickEvent) => {
			switchTab(clickEvent.target.dataset.tab)
		})
	})

	document.getElementById('sticker-install-pack-button').addEventListener('click', handleInstallPack)
	document.getElementById('sticker-uninstall-pack-button').addEventListener('click', handleUninstallPack)
	document.getElementById('sticker-delete-pack-button').addEventListener('click', handleDeletePack)

	for (const closeModalButton of document.querySelectorAll('[data-close-modal]'))
		closeModalButton.addEventListener('click', () => {
			document.getElementById(closeModalButton.dataset.closeModal).close()
		})

}

/**
 * 加载贴纸包列表
 */
async function loadPacks() {
	try {
		const response = await fetch('/api/parts/shells:chat/stickers/packs', {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			allPacks = data.packs || []
			await renderPacks(allPacks)
		}
	} catch (error) {
		console.error('Failed to load packs:', error)
		showToastI18n('error', 'stickers.errors.loadFailed')
	}
}

/**
 * 加载用户收藏
 */
async function loadUserCollection() {
	if (!currentEntityHash) return

	try {
		const response = await fetch('/api/parts/shells:chat/stickers/collection', {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			userCollection = data.collection
		}
	} catch (error) {
		console.error('Failed to load user collection:', error)
	}
}

/**
 * 加载用户的贴纸包
 */
async function loadUserPacks() {
	const select = document.getElementById('select-pack')
	const userPacks = allPacks.filter(pack => pack.authorEntityHash === currentEntityHash)
	select.innerHTML = await renderTemplateAsHtmlString('stickers/pack_select_options', {
		packs: userPacks.map(pack => ({ packId: pack.packId, name: pack.name })),
		escapeHtml,
	})
}

/**
 * 渲染贴纸包列表
 * @param {Array} packs - 贴纸包列表
 */
async function renderPacks(packs) {
	const container = document.getElementById('packs-container')
	const emptyState = document.getElementById('empty-state')
	container.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6'

	if (packs.length === 0) {
		container.replaceChildren()
		emptyState.classList.remove('hidden')
		return
	}

	emptyState.classList.add('hidden')
	container.replaceChildren()

	for (const pack of packs) {
		const card = document.createElement('div')
		card.className = 'card bg-base-200 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer'
		card.dataset.packId = pack.packId

		const isInstalled = userCollection?.installedPacks.includes(pack.packId)
		const descriptionHtml = pack.description
			? escapeHtml(pack.description)
			: '<span data-i18n="stickers.noDescription"></span>'

		card.appendChild(await renderTemplate('stickers/pack_card', {
			name: pack.name,
			hasThumbnail: !!pack.thumbnail,
			thumbnail: pack.thumbnail || '',
			descriptionHtml,
			stickerCount: pack.stickers.length,
			isInstalled: !!isInstalled,
			isMine: pack.authorEntityHash === currentEntityHash,
			escapeHtml,
		}))

		card.addEventListener('click', () => showPackDetail(pack.packId))
		container.appendChild(card)
	}
}

/**
 * 显示贴纸包详情
 * @param {string} packId - 贴纸包ID
 */
async function showPackDetail(packId) {
	try {
		const response = await fetch(`/api/parts/shells:chat/stickers/packs/${packId}`, {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			if (data.pack) {
				currentPackId = packId
				await renderPackDetail(data.pack)
				document.getElementById('pack-detail-modal').showModal()
			}
		}
	} catch (error) {
		console.error('Failed to load pack detail:', error)
		showToastI18n('error', 'stickers.loadDetailFailed')
	}
}

/**
 * 渲染贴纸包详情
 * @param {object} pack - 贴纸包
 */
async function renderPackDetail(pack) {
	document.getElementById('detail-pack-name').textContent = pack.name

	const descriptionEl = document.getElementById('detail-pack-description')
	if (pack.description) {
		descriptionEl.textContent = pack.description
		descriptionEl.removeAttribute('data-i18n')
	} else {
		descriptionEl.textContent = ''
		descriptionEl.dataset.i18n = 'stickers.noDescription'
	}

	const authorEl = document.getElementById('detail-pack-author')
	authorEl.dataset.i18n = 'stickers.authorLabel'
	authorEl.dataset.author = pack.authorEntityHash

	const countEl = document.getElementById('detail-pack-count')
	countEl.dataset.i18n = 'stickers.stickerCount'
	countEl.dataset.count = String(pack.stickers.length)

	const stickersContainer = document.getElementById('detail-stickers-container')
	stickersContainer.innerHTML = ''

	if (pack.stickers.length === 0)
		await mountTemplate(stickersContainer, 'stickers/empty_detail', {})
	else {
		stickersContainer.replaceChildren()
		for (const sticker of pack.stickers) {
			const favorited = userCollection?.favoriteStickers?.includes(sticker.id)
			const stickerDiv = document.createElement('div')
			stickerDiv.className = 'relative aspect-square bg-base-300 rounded-lg p-2 hover:bg-base-100 transition-colors cursor-pointer'
			stickerDiv.appendChild(await renderTemplate('stickers/detail_sticker', {
				url: sticker.url,
				name: sticker.name,
				escapeHtml,
			}))
			const favoriteButton = document.createElement('button')
			favoriteButton.type = 'button'
			favoriteButton.className = 'btn btn-circle btn-xs absolute top-1 right-1'
			favoriteButton.textContent = favorited ? '♥' : '♡'
			favoriteButton.addEventListener('click', (clickEvent) => {
				clickEvent.stopPropagation()
				void toggleStickerFavorite(sticker.id, !!favorited)
			})
			stickerDiv.appendChild(favoriteButton)
			stickersContainer.appendChild(stickerDiv)
		}
	}

	const isInstalled = userCollection?.installedPacks.includes(pack.packId)
	const installPackButton = document.getElementById('sticker-install-pack-button')
	const uninstallPackButton = document.getElementById('sticker-uninstall-pack-button')

	installPackButton.classList.toggle('hidden', isInstalled)
	uninstallPackButton.classList.toggle('hidden', !isInstalled)

	document.getElementById('sticker-delete-pack-button').classList.toggle('hidden', pack.authorEntityHash !== currentEntityHash)
}

/**
 * 处理创建贴纸包
 * @param {Event} e - 表单提交事件
 */
async function handleCreatePack(e) {
	e.preventDefault()

	const name = document.getElementById('pack-name').value.trim()
	const description = document.getElementById('pack-description').value.trim()
	const isPublic = document.getElementById('pack-public').checked

	if (!name) {
		showToastI18n('error', 'stickers.nameRequired')
		return
	}

	try {
		const response = await fetch('/api/parts/shells:chat/stickers/packs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				name,
				description,
				isPublic
			})
		})

		if (response.ok) {
			showToastI18n('success', 'stickers.success.created')
			document.getElementById('create-pack-modal').close()
			document.getElementById('create-pack-form').reset()
			await loadPacks()
		} else
			showToastI18n('error', 'stickers.errors.createFailed')
	} catch (error) {
		console.error('Failed to create pack:', error)
		showToastI18n('error', 'stickers.errors.createFailed')
	}
}

/**
 * 处理上传贴纸
 * @param {Event} e - 表单提交事件
 */
async function handleUploadSticker(e) {
	e.preventDefault()

	const packId = document.getElementById('select-pack').value
	const name = document.getElementById('sticker-name').value.trim()
	const file = document.getElementById('sticker-file').files[0]
	const tags = document.getElementById('sticker-tags').value.trim()

	if (!packId) {
		showToastI18n('error', 'stickers.selectPackRequired')
		return
	}

	if (!name) {
		showToastI18n('error', 'stickers.stickerNameRequired')
		return
	}

	if (!file) {
		showToastI18n('error', 'stickers.fileRequired')
		return
	}

	try {
		const formData = new FormData()
		formData.append('sticker', file)
		formData.append('name', name)
		formData.append('tags', JSON.stringify(tags.split(',').map(t => t.trim()).filter(t => t)))

		const response = await fetch(`/api/parts/shells:chat/stickers/packs/${packId}/stickers`, {
			method: 'POST',
			credentials: 'include',
			body: formData
		})

		if (response.ok) {
			showToastI18n('success', 'stickers.success.uploaded')
			document.getElementById('upload-sticker-modal').close()
			document.getElementById('upload-sticker-form').reset()
			await loadPacks()
		} else
			showToastI18n('error', 'stickers.errors.uploadFailed')
	} catch (error) {
		console.error('Failed to upload sticker:', error)
		showToastI18n('error', 'stickers.errors.uploadFailed')
	}
}

/**
 * 处理安装贴纸包
 */
async function handleInstallPack() {
	if (!currentPackId) return

	try {
		const response = await fetch(`/api/parts/shells:chat/stickers/install/${currentPackId}`, {
			method: 'POST',
			credentials: 'include'
		})

		if (response.ok) {
			showToastI18n('success', 'stickers.success.installed')
			await loadUserCollection()
			await loadPacks()
			document.getElementById('pack-detail-modal').close()
		} else
			showToastI18n('error', 'stickers.errors.installFailed')
	} catch (error) {
		console.error('Failed to install pack:', error)
		showToastI18n('error', 'stickers.errors.installFailed')
	}
}

/**
 * 处理卸载贴纸包
 */
async function handleUninstallPack() {
	if (!currentPackId) return

	try {
		const response = await fetch(`/api/parts/shells:chat/stickers/uninstall/${currentPackId}`, {
			method: 'POST',
			credentials: 'include'
		})

		if (response.ok) {
			showToastI18n('success', 'stickers.success.uninstalled')
			await loadUserCollection()
			await loadPacks()
			document.getElementById('pack-detail-modal').close()
		} else
			showToastI18n('error', 'stickers.errors.uninstallFailed')
	} catch (error) {
		console.error('Failed to uninstall pack:', error)
		showToastI18n('error', 'stickers.errors.uninstallFailed')
	}
}

/**
 * 处理删除贴纸包
 */
async function handleDeletePack() {
	if (!currentPackId) return
	if (!await confirmI18n('stickers.deleteConfirm')) return

	try {
		const response = await fetch(`/api/parts/shells:chat/stickers/packs/${currentPackId}`, {
			method: 'DELETE',
			credentials: 'include'
		})

		if (response.ok) {
			showToastI18n('success', 'stickers.success.deleted')
			document.getElementById('pack-detail-modal').close()
			await loadUserCollection()
			await loadPacks()
		} else {
			const data = await response.json()
			showToastI18n('error', 'stickers.errors.deleteFailed', { error: data.error })
		}
	} catch (error) {
		console.error('Failed to delete pack:', error)
		showToastI18n('error', 'stickers.errors.deleteFailed')
	}
}

/**
 * 处理搜索
 * @param {Event} e - 输入事件
 */
async function handleSearch(e) {
	const query = e.target.value.toLowerCase().trim()

	if (!query) {
		await filterPacksByTab()
		return
	}

	const filtered = allPacks.filter(pack =>
		pack.name.toLowerCase().includes(query) ||
		pack.description.toLowerCase().includes(query)
	)

	await renderPacks(filtered)
}

/**
 * 切换标签页
 * @param {string} tabName - 标签页名称
 */
function switchTab(tabName) {
	currentTab = tabName

	document.querySelectorAll('.tabs .tab').forEach(tab => {
		tab.classList.toggle('tab-active', tab.dataset.tab === tabName)
	})

	void filterPacksByTab()
}

/**
 * 根据标签页过滤贴纸包
 */
async function filterPacksByTab() {
	let filtered = []

	switch (currentTab) {
		case 'all':
			filtered = allPacks
			break
		case 'installed':
			filtered = allPacks.filter(pack => userCollection?.installedPacks.includes(pack.packId))
			break
		case 'my-packs':
			filtered = allPacks.filter(pack => pack.authorEntityHash === currentEntityHash)
			break
		case 'favorites':
			await renderFavoriteStickers()
			return
	}

	await renderPacks(filtered)
}

/**
 * 切换贴纸收藏状态。
 * @param {string} stickerId 贴纸 ID
 * @param {boolean} favorited 当前是否已收藏
 * @returns {Promise<void>}
 */
async function toggleStickerFavorite(stickerId, favorited) {
	if (!currentEntityHash) return
	const method = favorited ? 'DELETE' : 'POST'
	const response = await fetch(
		`/api/parts/shells:chat/stickers/favorites/${encodeURIComponent(stickerId)}`,
		{ method, credentials: 'include' },
	)
	if (!response.ok) {
		showToastI18n('error', 'stickers.errors.loadFailed')
		return
	}
	await loadUserCollection()
	if (currentTab === 'favorites')
		await renderFavoriteStickers()
}

/**
 * 从已安装贴纸包收集贴纸元数据。
 * @returns {Promise<Map<string, object>>} stickerId → sticker
 */
async function collectInstalledStickers() {
	/** @type {Map<string, object>} */
	const byId = new Map()
	for (const packId of userCollection?.installedPacks || [])
		try {
			const response = await fetch(`/api/parts/shells:chat/stickers/packs/${encodeURIComponent(packId)}`, {
				credentials: 'include',
			})
			if (!response.ok) continue
			const data = await response.json()
			if (!data.pack?.stickers) continue
			for (const sticker of data.pack.stickers)
				byId.set(sticker.id, sticker)
		}
		catch { /* skip */ }

	return byId
}

/**
 * 渲染收藏贴纸网格。
 * @returns {Promise<void>}
 */
async function renderFavoriteStickers() {
	const container = document.getElementById('packs-container')
	const emptyState = document.getElementById('empty-state')
	const ids = userCollection?.favoriteStickers || []
	if (!ids.length) {
		container.replaceChildren()
		emptyState.classList.remove('hidden')
		return
	}
	const byId = await collectInstalledStickers()
	const stickers = ids.map(id => byId.get(id)).filter(Boolean)
	if (!stickers.length) {
		container.replaceChildren()
		emptyState.classList.remove('hidden')
		return
	}
	emptyState.classList.add('hidden')
	container.replaceChildren()
	container.className = 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4'
	for (const sticker of stickers) {
		const favorited = userCollection.favoriteStickers.includes(sticker.id)
		const card = document.createElement('div')
		card.className = 'relative aspect-square bg-base-200 rounded-lg p-2'
		card.appendChild(await renderTemplate('stickers/detail_sticker', {
			url: sticker.url,
			name: sticker.name,
			escapeHtml,
		}))
		const favoriteButton = document.createElement('button')
		favoriteButton.type = 'button'
		favoriteButton.className = 'btn btn-circle btn-xs absolute top-1 right-1'
		favoriteButton.textContent = favorited ? '♥' : '♡'
		favoriteButton.addEventListener('click', (clickEvent) => {
			clickEvent.stopPropagation()
			void toggleStickerFavorite(sticker.id, favorited)
		})
		card.appendChild(favoriteButton)
		container.appendChild(card)
	}
}

/**
 * 转义HTML
 * @param {string} text - 文本
 * @returns {string} 可安全插入 innerHTML 的转义字符串
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

init()
