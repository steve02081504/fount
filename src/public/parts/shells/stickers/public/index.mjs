import { initTranslations } from '../../scripts/i18n.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast } from '../../scripts/toast.mjs'

let currentUser = null
let allPacks = []
let userCollection = null
let currentTab = 'all'
let currentPackId = null

/**
 * 初始化贴纸商店页面
 */
async function init() {
	applyTheme()
	await initTranslations('stickers')

	// 获取当前用户
	try {
		const response = await fetch('/api/user/me', {
			credentials: 'include'
		})
		if (response.ok) {
			const data = await response.json()
			currentUser = data.username
		}
	} catch (error) {
		console.error('Failed to get current user:', error)
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
		// 检查是否已有默认贴纸包
		const response = await fetch('/api/parts/shells:stickers/packs', {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			if (data.success && data.packs.length === 0) {
				// 创建默认贴纸包
				await createDefaultPack()
			}
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
		const response = await fetch('/api/parts/shells:stickers/packs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				name: '默认表情包',
				description: '系统默认提供的表情贴纸',
				isPublic: true
			})
		})

		if (response.ok) {
			await loadPacks()
		}
	} catch (error) {
		console.error('Failed to create default pack:', error)
	}
}

/**
 * 设置事件监听器
 */
function setupEventListeners() {
	// 创建贴纸包按钮
	document.getElementById('create-pack-btn').addEventListener('click', () => {
		document.getElementById('create-pack-modal').showModal()
	})

	// 上传贴纸按钮
	document.getElementById('upload-sticker-btn').addEventListener('click', async () => {
		await loadUserPacks()
		document.getElementById('upload-sticker-modal').showModal()
	})

	// 创建贴纸包表单
	document.getElementById('create-pack-form').addEventListener('submit', handleCreatePack)

	// 上传贴纸表单
	document.getElementById('upload-sticker-form').addEventListener('submit', handleUploadSticker)

	// 搜索输入
	document.getElementById('search-input').addEventListener('input', handleSearch)

	// 标签页切换
	document.querySelectorAll('.tabs .tab').forEach(tab => {
		tab.addEventListener('click', (e) => {
			const tabName = e.target.dataset.tab
			switchTab(tabName)
		})
	})

	// 安装/卸载/删除按钮
	document.getElementById('install-pack-btn').addEventListener('click', handleInstallPack)
	document.getElementById('uninstall-pack-btn').addEventListener('click', handleUninstallPack)
	document.getElementById('delete-pack-btn').addEventListener('click', handleDeletePack)
}

/**
 * 加载贴纸包列表
 */
