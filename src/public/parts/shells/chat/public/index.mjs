/**
 * 聊天页面的入口点。
 */
import { initTranslations } from '../../scripts/i18n.mjs'
import { usingTemplates } from '../../scripts/template.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

import { initializeChat } from './src/chat.mjs'
import { initGroupMode } from './src/groupMode.mjs'
import { initEmojiSticker, addEmojiButtonToChat } from './src/emojiSticker.mjs'

/**
 * 初始化聊天页面，包括主题、翻译和聊天功能。
 * @returns {Promise<void>}
 */
async function init() {
	applyTheme()
	await initTranslations('chat')
	usingTemplates('/parts/shells:chat/src/templates')

	// 检查是否是群组模式
	const hash = window.location.hash.slice(1)
	if (hash.startsWith('group:')) {
		await initGroupMode()
	} else {
		await initializeChat()
	}

	initializeStickerPicker()
	await initializeChannelsAndGroups()

	// 初始化表情包和贴纸功能
	initEmojiSticker()

	// 不需要再次添加表情按钮，因为已经在HTML中了
}

/**
 * 初始化贴纸选择器
 */
function initializeStickerPicker() {
	const stickerButton = document.getElementById('sticker-button')
	const stickerPicker = document.getElementById('sticker-picker')
	const closePicker = document.getElementById('close-sticker-picker')

	// 打开/关闭贴纸选择器
	stickerButton.addEventListener('click', (e) => {
		e.stopPropagation()
		stickerPicker.classList.toggle('hidden')
		if (!stickerPicker.classList.contains('hidden')) {
			loadStickers('recent')
		}
	})

	closePicker.addEventListener('click', () => {
		stickerPicker.classList.add('hidden')
	})

	// 点击外部关闭
	document.addEventListener('click', (e) => {
		if (!stickerPicker.contains(e.target) && !stickerButton.contains(e.target)) {
			stickerPicker.classList.add('hidden')
		}
	})

	// 标签页切换
	document.querySelectorAll('[data-sticker-tab]').forEach(tab => {
		tab.addEventListener('click', (e) => {
			const tabName = e.target.dataset.stickerTab
			document.querySelectorAll('[data-sticker-tab]').forEach(t => t.classList.remove('tab-active'))
			e.target.classList.add('tab-active')
			loadStickers(tabName)
		})
	})
}

/**
 * 加载贴纸
 * @param {string} category - 贴纸分类
 */
async function loadStickers(category) {
	const content = document.getElementById('sticker-picker-content')
	const noMessage = document.getElementById('no-stickers-message')

	try {
		const response = await fetch('/api/user/me', { credentials: 'include' })
		if (!response.ok) return

		const userData = await response.json()
		const username = userData.username

		const collectionResponse = await fetch(`/api/parts/shells:stickers/user/${username}`, {
			credentials: 'include'
		})

		if (!collectionResponse.ok) return

		const data = await collectionResponse.json()
		if (!data.success) return

		const collection = data.collection

		// 加载所有已安装贴纸包的贴纸（用于按 ID 查找）
		const allStickersMap = new Map()
		for (const packId of collection.installedPacks) {
			try {
				const packResponse = await fetch(`/api/parts/shells:stickers/packs/${packId}`, {
					credentials: 'include'
				})
				if (packResponse.ok) {
					const packData = await packResponse.json()
					if (packData.success) {
						for (const s of packData.pack.stickers) {
							allStickersMap.set(s.id, { ...s, packId })
						}
					}
				}
			} catch { }
		}

		let stickers = []
		if (category === 'recent') {
			stickers = collection.recentStickers.slice(0, 18)
				.map(id => allStickersMap.get(id)).filter(Boolean)
		} else if (category === 'favorites') {
			stickers = collection.favoriteStickers.slice(0, 18)
				.map(id => allStickersMap.get(id)).filter(Boolean)
		} else {
			stickers = [...allStickersMap.values()]
		}

		if (stickers.length === 0) {
			noMessage.style.display = 'block'
			content.innerHTML = ''
		} else {
			noMessage.style.display = 'none'
			content.innerHTML = stickers.map(sticker => {
				const id = sticker.id || sticker
				const url = sticker.url || ''
				const name = sticker.name || id
				return `
				<div class="aspect-square bg-base-300 rounded-lg p-2 hover:bg-base-100 transition-colors cursor-pointer sticker-item" data-sticker-id="${id}" data-sticker-url="${escapeAttr(url)}" title="${escapeAttr(name)}">
					${url ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(name)}" class="w-full h-full object-contain" />` : `<div class="w-full h-full flex items-center justify-center text-2xl">�</div>`}
				</div>`
			}).join('')

			// 添加点击事件
			document.querySelectorAll('.sticker-item').forEach(item => {
				item.addEventListener('click', async () => {
					const stickerId = item.dataset.stickerId
					const stickerUrl = item.dataset.stickerUrl || ''
					await insertSticker(stickerId, stickerUrl)
					document.getElementById('sticker-picker').classList.add('hidden')
				})
			})
		}
	} catch (error) {
		console.error('Failed to load stickers:', error)
	}
}

/**
 * 插入贴纸到消息
 * @param {string} stickerId - 贴纸ID
 */
async function insertSticker(stickerId, stickerUrl) {
	const messageInput = document.getElementById('message-input')
	if (stickerUrl) {
		messageInput.value += `[sticker:${stickerId}|${stickerUrl}]`
	} else {
		messageInput.value += `[sticker:${stickerId}]`
	}

	// 记录最近使用
	try {
		const response = await fetch('/api/user/me', { credentials: 'include' })
		if (response.ok) {
			const userData = await response.json()
			await fetch(`/api/parts/shells:stickers/recent/${stickerId}`, {
				method: 'POST',
				credentials: 'include'
			})
		}
	} catch (error) {
		console.error('Failed to record recent sticker:', error)
	}
}

/**
 * 初始化频道和群组列表
 */
async function initializeChannelsAndGroups() {
	try {
		// 加载频道列表
		const channelsResponse = await fetch('/api/parts/shells:channels/list', {
			credentials: 'include'
		})
		if (channelsResponse.ok) {
			const channelsData = await channelsResponse.json()
			if (channelsData.success) {
				renderChannels(channelsData.channels || [])
			}
		}

		// 加载群组列表
		const groupsResponse = await fetch('/api/parts/shells:chat/group/list', {
			credentials: 'include'
		})
		if (groupsResponse.ok) {
			const groupsData = await groupsResponse.json()
			if (groupsData.success) {
				renderGroups(groupsData.groups || [])
			}
		}

		// 添加频道按钮事件
		document.getElementById('add-channel-btn').addEventListener('click', () => {
			window.location.href = '/parts/shells:channels'
		})

		// 添加群组按钮事件
		document.getElementById('add-group-btn').addEventListener('click', () => {
			showGroupModal()
		})
	} catch (error) {
		console.error('Failed to load channels and groups:', error)
		renderGroups([])
	}
}

/**
 * 渲染频道列表
 * @param {Array} channels - 频道列表
 */
function renderChannels(channels) {
	const container = document.getElementById('channels-container')

	if (channels.length === 0) {
		container.innerHTML = '<p class="text-sm opacity-50 px-4 py-2">暂无频道</p>'
		return
	}

	container.innerHTML = channels.slice(0, 5).map(channel => `
		<a href="/parts/shells:channels?id=${channel.channelId}" class="flex items-center gap-2 p-2 rounded-lg hover:bg-base-300 transition-colors">
			<span class="text-lg">#</span>
			<div class="flex-1 min-w-0">
				<div class="font-medium truncate">${escapeHtml(channel.name)}</div>
				<div class="text-xs opacity-70 truncate">${channel.memberCount || 0} 成员</div>
			</div>
		</a>
	`).join('')

	if (channels.length > 5) {
		container.innerHTML += `
			<a href="/parts/shells:channels" class="text-sm text-primary hover:underline px-4 py-2 block">
				查看全部 ${channels.length} 个频道 →
			</a>
		`
	}
}

/**
 * 渲染群组列表
 * @param {Array} groups - 群组列表
 */
function renderGroups(groups) {
	const container = document.getElementById('groups-container')

	if (groups.length === 0) {
		container.innerHTML = '<p class="text-sm opacity-50 px-4 py-2">暂无群组</p>'
		return
	}

	container.innerHTML = groups.slice(0, 5).map(group => `
		<a href="/parts/shells:chat/group.html#${group.groupId}" class="flex items-center gap-2 p-2 rounded-lg hover:bg-base-300 transition-colors">
			<div class="avatar placeholder">
				<div class="bg-neutral text-neutral-content rounded-full w-8">
					<span class="text-xs">${escapeHtml(group.name.charAt(0))}</span>
				</div>
			</div>
			<div class="flex-1 min-w-0">
				<div class="font-medium truncate">${escapeHtml(group.name)}</div>
				<div class="text-xs opacity-70 truncate">${group.memberCount || 0} 成员</div>
			</div>
		</a>
	`).join('')

	if (groups.length > 5) {
		container.innerHTML += `
			<a href="/parts/shells:chat/list" class="text-sm text-primary hover:underline px-4 py-2 block">
				查看全部 ${groups.length} 个群组 →
			</a>
		`
	}
}

/**
 * 显示创建群组模态框
 */
function showGroupModal() {
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-4">群组</h3>

			<form id="create-group-form">
				<h4 class="font-semibold mb-2">创建群组</h4>
				<div class="form-control mb-3">
					<label class="label"><span class="label-text">群组名称</span></label>
					<input type="text" id="group-name-input" placeholder="请输入群组名称" class="input input-bordered" required />
				</div>
				<div class="form-control mb-3">
					<label class="label"><span class="label-text">群组描述</span></label>
					<textarea id="group-desc-input" placeholder="可选" class="textarea textarea-bordered" rows="3"></textarea>
				</div>
				<div class="flex justify-end gap-2">
					<button type="submit" class="btn btn-primary">创建</button>
				</div>
			</form>

			<div class="divider my-6">或者</div>

			<form id="join-group-form">
				<h4 class="font-semibold mb-2">加入群组</h4>
				<div class="form-control mb-3">
					<label class="label"><span class="label-text">群组 ID</span></label>
					<input type="text" id="join-group-id-input" placeholder="group_..." class="input input-bordered" required />
				</div>
				<div class="form-control mb-3">
					<label class="label"><span class="label-text">邀请码（可选）</span></label>
					<input type="text" id="join-invite-code-input" placeholder="请输入邀请码" class="input input-bordered" />
				</div>
				<div class="flex justify-end gap-2">
					<button type="button" class="btn" id="close-group-modal-btn">关闭</button>
					<button type="submit" class="btn btn-secondary">加入</button>
				</div>
			</form>
		</div>
		<form method="dialog" class="modal-backdrop"><button>关闭</button></form>
	`
	document.body.appendChild(modal)
	modal.showModal()

	const cleanup = () => {
		try { modal.close() } catch { }
		modal.remove()
	}

	document.getElementById('close-group-modal-btn')?.addEventListener('click', cleanup)

	const solvePow = async ({ challenge, difficulty }) => {
		let nonce = 0
		const target = '0'.repeat(difficulty)
		const encoder = new TextEncoder()
		while (true) {
			const input = `${challenge}:${nonce}`
			const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(input))
			const hashArray = Array.from(new Uint8Array(hashBuffer))
			const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
			if (hex.startsWith(target)) return nonce
			nonce++
			if (nonce % 1000 === 0) await new Promise(r => setTimeout(r, 0))
		}
	}

	document.getElementById('create-group-form')?.addEventListener('submit', async (e) => {
		e.preventDefault()
		const name = document.getElementById('group-name-input').value.trim()
		const description = document.getElementById('group-desc-input').value.trim()
		if (!name) return

		try {
			const response = await fetch('/api/parts/shells:chat/group/new', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ name, description })
			})
			const data = await response.json().catch(() => ({}))
			if (!response.ok || !data?.success)
				throw new Error(data?.error || 'Failed to create group')

			cleanup()
			window.location.href = `/parts/shells:chat#group:${data.groupId}:${data.defaultChannelId}`
		} catch (error) {
			console.error('Create group error:', error)
			alert('创建群组失败: ' + error.message)
		}
	})

	document.getElementById('join-group-form')?.addEventListener('submit', async (e) => {
		e.preventDefault()
		const groupId = document.getElementById('join-group-id-input').value.trim()
		const inviteCode = document.getElementById('join-invite-code-input').value.trim()
		if (!groupId) return

		const tryJoin = async (pow) => {
			const resp = await fetch(`/api/parts/shells:chat/${encodeURIComponent(groupId)}/join`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ inviteCode: inviteCode || undefined, pow })
			})
			const data = await resp.json().catch(() => ({}))
			return { ok: resp.ok, data }
		}

		try {
			let { ok, data } = await tryJoin()

			const errMsg = String(data?.error || '')
			if (!ok && errMsg.toLowerCase().includes('pow')) {
				const chRes = await fetch(`/api/parts/shells:chat/${encodeURIComponent(groupId)}/pow-challenge`, { credentials: 'include' })
				const chData = await chRes.json().catch(() => ({}))
				if (!chRes.ok || !chData?.success || !chData?.challenge)
					throw new Error(chData?.error || 'PoW challenge fetch failed')
				const nonce = await solvePow(chData.challenge)
				;({ ok, data } = await tryJoin({ challenge: chData.challenge.challenge, nonce }))
			}

			if (!data?.success)
				throw new Error(data?.error || 'Failed to join group')

			cleanup()
			window.location.href = `/parts/shells:chat#group:${data.groupId}:${data.defaultChannelId}`
		} catch (error) {
			console.error('Join group error:', error)
			alert('加入群组失败: ' + error.message)
		}
	})
}