async function loadPacks() {
	try {
		const response = await fetch('/api/parts/shells:stickers/packs', {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			if (data.success) {
				allPacks = data.packs
				renderPacks(allPacks)
			}
		}
	} catch (error) {
		console.error('Failed to load packs:', error)
		showToast('error', '加载贴纸包失败')
	}
}

/**
 * 加载用户收藏
 */
async function loadUserCollection() {
	if (!currentUser) return

	try {
		const response = await fetch(`/api/parts/shells:stickers/user/${currentUser}`, {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			if (data.success) {
				userCollection = data.collection
			}
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
	select.innerHTML = '<option value="">请选择贴纸包</option>'

	const userPacks = allPacks.filter(pack => pack.author === currentUser)

	userPacks.forEach(pack => {
		const option = document.createElement('option')
		option.value = pack.packId
		option.textContent = pack.name
		select.appendChild(option)
	})
}

/**
 * 渲染贴纸包列表
 * @param {Array} packs - 贴纸包列表
 */
function renderPacks(packs) {
	const container = document.getElementById('packs-container')
	const emptyState = document.getElementById('empty-state')

	if (packs.length === 0) {
		container.innerHTML = ''
		emptyState.classList.remove('hidden')
		return
	}

	emptyState.classList.add('hidden')
	container.innerHTML = ''

	packs.forEach(pack => {
		const card = document.createElement('div')
		card.className = 'card bg-base-200 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer'
		card.dataset.packId = pack.packId

		const isInstalled = userCollection?.installedPacks.includes(pack.packId)

		card.innerHTML = `
			<figure class="px-10 pt-10">
				<div class="w-32 h-32 bg-base-300 rounded-lg flex items-center justify-center">
					${pack.thumbnail ? `<img src="${escapeHtml(pack.thumbnail)}" alt="${escapeHtml(pack.name)}" class="w-full h-full object-cover rounded-lg" />` : '<span class="text-6xl">📦</span>'}
				</div>
			</figure>
			<div class="card-body items-center text-center">
				<h2 class="card-title">${escapeHtml(pack.name)}</h2>
				<p class="text-sm opacity-70">${escapeHtml(pack.description || '')}</p>
				<div class="card-actions">
					<div class="badge badge-outline">${pack.stickers.length} 个贴纸</div>
					${isInstalled ? '<div class="badge badge-success">已安装</div>' : ''}
					${pack.author === currentUser ? '<div class="badge badge-primary">我的</div>' : ''}
				</div>
			</div>
		`

		card.addEventListener('click', () => showPackDetail(pack.packId))
		container.appendChild(card)
	})
}

/**
 * 显示贴纸包详情
 * @param {string} packId - 贴纸包ID
 */
async function showPackDetail(packId) {
	try {
		const response = await fetch(`/api/parts/shells:stickers/packs/${packId}`, {
			credentials: 'include'
		})

		if (response.ok) {
			const data = await response.json()
			if (data.success) {
				currentPackId = packId
				renderPackDetail(data.pack)
				document.getElementById('pack-detail-modal').showModal()
			}
		}
	} catch (error) {
		console.error('Failed to load pack detail:', error)
		showToast('error', '加载贴纸包详情失败')
	}
}

/**
 * 渲染贴纸包详情
 * @param {object} pack - 贴纸包
 */
function renderPackDetail(pack) {
	document.getElementById('detail-pack-name').textContent = pack.name
	document.getElementById('detail-pack-description').textContent = pack.description || '暂无描述'
	document.getElementById('detail-pack-author').textContent = `作者: ${pack.author}`
	document.getElementById('detail-pack-count').textContent = `${pack.stickers.length} 个贴纸`

	const stickersContainer = document.getElementById('detail-stickers-container')
	stickersContainer.innerHTML = ''

	if (pack.stickers.length === 0) {
		stickersContainer.innerHTML = '<p class="col-span-full text-center opacity-50">暂无贴纸</p>'
	} else {
		pack.stickers.forEach(sticker => {
			const stickerDiv = document.createElement('div')
			stickerDiv.className = 'aspect-square bg-base-300 rounded-lg p-2 hover:bg-base-100 transition-colors cursor-pointer'
			stickerDiv.innerHTML = `
				<img src="${escapeHtml(sticker.url)}" alt="${escapeHtml(sticker.name)}" class="w-full h-full object-contain" />
			`
			stickersContainer.appendChild(stickerDiv)
		})
	}

	// 显示/隐藏安装/卸载按钮
	const isInstalled = userCollection?.installedPacks.includes(pack.packId)
	const installBtn = document.getElementById('install-pack-btn')
	const uninstallBtn = document.getElementById('uninstall-pack-btn')

	if (isInstalled) {
		installBtn.classList.add('hidden')
		uninstallBtn.classList.remove('hidden')
	} else {
		installBtn.classList.remove('hidden')
		uninstallBtn.classList.add('hidden')
	}

	// 仅作者可见删除按钮
	const deleteBtn = document.getElementById('delete-pack-btn')
	deleteBtn.classList.toggle('hidden', pack.author !== currentUser)
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
		showToast('error', '请输入贴纸包名称')
		return
	}

	try {
		const response = await fetch('/api/parts/shells:stickers/packs', {
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
			showToast('success', '贴纸包创建成功')
			document.getElementById('create-pack-modal').close()
			document.getElementById('create-pack-form').reset()
			await loadPacks()
		} else {
			showToast('error', '创建贴纸包失败')
		}
	} catch (error) {
		console.error('Failed to create pack:', error)
		showToast('error', '创建贴纸包失败')
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
		showToast('error', '请选择贴纸包')
		return
	}

	if (!name) {
		showToast('error', '请输入贴纸名称')
		return
	}

	if (!file) {
		showToast('error', '请选择图片文件')
		return
	}

	try {
		const formData = new FormData()
		formData.append('sticker', file)
		formData.append('name', name)
		formData.append('tags', JSON.stringify(tags.split(',').map(t => t.trim()).filter(t => t)))

		const response = await fetch(`/api/parts/shells:stickers/packs/${packId}/stickers`, {
			method: 'POST',
			credentials: 'include',
			body: formData
		})

		if (response.ok) {
			showToast('success', '贴纸上传成功')
			document.getElementById('upload-sticker-modal').close()
			document.getElementById('upload-sticker-form').reset()
			await loadPacks()
		} else {
			showToast('error', '上传贴纸失败')
		}
	} catch (error) {
		console.error('Failed to upload sticker:', error)
		showToast('error', '上传贴纸失败')
	}
}

/**
 * 处理安装贴纸包
 */
async function handleInstallPack() {
	if (!currentPackId) return

	try {
		const response = await fetch(`/api/parts/shells:stickers/install/${currentPackId}`, {
			method: 'POST',
			credentials: 'include'
		})

		if (response.ok) {
			showToast('success', '贴纸包安装成功')
			await loadUserCollection()
			await loadPacks()
			document.getElementById('pack-detail-modal').close()
		} else {
			showToast('error', '安装贴纸包失败')
		}
	} catch (error) {
		console.error('Failed to install pack:', error)
		showToast('error', '安装贴纸包失败')
	}
}

/**
 * 处理卸载贴纸包
 */
async function handleUninstallPack() {
	if (!currentPackId) return

	try {
		const response = await fetch(`/api/parts/shells:stickers/uninstall/${currentPackId}`, {
			method: 'POST',
			credentials: 'include'
		})

		if (response.ok) {
			showToast('success', '贴纸包卸载成功')
			await loadUserCollection()
			await loadPacks()
			document.getElementById('pack-detail-modal').close()
		} else {
			showToast('error', '卸载贴纸包失败')
		}
	} catch (error) {
		console.error('Failed to uninstall pack:', error)
		showToast('error', '卸载贴纸包失败')
	}
}

/**
 * 处理删除贴纸包
 */
async function handleDeletePack() {
	if (!currentPackId) return
	if (!confirm('确定要永久删除此贴纸包吗？所有贴纸将被删除，此操作不可撤销。')) return

	try {
		const response = await fetch(`/api/parts/shells:stickers/packs/${currentPackId}`, {
			method: 'DELETE',
			credentials: 'include'
		})

		if (response.ok) {
			showToast('success', '贴纸包已删除')
			document.getElementById('pack-detail-modal').close()
			await loadUserCollection()
			await loadPacks()
		} else {
			const data = await response.json()
			showToast('error', data.error || '删除贴纸包失败')
		}
	} catch (error) {
		console.error('Failed to delete pack:', error)
		showToast('error', '删除贴纸包失败')
	}
}

/**
 * 处理搜索
 * @param {Event} e - 输入事件
 */
function handleSearch(e) {
	const query = e.target.value.toLowerCase().trim()

	if (!query) {
		filterPacksByTab()
		return
	}

	const filtered = allPacks.filter(pack =>
		pack.name.toLowerCase().includes(query) ||
		pack.description.toLowerCase().includes(query)
	)

	renderPacks(filtered)
}

/**
 * 切换标签页
 * @param {string} tabName - 标签页名称
 */
function switchTab(tabName) {
	currentTab = tabName

	// 更新标签页激活状态
	document.querySelectorAll('.tabs .tab').forEach(tab => {
		if (tab.dataset.tab === tabName) {
			tab.classList.add('tab-active')
		} else {
			tab.classList.remove('tab-active')
		}
	})

	filterPacksByTab()
}

/**
 * 根据标签页过滤贴纸包
 */
function filterPacksByTab() {
	let filtered = []

	switch (currentTab) {
		case 'all':
			filtered = allPacks
			break
		case 'installed':
			filtered = allPacks.filter(pack => userCollection?.installedPacks.includes(pack.packId))
			break
		case 'my-packs':
			filtered = allPacks.filter(pack => pack.author === currentUser)
			break
	}

	renderPacks(filtered)
}

/**
 * 转义HTML
 * @param {string} text - 文本
 * @returns {string}
 */
function escapeHtml(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
}

init()