function showCreateGroupModal() {
	const modal = document.createElement('dialog')
	modal.className = 'modal'
	modal.innerHTML = `
		<div class="modal-box">
			<h3 class="font-bold text-lg mb-4">创建群组</h3>
			<form id="create-group-form">
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">群组名称</span>
					</label>
					<input type="text" id="group-name-input" placeholder="输入群组名称" class="input input-bordered" required />
				</div>
				<div class="form-control mb-4">
					<label class="label">
						<span class="label-text">群组描述</span>
					</label>
					<textarea id="group-desc-input" placeholder="输入群组描述（可选）" class="textarea textarea-bordered" rows="3"></textarea>
				</div>
				<div class="modal-action">
					<button type="button" class="btn" onclick="this.closest('dialog').close()">取消</button>
					<button type="submit" class="btn btn-primary">创建</button>
				</div>
			</form>
		</div>
		<form method="dialog" class="modal-backdrop"><button>close</button></form>
	`
	document.body.appendChild(modal)
	modal.showModal()

	// 处理表单提交
	document.getElementById('create-group-form').addEventListener('submit', async (e) => {
		e.preventDefault()
		const name = document.getElementById('group-name-input').value.trim()
		const description = document.getElementById('group-desc-input').value.trim()

		if (!name) {
			alert('请输入群组名称')
			return
		}

		try {
			const response = await fetch('/api/parts/shells:chat/group/new', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ name, description })
			})

			if (!response.ok) {
				throw new Error('Failed to create group')
			}

			const data = await response.json()
			if (!data.success) {
				throw new Error(data.error || 'Failed to create group')
			}

			// 关闭模态框
			modal.close()
			modal.remove()

			// 跳转到新创建的群组
			window.location.href = `/parts/shells:chat#group:${data.groupId}:${data.defaultChannelId}`
		} catch (error) {
			console.error('Create group error:', error)
			alert('创建群组失败: ' + error.message)
		}
	})
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

function escapeAttr(text) {
	return String(text ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
}

init()
